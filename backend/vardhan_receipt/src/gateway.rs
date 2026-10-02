use axum::{
    routing::post,
    Router,
    Json,
    extract::State,
    http::StatusCode,
    response::IntoResponse,
};
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;

use crate::{QCoreValidationRequest, VardhanSealedReceipt, process_transaction};

pub async fn start_server(port: u16) {
    let app = Router::new()
        .route("/api/v1/seal", post(handle_seal))
        .route("/health", axum::routing::get(|| async { "Q-Core Gateway Online" }));

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("🚀 VARDHAN Q-CORE TOLLBOOTH API running on http://{}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn handle_seal(
    Json(payload): Json<QCoreValidationRequest>,
) -> impl IntoResponse {
    match process_transaction(payload) {
        Ok(receipt) => {
            (StatusCode::OK, Json(receipt)).into_response()
        },
        Err((code, msg)) => {
            let error_response = json!({
                "status": "REJECTED",
                "code": code,
                "message": msg
            });
            (StatusCode::BAD_REQUEST, Json(error_response)).into_response()
        }
    }
}
