use axum::{extract::{State, Path}, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use crate::ControlPlaneState;
use std::process::{Command, Stdio};
use std::io::Write;

#[derive(Deserialize, Serialize)]
pub struct ValidationRequest {
    pub contract: serde_json::Value,
    pub actor_workload_id: String,
}

pub async fn validate_canonical(
    State(state): State<ControlPlaneState>,
    Path(id): Path<String>,
    Json(payload): Json<ValidationRequest>,
) -> impl IntoResponse {
    // For the Lab Demo, we continue using the binary as the source of truth
    // but wrap it in a proper network API.
    let binary_path = "/Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main/target/release/vardhan-receipt";
    
    let mut child = match Command::new(binary_path)
        .arg("validate-canonical")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn() {
            Ok(c) => c,
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("Failed to spawn receipt engine: {}", e)}))).into_response(),
        };

    let mut stdin = child.stdin.take().unwrap();
    let payload_bytes = serde_json::to_vec(&payload).unwrap();
    if let Err(e) = stdin.write_all(&payload_bytes) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("Failed to write to engine: {}", e)}))).into_response();
    }
    drop(stdin);

    let output = match child.wait_with_output() {
        Ok(o) => o,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("Engine execution failed: {}", e)}))).into_response(),
    };

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let last_line = stdout_str.trim().lines().last().unwrap_or("");
    
    if let Ok(receipt) = serde_json::from_str::<serde_json::Value>(last_line) {
        (StatusCode::OK, Json(receipt)).into_response()
    } else {
        (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({
            "status": "REJECTED",
            "details": stdout_str
        }))).into_response()
    }
}
