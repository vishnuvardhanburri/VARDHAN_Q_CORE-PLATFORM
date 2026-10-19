use axum::{
    body::Body,
    http::{Method, Request},
    Router,
};
use std::net::SocketAddr;
use std::time::Duration;
use tower::ServiceExt;

#[tokio::test]
async fn test_tenant_isolation_findings() {
    // We can just use standard reqwest for testing against a running server.
    // I need to spawn the control plane API.
}
