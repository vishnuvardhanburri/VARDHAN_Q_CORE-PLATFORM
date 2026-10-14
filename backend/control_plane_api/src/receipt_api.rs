use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use crate::ControlPlaneState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
};

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
    State(_state): State<ControlPlaneState>,
    Path(_organization_id): Path<String>,
    Json(payload): Json<ValidationRequest>,
) -> impl IntoResponse {
    let binary_path = match receipt_binary_path() {
        Ok(path) => path,
        Err(error) => {
            tracing::error!(%error, "receipt engine is not configured");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "Receipt engine is not configured" })),
            )
                .into_response();
        }
    };

    let mut child = match Command::new(&binary_path)
        .arg("validate-canonical")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
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
            tracing::error!(%error, "failed to serialize receipt request");
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid receipt request" })),
            )
                .into_response();
        }
    };

    let Some(mut stdin) = child.stdin.take() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Receipt engine input pipe was unavailable" })),
        )
            .into_response();
    };

    if let Err(error) = stdin.write_all(&payload_bytes) {
        tracing::error!(%error, "failed to write receipt request to engine");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to submit receipt request" })),
        )
            .into_response();
    }
    drop(stdin);

    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(error) => {
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
        (StatusCode::OK, Json(receipt)).into_response()
    } else {
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
