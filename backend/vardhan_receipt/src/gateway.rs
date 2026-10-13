use axum::{http::StatusCode, response::IntoResponse, routing::post, Json, Router};
use serde_json::json;
use std::net::SocketAddr;

use crate::{process_transaction, QCoreValidationRequest};

#[path = "qcore_transport.rs"]
mod qcore_transport;

pub async fn start_server(port: u16) {
    let app = Router::new()
        .route("/api/v1/seal", post(handle_seal))
        .route(
            "/health",
            axum::routing::get(|| async { "Q-Core Gateway Online" }),
        );

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("VARDHAN Q-CORE TOLLBOOTH API running on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn handle_seal(Json(payload): Json<QCoreValidationRequest>) -> impl IntoResponse {
    let organization_id = payload.contract.organization.organization_id.clone();
    match process_transaction(payload) {
        Ok(receipt) => {
            match qcore_transport::publish_receipt(&organization_id, &receipt).await {
                Ok(publication) => (
                    StatusCode::OK,
                    Json(json!({
                        "status": "SEALED_AND_PUBLISHED",
                        "receipt": receipt,
                        "transport": publication
                    })),
                ).into_response(),
                Err(error) => (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({
                        "status": "SEALED_BUT_NOT_PUBLISHED",
                        "code": "QCORE_TRANSPORT_FAILED",
                        "message": error.to_string(),
                        "receipt_id": receipt.receipt_id,
                        "transaction_id": receipt.transaction_id
                    })),
                ).into_response(),
            }
        }
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