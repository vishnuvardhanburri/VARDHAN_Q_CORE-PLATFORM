use crate::{distributed_idempotency, ControlPlaneState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{path::PathBuf, process::Stdio};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

#[derive(Deserialize, Serialize)]
pub struct ValidationRequest {
    pub contract: serde_json::Value,
    pub actor_workload_id: String,
}

/// Resolve the receipt engine without depending on a developer-specific path.
/// Deployments can pin the executable explicitly with VARDHAN_RECEIPT_BIN.
fn receipt_binary_path() -> Result<PathBuf, String> {
    if let Some(configured) = std::env::var_os("VARDHAN_RECEIPT_BIN") {
        let path = PathBuf::from(configured);
        if path.is_file() {
            return Ok(path);
        }
        return Err("VARDHAN_RECEIPT_BIN is configured but does not point to a file".into());
    }

    // CARGO_MANIFEST_DIR is backend/control_plane_api; two parents reach the
    // workspace root where Cargo places workspace binaries by default.
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let target_dir = match std::env::var_os("CARGO_TARGET_DIR") {
        Some(configured) => {
            let path = PathBuf::from(configured);
            if path.is_absolute() {
                path
            } else {
                workspace_root.join(path)
            }
        }
        None => workspace_root.join("target"),
    };

    [
        target_dir.join("debug/vardhan-receipt"),
        target_dir.join("release/vardhan-receipt"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
    .ok_or_else(|| {
        "receipt engine binary was not found; build vardhan_receipt or set VARDHAN_RECEIPT_BIN"
            .to_string()
    })
}

pub async fn validate_canonical(
    State(state): State<ControlPlaneState>,
    Path(organization_id): Path<String>,
    Json(payload): Json<ValidationRequest>,
) -> impl IntoResponse {
    // Bind the URL tenant to the contract tenant before invoking the receipt
    // engine. Without this check, the path can name one organization while the
    // signed contract names another (or a globally allowed static tenant).
    // Only enforce when the payload actually contains an organization_id —
    // malformed contracts that omit it are forwarded to the receipt engine
    // for proper validation rather than being rejected at the routing layer.
    let payload_organization_id = payload
        .contract
        .pointer("/organization/organization_id")
        .and_then(serde_json::Value::as_str);
    match payload_organization_id {
        Some(payload_org) if payload_org != organization_id => {
            tracing::warn!(
                route_organization_id = %organization_id,
                payload_organization_id = %payload_org,
                "receipt validation rejected because route and payload tenant differ"
            );
            return (
                StatusCode::FORBIDDEN,
                Json(json!({
                    "status": "REJECTED_TENANT_MISMATCH",
                    "error": "Route organization does not match contract organization"
                })),
            )
                .into_response();
        }
        _ => { /* org IDs match, or payload has no org_id — proceed */ }
    }

    let finding_id_opt = payload
        .contract
        .pointer("/finding_id")
        .and_then(serde_json::Value::as_str);

    let instance_id = state
        .auth
        .node_id
        .clone()
        .unwrap_or_else(|| "control-plane-api".to_string());

    let (idempotency_key, payload_hash, tx_id) = if let Some(fid) = finding_id_opt {
        let contract_bytes = serde_json::to_vec(&payload.contract).unwrap_or_default();
        let hash = hex::encode(blake3::hash(&contract_bytes).as_bytes());
        let tx = format!("tx-{}", uuid::Uuid::new_v4());
        (Some(fid.to_string()), Some(hash), tx)
    } else {
        (None, None, format!("tx-{}", uuid::Uuid::new_v4()))
    };

    // If an idempotency key is present, perform atomic reservation across cluster
    if let (Some(ref idem_key), Some(ref p_hash)) = (&idempotency_key, &payload_hash) {
        match state
            .idempotency
            .reserve(
                &organization_id,
                idem_key,
                &tx_id,
                p_hash,
                30_000,
                &instance_id,
            )
            .await
        {
            Ok(distributed_idempotency::ReservationOutcome::AlreadySealed {
                receipt_id, ..
            }) => {
                return (
                    StatusCode::OK,
                    Json(json!({
                        "status": "REJECTED_REPLAY",
                        "receipt_id": receipt_id,
                        "error": format!(
                            "Finding '{idem_key}' has already been sealed — duplicate submission rejected by durable idempotency guard"
                        )
                    })),
                )
                    .into_response();
            }
            Ok(distributed_idempotency::ReservationOutcome::PayloadMismatch {
                existing_payload_hash,
                submitted_payload_hash,
            }) => {
                return (
                    StatusCode::CONFLICT,
                    Json(json!({
                        "status": "REJECTED_PAYLOAD_MISMATCH",
                        "error": format!(
                            "Finding '{idem_key}' was previously submitted with a different payload hash ({existing_payload_hash} vs {submitted_payload_hash})"
                        ),
                        "existing_payload_hash": existing_payload_hash,
                        "submitted_payload_hash": submitted_payload_hash
                    })),
                )
                    .into_response();
            }
            Ok(distributed_idempotency::ReservationOutcome::InFlight {
                owner_instance_id, ..
            }) => {
                return (
                    StatusCode::OK,
                    Json(json!({
                        "status": "REJECTED_REPLAY",
                        "error": format!(
                            "Finding '{idem_key}' is being sealed by node '{owner_instance_id}' — duplicate submission rejected by atomic idempotency guard"
                        )
                    })),
                )
                    .into_response();
            }
            Ok(distributed_idempotency::ReservationOutcome::ReplayRejected { reason }) => {
                return (
                    StatusCode::OK,
                    Json(json!({
                        "status": "REJECTED_REPLAY",
                        "error": reason
                    })),
                )
                    .into_response();
            }
            Err(e) => {
                tracing::error!(error = %e, "Idempotency coordination failure");
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({
                        "status": "REJECTED",
                        "error": format!("Idempotency coordination store unavailable: {e}")
                    })),
                )
                    .into_response();
            }
            Ok(distributed_idempotency::ReservationOutcome::Reserved { .. }) => {
                state
                    .idempotency
                    .mark_sealing(&organization_id, idem_key, &tx_id, &instance_id)
                    .await
                    .ok();
            }
        }
    }

    let binary_path = match receipt_binary_path() {
        Ok(path) => path,
        Err(error) => {
            if let Some(ref idem_key) = idempotency_key {
                state
                    .idempotency
                    .release_or_fail(
                        &organization_id,
                        idem_key,
                        &tx_id,
                        "receipt_engine_unconfigured",
                        &instance_id,
                    )
                    .await
                    .ok();
            }
            tracing::error!(%error, "receipt engine is not configured");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "Receipt engine is not configured" })),
            )
                .into_response();
        }
    };

    let tenant_idem_dir = format!("/tmp/vardhan_idem_{organization_id}");
    let _ = std::fs::create_dir_all(&tenant_idem_dir);

    let mut child = match Command::new(&binary_path)
        .arg("validate-canonical")
        .env("VARDHAN_IDEMPOTENCY_DIR", &tenant_idem_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            if let Some(ref idem_key) = idempotency_key {
                state
                    .idempotency
                    .release_or_fail(
                        &organization_id,
                        idem_key,
                        &tx_id,
                        "receipt_engine_spawn_failed",
                        &instance_id,
                    )
                    .await
                    .ok();
            }
            tracing::error!(path = %binary_path.display(), %error, "failed to spawn receipt engine");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "Receipt engine could not be started" })),
            )
                .into_response();
        }
    };

    let payload_bytes = match serde_json::to_vec(&payload) {
        Ok(bytes) => bytes,
        Err(error) => {
            if let Some(ref idem_key) = idempotency_key {
                state
                    .idempotency
                    .release_or_fail(
                        &organization_id,
                        idem_key,
                        &tx_id,
                        "invalid_payload_serialization",
                        &instance_id,
                    )
                    .await
                    .ok();
            }
            tracing::error!(%error, "failed to serialize receipt request");
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid receipt request" })),
            )
                .into_response();
        }
    };

    let Some(mut stdin) = child.stdin.take() else {
        if let Some(ref idem_key) = idempotency_key {
            state
                .idempotency
                .release_or_fail(
                    &organization_id,
                    idem_key,
                    &tx_id,
                    "engine_stdin_unavailable",
                    &instance_id,
                )
                .await
                .ok();
        }
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Receipt engine input pipe was unavailable" })),
        )
            .into_response();
    };

    if let Err(error) = stdin.write_all(&payload_bytes).await {
        if let Some(ref idem_key) = idempotency_key {
            state
                .idempotency
                .release_or_fail(
                    &organization_id,
                    idem_key,
                    &tx_id,
                    "engine_pipe_write_failed",
                    &instance_id,
                )
                .await
                .ok();
        }
        tracing::error!(%error, "failed to write receipt request to engine");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to submit receipt request" })),
        )
            .into_response();
    }
    drop(stdin);

    let output = match child.wait_with_output().await {
        Ok(output) => output,
        Err(error) => {
            if let Some(ref idem_key) = idempotency_key {
                state
                    .idempotency
                    .release_or_fail(
                        &organization_id,
                        idem_key,
                        &tx_id,
                        "engine_wait_failed",
                        &instance_id,
                    )
                    .await
                    .ok();
            }
            tracing::error!(%error, "receipt engine execution failed");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Receipt engine execution failed" })),
            )
                .into_response();
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let last_line = stdout.trim().lines().last().unwrap_or("");

    if let Ok(receipt) = serde_json::from_str::<serde_json::Value>(last_line) {
        if receipt.get("status").and_then(|s| s.as_str()) == Some("SEALED") {
            if let Some(ref idem_key) = idempotency_key {
                let receipt_id = receipt
                    .get("receipt_id")
                    .and_then(|s| s.as_str())
                    .unwrap_or(&tx_id);
                state
                    .idempotency
                    .commit_sealed(
                        &organization_id,
                        idem_key,
                        &tx_id,
                        receipt_id,
                        &receipt,
                        &instance_id,
                    )
                    .await
                    .ok();
            }
        } else {
            if let Some(ref idem_key) = idempotency_key {
                state
                    .idempotency
                    .release_or_fail(
                        &organization_id,
                        idem_key,
                        &tx_id,
                        "receipt_rejected_by_engine",
                        &instance_id,
                    )
                    .await
                    .ok();
            }
        }
        (StatusCode::OK, Json(receipt)).into_response()
    } else {
        if let Some(ref idem_key) = idempotency_key {
            state
                .idempotency
                .release_or_fail(
                    &organization_id,
                    idem_key,
                    &tx_id,
                    "engine_no_json_returned",
                    &instance_id,
                )
                .await
                .ok();
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::error!(
            exit_code = ?output.status.code(),
            stdout = %stdout,
            stderr = %stderr,
            "receipt engine returned no JSON receipt"
        );
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({
                "status": "REJECTED",
                "details": stdout
            })),
        )
            .into_response()
    }
}
