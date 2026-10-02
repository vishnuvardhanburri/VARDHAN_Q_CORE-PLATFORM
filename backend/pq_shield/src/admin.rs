use crate::telemetry::{MetricsSnapshot, QuantumEvent};
use audit_ledger::LedgerEntry;
use axum::{
    extract::{Path, Request, State},
    http::header,
    http::StatusCode,
    middleware::{self, Next},
    response::sse::{Event, Sse},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use core_crypto::QuantumNodeIdentity;
use ha_cluster::{ClusterMembership, NodeId, NodeState, RaftNode};
use serde::Serialize;
use std::collections::VecDeque;
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;
use subtle::ConstantTimeEq;
use tokio::sync::broadcast;
use tokio::sync::RwLock;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;

pub trait ExecutionValidator: Send + Sync {
    fn validate_execution(&self, action_id: &str, authorization_id: &str)
        -> Result<String, String>;
}

#[derive(Clone)]
pub struct AdminState {
    pub metrics: Arc<RwLock<MetricsSnapshot>>,
    pub event_tx: broadcast::Sender<QuantumEvent>,
    pub history: Arc<RwLock<VecDeque<QuantumEvent>>>,
    /// True once the ring buffer has evicted at least one event.
    pub history_wrapped: Arc<std::sync::atomic::AtomicBool>,
    pub admin_token: String,
    /// Gateway identity — needed to sign the evidence export manifest.
    pub identity: Arc<QuantumNodeIdentity>,
    /// Path to the live ledger file, if configured.
    pub ledger_path: Option<PathBuf>,
    pub prometheus: Arc<crate::prometheus_metrics::PrometheusMetrics>,
    /// P3.4: Cluster membership for /cluster/peers endpoint.
    pub cluster: Option<Arc<ClusterMembership>>,
    /// P3.8: Raft consensus node for read-only status queries.
    pub raft_node: Option<Arc<RaftNode>>,
    /// P3.4: This node's stable cluster identity, for targeted drain.
    pub self_node_id: Option<NodeId>,
    /// Production authentication state
    pub auth_state: auth_service::AuthState,
    pub execution_validator: Option<Arc<dyn ExecutionValidator>>,
}

async fn auth_middleware(
    State(state): State<AdminState>,
    req: Request,
    next: Next,
) -> Result<axum::response::Response, StatusCode> {
    if req.method() == axum::http::Method::OPTIONS {
        return Ok(next.run(req).await);
    }

    // Public / unauthenticated endpoints
    let path = req.uri().path();
    if path == "/api/v1/auth/login" || path == "/metrics" {
        return Ok(next.run(req).await);
    }

    // Extract Bearer token from Authorization header or ?token= query param (SSE)
    let token_header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    // SEC-009: Rate limiting on all authenticated paths
    let ip = auth_service::resolve_ip(req.headers());
    if state.auth_state.rate_limiter.is_blocked(ip) {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }

    let token_query = req.uri().query().and_then(|q| {
        q.split('&').find_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            if parts.next() == Some("token") {
                parts.next().map(|v| v.to_string())
            } else {
                None
            }
        })
    });

    let token_str = match token_header.or(token_query) {
        Some(t) => t,
        None => return Err(StatusCode::UNAUTHORIZED),
    };

    // 1. Check active session in SessionStore (validated & sliding activity updated)
    let session_tok = auth_service::session::SessionToken::from_str(&token_str);
    if let Some(username) = state.auth_state.sessions.validate(&session_tok).await {
        let role = state
            .auth_state
            .credentials
            .get_profile(&username)
            .map(|p| auth_service::authorization::Role::from_str(&p.role))
            .unwrap_or(auth_service::authorization::Role::Admin);
        let mut req = req;
        req.extensions_mut()
            .insert(auth_service::authorization::AuthenticatedUser { username, role });
        return Ok(next.run(req).await);
    }

    // 2. Fallback: constant-time check against bootstrap admin token
    if !state.admin_token.is_empty()
        && token_str
            .as_bytes()
            .ct_eq(state.admin_token.as_bytes())
            .into()
    {
        let mut req = req;
        req.extensions_mut()
            .insert(auth_service::authorization::AuthenticatedUser {
                username: "bootstrap-admin".to_string(),
                role: auth_service::authorization::Role::Admin,
            });
        return Ok(next.run(req).await);
    }

    // 3. Check API key (starts with vq_live_)
    if token_str.starts_with("vq_live_") {
        if let Ok(Some(key_view)) = state.auth_state.credentials.verify_api_key(&token_str) {
            let mut req = req;
            req.extensions_mut()
                .insert(auth_service::authorization::AuthenticatedUser {
                    username: key_view.created_by,
                    role: auth_service::authorization::Role::Admin,
                });
            return Ok(next.run(req).await);
        }
    }

    // Authentication failed - record failure for rate limiting
    state.auth_state.rate_limiter.record_failure(ip);
    Err(StatusCode::UNAUTHORIZED)
}

pub async fn run_admin_server(state: AdminState) {
    let origins_str = std::env::var("VARDHAN_ADMIN_CORS_ORIGIN").expect(
        "FATAL: VARDHAN_ADMIN_CORS_ORIGIN must be explicitly set (e.g., 'null' for local files)",
    );

    let env = std::env::var("VARDHAN_ENV").unwrap_or_else(|_| "development".to_string());
    let cors_origin = if origins_str == "*" {
        if env == "production" {
            panic!("FATAL (SEC-006): VARDHAN_ADMIN_CORS_ORIGIN='*' is not allowed in production.");
        }
        AllowOrigin::any()
    } else {
        let origins: Vec<axum::http::HeaderValue> = origins_str
            .split(',')
            .filter_map(|s| s.trim().parse().ok())
            .collect();
        AllowOrigin::list(origins)
    };

    let cors = CorsLayer::new()
        .allow_origin(cors_origin)
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            axum::http::header::HeaderName::from_static("last-event-id"),
        ]);

    let app = build_admin_router(state).layer(cors);

    let admin_port = std::env::var("VARDHAN_ADMIN_PORT").unwrap_or_else(|_| "8081".to_string());
    let bind_addr = format!("0.0.0.0:{}", admin_port);
    let listener = tokio::net::TcpListener::bind(&bind_addr).await.unwrap();
    tracing::info!("Admin / Telemetry API running on http://{}", bind_addr);
    axum::serve(listener, app).await.unwrap();
}

pub fn build_admin_router(state: AdminState) -> Router {
    Router::new()
        .route("/metrics", get(prometheus_metrics))
        // Authentication endpoints
        .route("/api/v1/auth/login", post(login_handler))
        .route("/api/v1/auth/logout", post(logout_handler))
        .route("/api/v1/auth/session", get(session_info_handler))
        .route("/api/v1/metrics", get(get_metrics))
        .route("/api/v1/events", get(sse_handler))
        // P2: ledger endpoints
        .route("/api/v1/ledger/status", get(ledger_status))
        .route("/api/v1/ledger/export", get(ledger_export))
        .route(
            "/api/v1/ledger/verify",
            get(ledger_verify).post(ledger_verify),
        )
        // P3.4: cluster endpoints
        .route("/api/v1/cluster/peers", get(cluster_peers))
        .route("/api/v1/cluster/status", get(cluster_status))
        .route("/api/v1/raft/status", get(raft_status))
        .route("/api/v1/cluster/drain", post(cluster_drain))
        .route("/api/v1/security/crypto/status", get(crypto_status))
        // P3.5: region-aware cluster endpoints
        .route(
            "/api/v1/cluster/peers/region/{region}",
            get(cluster_peers_in_region),
        )
        // Priority 2: Admin profile & password endpoints
        .route(
            "/api/v1/admin/profile",
            get(admin_get_profile).put(admin_update_profile),
        )
        .route("/api/v1/admin/password", post(admin_change_password))
        // Priority 3: Settings endpoints
        .route(
            "/api/v1/settings",
            get(admin_get_settings).put(admin_update_settings),
        )
        // Priority 4.1 & 4.6: Session management endpoints
        .route("/api/v1/sessions", get(admin_list_sessions))
        .route(
            "/api/v1/sessions/{session_id}/revoke",
            post(admin_revoke_session),
        )
        .route("/api/v1/sessions/flush", post(admin_flush_sessions))
        // Priority 4.2: API key endpoints
        .route(
            "/api/v1/admin/api-keys",
            get(admin_list_api_keys).post(admin_create_api_key),
        )
        .route("/api/v1/admin/api-keys/{id}", delete(admin_revoke_api_key))
        // Priority 4.5: Emergency Reboot
        .route("/api/v1/cluster/reboot", post(cluster_reboot))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .layer(RequestBodyLimitLayer::new(1024 * 1024))
        .with_state(state)
}

async fn login_handler(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<auth_service::LoginRequest>,
) -> impl IntoResponse {
    auth_service::login_handler(State(state.auth_state), headers, Json(req)).await
}

async fn logout_handler(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    auth_service::logout_handler(State(state.auth_state), headers).await
}

async fn session_info_handler(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    auth_service::session_info_handler(State(state.auth_state), headers).await
}

async fn admin_get_profile(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    auth_service::get_profile_handler(State(state.auth_state), headers).await
}

async fn admin_update_profile(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<auth_service::UpdateProfileRequest>,
) -> impl IntoResponse {
    auth_service::update_profile_handler(State(state.auth_state), headers, Json(req)).await
}

async fn admin_change_password(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<auth_service::ChangePasswordRequest>,
) -> impl IntoResponse {
    auth_service::change_password_handler(State(state.auth_state), headers, Json(req)).await
}

async fn admin_get_settings(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    auth_service::get_settings_handler(State(state.auth_state), headers).await
}

async fn admin_update_settings(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<auth_service::UpdateSettingsRequest>,
) -> impl IntoResponse {
    auth_service::update_settings_handler(State(state.auth_state), headers, Json(req)).await
}

async fn admin_list_sessions(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    auth_service::list_sessions_handler(State(state.auth_state), headers).await
}

async fn admin_revoke_session(
    State(state): State<AdminState>,
    Path(session_id): Path<String>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    auth_service::revoke_session_handler(State(state.auth_state), Path(session_id), headers).await
}

async fn admin_flush_sessions(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
    body: Option<Json<auth_service::FlushSessionsRequest>>,
) -> impl IntoResponse {
    auth_service::flush_sessions_handler(State(state.auth_state), headers, body).await
}

async fn admin_list_api_keys(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    auth_service::list_api_keys_handler(State(state.auth_state), headers).await
}

async fn admin_create_api_key(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<auth_service::CreateApiKeyRequest>,
) -> impl IntoResponse {
    auth_service::create_api_key_handler(State(state.auth_state), headers, Json(req)).await
}

async fn admin_revoke_api_key(
    State(state): State<AdminState>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    auth_service::revoke_api_key_handler(State(state.auth_state), Path(id), headers).await
}

async fn prometheus_metrics(State(state): State<AdminState>) -> impl IntoResponse {
    let body = state.prometheus.encode();
    (
        StatusCode::OK,
        [(
            header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        body,
    )
}

#[derive(serde::Serialize)]
struct CryptoStatus {
    algorithm: String,
    state: String,
    detail: String,
}

async fn crypto_status() -> impl IntoResponse {
    let payload = vec![
        CryptoStatus {
            algorithm: "ML-KEM-1024".into(),
            state: "Active".into(),
            detail: "FIPS 203 - Quantum Safe Encapsulation".into(),
        },
        CryptoStatus {
            algorithm: "ML-DSA-87".into(),
            state: "Active".into(),
            detail: "FIPS 204 - Quantum Safe Signatures".into(),
        },
        CryptoStatus {
            algorithm: "AES-256-GCM".into(),
            state: "Active".into(),
            detail: "Authenticated Encryption".into(),
        },
        CryptoStatus {
            algorithm: "HKDF-SHA256".into(),
            state: "Active".into(),
            detail: "Session Key Derivation".into(),
        },
        CryptoStatus {
            algorithm: "BLAKE3".into(),
            state: "Active".into(),
            detail: "Fast Integrity Hashing".into(),
        },
    ];
    axum::Json(payload)
}

async fn get_metrics(State(state): State<AdminState>) -> impl IntoResponse {
    let m = state.metrics.read().await.clone();
    (StatusCode::OK, Json(m))
}

// ── P2: Ledger status endpoint ──────────────────────────────────────────────

#[derive(Serialize)]
struct LedgerStatus {
    configured: bool,
    ledger_file: Option<String>,
    entry_count_estimate: Option<u64>,
    message: &'static str,
}

async fn ledger_status(State(state): State<AdminState>) -> impl IntoResponse {
    match &state.ledger_path {
        None => Json(LedgerStatus {
            configured: false,
            ledger_file: None,
            entry_count_estimate: None,
            message: "VARDHAN_LEDGER_PATH not configured — durable ledger inactive",
        }),
        Some(path) => {
            // Count lines quickly without full parse
            let count = std::fs::read_to_string(path)
                .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count() as u64)
                .ok();
            Json(LedgerStatus {
                configured: true,
                ledger_file: Some(path.display().to_string()),
                entry_count_estimate: count,
                message: "Durable ledger active — ML-DSA-87 signed, BLAKE3 chained",
            })
        }
    }
}

// ── P2: Ledger verify endpoint ──────────────────────────────────────────────

#[derive(Serialize)]
struct LedgerVerification {
    chain_valid: bool,
    blocks_verified: u64,
    root_hash: String,
    signer_pub_fingerprint: String,
}

async fn ledger_verify(State(state): State<AdminState>) -> impl IntoResponse {
    let Some(ledger_path) = &state.ledger_path else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "chain_valid": false,
                "blocks_verified": 0,
                "root_hash": "0".repeat(64),
                "error": "Durable ledger not configured. Set VARDHAN_LEDGER_PATH and restart."
            })),
        )
            .into_response();
    };

    let content = match std::fs::read_to_string(ledger_path) {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "chain_valid": false,
                    "blocks_verified": 0,
                    "root_hash": "0".repeat(64),
                    "error": format!("Cannot read ledger: {e}")
                })),
            )
                .into_response();
        }
    };

    let mut chain_valid = true;
    let mut blocks_verified: u64 = 0;
    let mut prev_hash = [0u8; 32];
    let mut tip_hash = [0u8; 32];
    let mut signer_fp = String::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let entry: LedgerEntry = match serde_json::from_str(line) {
            Ok(e) => e,
            Err(_) => {
                chain_valid = false;
                continue;
            }
        };

        blocks_verified += 1;
        if blocks_verified == 1 {
            signer_fp = entry.signer_pub_fingerprint.clone();
        }

        // Verify chain linkage: prev_hash must match BLAKE3 of previous entry
        let expected_prev = hex::encode(prev_hash);
        if entry.prev_hash != expected_prev {
            chain_valid = false;
        }

        // Recompute canonical hash for next iteration
        let prev_hash_bytes = match hex::decode(&expected_prev) {
            Ok(b) if b.len() == 32 => {
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&b);
                arr
            }
            _ => [0u8; 32],
        };
        let canonical = audit_ledger::canonical_hash(
            entry.seq,
            entry.timestamp_ms,
            &serde_json::to_string(&entry.event).unwrap_or_default(),
            &prev_hash_bytes,
        );
        prev_hash = canonical;
        tip_hash = canonical;
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "chain_valid": chain_valid,
            "blocks_verified": blocks_verified,
            "root_hash": hex::encode(tip_hash),
            "signer_pub_fingerprint": signer_fp,
        })),
    )
        .into_response()
}

// ── P2: Evidence export endpoint ────────────────────────────────────────────

#[derive(Serialize)]
struct ExportManifest {
    schema_version: u32,
    export_timestamp_ms: u128,
    entry_count: u64,
    tip_hash: String,
    signer_pub_fingerprint: String,
    verifier_version: &'static str,
    /// ML-DSA-87 signature over `BLAKE3(export_timestamp_ms_le64 || entry_count_le64 || tip_hash_bytes32)`
    manifest_signature: String,
}

async fn ledger_export(State(state): State<AdminState>) -> axum::response::Response {
    let Some(ledger_path) = &state.ledger_path else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "Durable ledger not configured. Set VARDHAN_LEDGER_PATH and restart.",
        )
            .into_response();
    };

    // Determine export directory: VARDHAN_EXPORT_PATH / {timestamp_ms}
    let export_base =
        std::env::var("VARDHAN_EXPORT_PATH").unwrap_or_else(|_| "/tmp/vardhan_exports".to_string());
    let timestamp_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let export_dir = PathBuf::from(&export_base).join(format!("{timestamp_ms}"));

    if let Err(e) = std::fs::create_dir_all(&export_dir) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Cannot create export dir: {e}"),
        )
            .into_response();
    }

    // 1. Copy ledger file
    let dest_ledger = export_dir.join("ledger.jsonl");
    if let Err(e) = std::fs::copy(ledger_path, &dest_ledger) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Cannot copy ledger: {e}"),
        )
            .into_response();
    }

    // 2. Read all entries to get count and tip_hash
    let content = match std::fs::read_to_string(&dest_ledger) {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Cannot read ledger copy: {e}"),
            )
                .into_response()
        }
    };

    let mut entry_count = 0u64;
    let mut tip_hash = "0".repeat(64);

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<LedgerEntry>(line) {
            entry_count += 1;
            tip_hash = hex::encode(entry.canonical_hash().expect("Canonical hash failed"));
        }
    }

    // 3. Write public key
    let pub_key_bytes = state.identity.dsa_public_key_bytes();
    let pub_key_hex = hex::encode(&pub_key_bytes);
    let pub_key_path = export_dir.join("public_key.hex");
    if let Err(e) = std::fs::write(&pub_key_path, &pub_key_hex) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Cannot write public key: {e}"),
        )
            .into_response();
    }

    // 4. Write schema.json
    let schema_path = export_dir.join("schema.json");
    if let Err(e) = audit_ledger::schema::write_schema(&schema_path) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Cannot write schema: {e}"),
        )
            .into_response();
    }

    // 4.5 Write INSTRUCTIONS.md
    let instructions_path = export_dir.join("INSTRUCTIONS.md");
    let instructions = "# Offline Audit Verification\n\
This bundle contains a cryptographically sound, independently verifiable audit ledger.\n\
\n\
To verify the evidence offline:\n\
1. Ensure you have the `pq_verify` standalone binary.\n\
2. Run: `pq_verify --evidence-dir .`\n\
\n\
The verifier will check chain integrity (BLAKE3), sequence integrity, and all ML-DSA-87 signatures.\n";
    let _ = std::fs::write(&instructions_path, instructions);

    // 5. Build signed manifest
    let signer_pub_fingerprint = hex::encode(core_crypto::QuantumNodeIdentity::hash_ledger_block(
        &pub_key_bytes,
    ));
    let tip_hash_bytes = hex::decode(&tip_hash).unwrap_or_default();

    // Canonical manifest bytes for signing
    let mut manifest_canonical = Vec::with_capacity(8 + 8 + 32);
    manifest_canonical.extend_from_slice(&(timestamp_ms as u64).to_le_bytes());
    manifest_canonical.extend_from_slice(&entry_count.to_le_bytes());
    manifest_canonical.extend_from_slice(&tip_hash_bytes);
    let manifest_canonical_hash =
        core_crypto::QuantumNodeIdentity::hash_ledger_block(&manifest_canonical);

    let manifest_signature = match state.identity.sign_payload(&manifest_canonical_hash) {
        Ok(sig) => hex::encode(sig),
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Cannot sign manifest: {e}"),
            )
                .into_response()
        }
    };

    let manifest = ExportManifest {
        schema_version: 1,
        export_timestamp_ms: timestamp_ms,
        entry_count,
        tip_hash: tip_hash.clone(),
        signer_pub_fingerprint,
        verifier_version: "0.1.0",
        manifest_signature,
    };

    let manifest_path = export_dir.join("manifest.json");
    match serde_json::to_string_pretty(&manifest) {
        Ok(s) => {
            if let Err(e) = std::fs::write(&manifest_path, s) {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Cannot write manifest: {e}"),
                )
                    .into_response();
            }
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Cannot serialize manifest: {e}"),
            )
                .into_response()
        }
    }

    tracing::info!(
        export_dir = %export_dir.display(),
        entry_count,
        tip_hash = %&tip_hash[..16],
        "P2: Evidence bundle exported"
    );

    (StatusCode::OK, Json(serde_json::json!({
        "exported": true,
        "export_dir": export_dir.display().to_string(),
        "entry_count": entry_count,
        "tip_hash": tip_hash,
        "files": ["ledger.jsonl", "public_key.hex", "schema.json", "manifest.json", "INSTRUCTIONS.md"]
    }))).into_response()
}

// ── SSE handler (unchanged P1 logic) ────────────────────────────────────────

type SseResponse = axum::response::Response;

async fn sse_handler(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
) -> SseResponse {
    let last_event_id = headers
        .get("Last-Event-ID")
        .and_then(|h| h.to_str().ok().map(|s| s.to_string()));

    let history = state.history.read().await;
    let rx = state.event_tx.subscribe();

    let stream: Box<dyn tokio_stream::Stream<Item = Result<Event, Infallible>> + Send + Unpin>;

    if let Some(last_id) = last_event_id {
        let mut found = false;
        let mut replay_events = Vec::new();
        for ev in history.iter() {
            if found {
                replay_events.push(ev.clone());
            } else if ev.event_id == last_id {
                found = true;
            }
        }
        drop(history);

        if !found {
            let wrapped = state
                .history_wrapped
                .load(std::sync::atomic::Ordering::Relaxed);
            if wrapped {
                return (
                    StatusCode::GONE,
                    "Last-Event-ID has expired from the replay buffer. Full resync required.",
                )
                    .into_response();
            }
        }

        let replay_stream = tokio_stream::iter(replay_events.into_iter().map(|evt| {
            let data = serde_json::to_string(&evt).unwrap();
            Ok::<Event, Infallible>(Event::default().id(evt.event_id).data(data))
        }));
        let live_stream = BroadcastStream::new(rx).filter_map(|res| match res {
            Ok(evt) => {
                let data = serde_json::to_string(&evt).unwrap();
                Some(Ok(Event::default().id(evt.event_id.clone()).data(data)))
            }
            Err(_) => None,
        });
        stream = Box::new(Box::pin(replay_stream.chain(live_stream)));
    } else {
        drop(history);
        let live_stream = BroadcastStream::new(rx).filter_map(|res| match res {
            Ok(evt) => {
                let data = serde_json::to_string(&evt).unwrap();
                Some(Ok(Event::default().id(evt.event_id.clone()).data(data)))
            }
            Err(_) => None,
        });
        stream = Box::new(Box::pin(live_stream));
    }

    Sse::new(stream)
        .keep_alive(axum::response::sse::KeepAlive::new())
        .into_response()
}

// ── P3.4 Cluster endpoints ────────────────────────────────────────────────────

/// GET /api/v1/cluster/peers — Returns all known cluster nodes with their state.
async fn cluster_peers(State(state): State<AdminState>) -> impl IntoResponse {
    match &state.cluster {
        Some(cluster) => {
            let peers = cluster.peer_snapshot().await;
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "node_count": peers.len(),
                    "nodes": peers,
                })),
            )
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "HA cluster not configured on this node"
            })),
        ),
    }
}

/// P3.5: GET /api/v1/cluster/peers/region/:region — Returns nodes in a specific region.
async fn cluster_peers_in_region(
    State(state): State<AdminState>,
    axum::extract::Path(region): axum::extract::Path<String>,
) -> impl IntoResponse {
    match &state.cluster {
        Some(cluster) => {
            let peers = cluster.nodes_in_region(&region).await;
            let nodes: Vec<serde_json::Value> = peers
                .iter()
                .map(|n| {
                    serde_json::json!({
                        "node_id": n.node_id.as_str(),
                        "addr": n.addr.to_string(),
                        "state": n.state.to_string(),
                        "last_seen_ms": n.last_seen_ms,
                        "region": n.region.as_str(),
                    })
                })
                .collect();
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "region": region,
                    "node_count": nodes.len(),
                    "nodes": nodes,
                })),
            )
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "HA cluster not configured on this node"
            })),
        ),
    }
}
/// Cluster status endpoint: aggregates node states, computes leader, and
/// returns a high-level operational view for the frontend dashboard.
async fn cluster_status(State(state): State<AdminState>) -> impl IntoResponse {
    match &state.cluster {
        Some(cluster) => {
            let nodes = cluster.all_nodes().await;
            let healthy: Vec<_> = nodes
                .iter()
                .filter(|n| n.state == ha_cluster::NodeState::Healthy)
                .cloned()
                .collect();
            let draining: Vec<_> = nodes
                .iter()
                .filter(|n| n.state == ha_cluster::NodeState::Draining)
                .cloned()
                .collect();
            let dead: Vec<_> = nodes
                .iter()
                .filter(|n| n.state == ha_cluster::NodeState::Dead)
                .cloned()
                .collect();
            let leader = ha_cluster::election::compute_leader(cluster).await;

            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "node_count": nodes.len(),
                    "healthy_count": healthy.len(),
                    "draining_count": draining.len(),
                    "dead_count": dead.len(),
                    "leader": leader.as_ref().map(|n| n.as_str()),
                    "healthy_nodes": healthy.iter().map(|n| serde_json::json!({
                        "node_id": n.node_id.as_str(),
                        "addr": n.addr.to_string(),
                        "region": n.region.as_str(),
                        "state": n.state.to_string(),
                        "last_seen_ms": n.last_seen_ms,
                        "term": n.term,
                    })).collect::<Vec<_>>(),
                })),
            )
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "HA cluster not configured on this node"
            })),
        ),
    }
}

/// GET /api/v1/raft/status — Read-only snapshot of the Raft consensus node.
/// Uses RaftNode::raft_status() which acquires read locks on all fields
/// and returns a consistent snapshot. Does NOT expose private keys,
/// KMS secrets, or cryptographic material.
async fn raft_status(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let caller = match auth_service::extract_authenticated_user(&state.auth_state, &headers).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Unauthorized" })),
            )
        }
    };

    if !caller.can(auth_service::authorization::Permission::ReadDashboard) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden: Requires Operator or Admin role" })),
        );
    }

    match &state.raft_node {
        Some(raft_node) => {
            // Get configured peer count from cluster membership
            let peer_count = if let Some(cluster) = &state.cluster {
                cluster.all_nodes().await.len()
            } else {
                0
            };
            // raft_status takes peer IDs — pass the peer count for reporting
            let peer_ids: Vec<NodeId> = (0..peer_count)
                .map(|i| NodeId::new(format!("peer-{}", i)))
                .collect();
            let status = raft_node.raft_status(&peer_ids).await;
            (StatusCode::OK, Json(serde_json::to_value(status).unwrap()))
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "Raft node not configured on this node",
                "message": "HA cluster Raft consensus is not initialized on this node."
            })),
        ),
    }
}

/// The actual drain wait is handled by DrainController in main.rs on SIGTERM.
/// This endpoint is a soft-drain signal for orchestrators that prefer HTTP over SIGTERM.
async fn cluster_drain(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let caller = match auth_service::extract_authenticated_user(&state.auth_state, &headers).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Unauthorized" })),
            )
        }
    };

    let req_id = auth_service::extract_request_id(&headers);
    let node_id = state.auth_state.node_id.as_deref().unwrap_or("local-node");

    // 1. Authorization check: requires DrainCluster permission (Operator or Admin)
    if !caller.can(auth_service::authorization::Permission::DrainCluster) {
        auth_service::emit_admin_audit(
            state.auth_state.ledger.as_ref(),
            state.auth_state.identity.as_ref(),
            node_id,
            "AdministrativeOperationFailed",
            &caller.username,
            "forbidden",
            req_id.as_deref(),
            serde_json::json!({ "operation": "ClusterDrain" }),
        );
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Forbidden: Operator or Admin privilege required to drain cluster node"
            })),
        );
    }

    match (&state.cluster, &state.self_node_id) {
        (Some(cluster), Some(self_id)) => {
            let nodes = cluster.all_nodes().await;
            // Find THIS node in the membership table by our stable node_id.
            let self_entry = nodes.iter().find(|n| &n.node_id == self_id);
            match self_entry {
                Some(node) if matches!(node.state, NodeState::Dead) => {
                    auth_service::emit_admin_audit(
                        state.auth_state.ledger.as_ref(),
                        state.auth_state.identity.as_ref(),
                        node_id,
                        "AdministrativeOperationFailed",
                        &caller.username,
                        "invalid_state",
                        req_id.as_deref(),
                        serde_json::json!({ "operation": "ClusterDrain", "reason": "node_is_dead" }),
                    );
                    (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({
                            "error": "Cannot drain a dead node",
                            "node_id": self_id.as_str(),
                            "status": "dead"
                        })),
                    )
                }
                Some(node) if matches!(node.state, NodeState::Draining) => (
                    StatusCode::CONFLICT,
                    Json(serde_json::json!({
                        "error": "Node is already draining",
                        "node_id": self_id.as_str(),
                        "status": "draining"
                    })),
                ),
                Some(_) | None => {
                    auth_service::emit_admin_audit(
                        state.auth_state.ledger.as_ref(),
                        state.auth_state.identity.as_ref(),
                        node_id,
                        "ClusterDrainRequested",
                        &caller.username,
                        "success",
                        req_id.as_deref(),
                        serde_json::json!({ "node_id": self_id.as_str() }),
                    );

                    let _ = cluster.mark_draining(self_id).await;
                    tracing::warn!(node_id = %self_id, actor = %caller.username, "Admin-initiated drain via /cluster/drain");

                    auth_service::emit_admin_audit(
                        state.auth_state.ledger.as_ref(),
                        state.auth_state.identity.as_ref(),
                        node_id,
                        "ClusterDrainCompleted",
                        &caller.username,
                        "success",
                        req_id.as_deref(),
                        serde_json::json!({ "node_id": self_id.as_str(), "status": "draining" }),
                    );

                    (
                        StatusCode::OK,
                        Json(serde_json::json!({
                            "status": "draining",
                            "node_id": self_id.as_str(),
                            "message": "Node successfully marked Draining. Active sessions will finish; new sessions will not be accepted."
                        })),
                    )
                }
            }
        }
        (Some(_), None) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "HA cluster configured but node identity (VARDHAN_NODE_ID) is unknown"
            })),
        ),
        (None, _) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "HA cluster not configured on this node"
            })),
        ),
    }
}

#[derive(serde::Deserialize, Default)]
struct RebootRequest {
    #[serde(default)]
    confirm: bool,
    reason: Option<String>,
}

async fn cluster_reboot(
    State(state): State<AdminState>,
    headers: axum::http::HeaderMap,
    body: Option<Json<RebootRequest>>,
) -> impl IntoResponse {
    let caller = match auth_service::extract_authenticated_user(&state.auth_state, &headers).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Unauthorized" })),
            )
        }
    };

    let req_id = auth_service::extract_request_id(&headers);
    let node_id = state.auth_state.node_id.as_deref().unwrap_or("local-node");

    // 1. Authorization: Admin only
    if !caller.can(auth_service::authorization::Permission::RebootCluster) {
        auth_service::emit_admin_audit(
            state.auth_state.ledger.as_ref(),
            state.auth_state.identity.as_ref(),
            node_id,
            "AdministrativeOperationFailed",
            &caller.username,
            "forbidden",
            req_id.as_deref(),
            serde_json::json!({ "operation": "ClusterReboot" }),
        );
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Forbidden: Admin privilege required for emergency reboot"
            })),
        );
    }

    // 2. Confirmation check
    let is_confirmed = body.as_ref().map(|b| b.confirm).unwrap_or(false)
        || headers
            .get("x-confirm")
            .and_then(|h| h.to_str().ok())
            .map(|v| v.eq_ignore_ascii_case("reboot") || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);

    if !is_confirmed {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Emergency reboot requires explicit confirmation ({ 'confirm': true } or X-Confirm: reboot)"
            })),
        );
    }

    let reason = body
        .and_then(|b| b.reason.clone())
        .unwrap_or_else(|| "Operator initiated".to_string());

    // 3. Audit before operation
    auth_service::emit_admin_audit(
        state.auth_state.ledger.as_ref(),
        state.auth_state.identity.as_ref(),
        node_id,
        "ClusterRebootRequested",
        &caller.username,
        "initiated",
        req_id.as_deref(),
        serde_json::json!({ "node_id": node_id, "reason": reason }),
    );

    // 4. Soft-drain node first if cluster is available
    if let (Some(cluster), Some(self_id)) = (&state.cluster, &state.self_node_id) {
        let _ = cluster.mark_draining(self_id).await;
    }

    // 5. Honest response as required by Priority 4.5
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({
            "status": "draining",
            "node_id": node_id,
            "error": "In-process host reboot is disabled for security isolation. Node has been placed in Draining state; please issue host restart via cluster orchestrator.",
            "orchestrator_guidance": "systemctl restart vardhan-node || kubectl rollout restart daemonset/vardhan-quantum",
            "audit_status": "ClusterRebootRequested logged to immutable ledger"
        })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use tokio::sync::broadcast;

    async fn spawn_test_admin() -> (String, AdminState, tempfile::TempDir) {
        struct MockValidator;
        impl super::ExecutionValidator for MockValidator {
            fn validate_execution(&self, _a: &str, _b: &str) -> Result<String, String> {
                Ok("ok".into())
            }
        }
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("auth_db");
        let cred_store = auth_service::store::CredentialStore::open(&db_path).unwrap();
        let phc = auth_service::credentials::hash_password("admin_pass_12345").unwrap();
        cred_store.set_phc_sync("admin", &phc).unwrap();

        let identity = Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap());
        let prometheus = Arc::new(crate::prometheus_metrics::PrometheusMetrics::new().unwrap());
        let (tx, _rx) = broadcast::channel(16);

        let ledger_path = dir.path().join("test_ledger.jsonl");
        let ledger_writer =
            Arc::new(audit_ledger::LedgerWriter::open(&ledger_path, &identity).unwrap());

        let cluster = Arc::new(ClusterMembership::new());
        let self_id = NodeId::new("test-node-1");
        cluster
            .register_self(self_id.clone(), "127.0.0.1:8080".parse().unwrap(), 8081)
            .await;

        let auth_state = auth_service::AuthState {
            credentials: Arc::new(cred_store),
            sessions: Arc::new(auth_service::session::SessionStore::new()),
            rate_limiter: Arc::new(auth_service::rate_limit::RateLimiter::new()),
            ledger: Some(ledger_writer),
            identity: Some(identity.clone()),
            node_id: Some("test-node-1".to_string()),
            admin_token: Some("test-bootstrap-admin-token".to_string()),
        };

        let admin_state = AdminState {
            metrics: Arc::new(RwLock::new(MetricsSnapshot {
                active_sessions: 0,
                successful_handshakes: 0,
                rejected_frames: 0,
                upstream_failures: 0,
                requests_per_sec: 0,
                handshakes_per_sec: 0,
                latency_p50_us: 0,
                latency_p95_us: 0,
                latency_p99_us: 0,
                kem_entropy: 0.0,
                nonce_entropy: 0.0,
                sample_window_size: 1024,
            })),
            event_tx: tx,
            history: Arc::new(RwLock::new(VecDeque::new())),
            history_wrapped: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            admin_token: "test-bootstrap-admin-token".to_string(),
            identity,
            ledger_path: Some(ledger_path),
            prometheus,
            cluster: Some(cluster),
            raft_node: None,
            self_node_id: Some(self_id),
            auth_state,
            execution_validator: Some(Arc::new(MockValidator)),
        };

        let app = build_admin_router(admin_state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        (format!("http://{}", addr), admin_state, dir)
    }

    #[tokio::test]
    async fn test_admin_auth_via_login_session() {
        let (base_url, _state, _dir) = spawn_test_admin().await;
        let client = reqwest::Client::new();

        // 1. Unauthenticated request to metrics is rejected
        let res = client
            .get(format!("{}/api/v1/metrics", base_url))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::UNAUTHORIZED);

        // 2. Login through /api/v1/auth/login
        let login_res = client
            .post(format!("{}/api/v1/auth/login", base_url))
            .json(&serde_json::json!({
                "username": "admin",
                "password": "admin_pass_12345"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(login_res.status(), reqwest::StatusCode::OK);
        let login_body: serde_json::Value = login_res.json().await.unwrap();
        let token = login_body["token"].as_str().unwrap();

        // 3. Authenticated request to /api/v1/metrics with session token succeeds
        let metrics_res = client
            .get(format!("{}/api/v1/metrics", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .unwrap();
        assert_eq!(metrics_res.status(), reqwest::StatusCode::OK);

        // 4. Logout revokes the session
        let logout_res = client
            .post(format!("{}/api/v1/auth/logout", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .unwrap();
        assert_eq!(logout_res.status(), reqwest::StatusCode::OK);

        // 5. Subsequent request with revoked token is rejected
        let post_logout = client
            .get(format!("{}/api/v1/metrics", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .unwrap();
        assert_eq!(post_logout.status(), reqwest::StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_admin_auth_via_bootstrap_admin_token() {
        let (base_url, state, _dir) = spawn_test_admin().await;
        let client = reqwest::Client::new();

        let res = client
            .get(format!("{}/api/v1/metrics", base_url))
            .header("Authorization", format!("Bearer {}", state.admin_token))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::OK);
    }

    #[tokio::test]
    async fn test_admin_metrics_prometheus_public() {
        let (base_url, _state, _dir) = spawn_test_admin().await;
        let client = reqwest::Client::new();

        let res = client
            .get(format!("{}/metrics", base_url))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::OK);
    }

    #[tokio::test]
    async fn test_admin_profile_and_password_lifecycle() {
        let (base_url, _state, _dir) = spawn_test_admin().await;
        let client = reqwest::Client::new();

        // 1. Login
        let login_res = client
            .post(format!("{}/api/v1/auth/login", base_url))
            .json(&serde_json::json!({
                "username": "admin",
                "password": "admin_pass_12345"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(login_res.status(), reqwest::StatusCode::OK);
        let token = login_res.json::<serde_json::Value>().await.unwrap()["token"]
            .as_str()
            .unwrap()
            .to_string();

        // 2. GET Profile
        let prof_res = client
            .get(format!("{}/api/v1/admin/profile", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .unwrap();
        assert_eq!(prof_res.status(), reqwest::StatusCode::OK);
        let profile: serde_json::Value = prof_res.json().await.unwrap();
        assert_eq!(profile["username"], "admin");
        assert_eq!(profile["role"], "ciso_admin");

        // 3. PUT Profile update
        let update_res = client
            .put(format!("{}/api/v1/admin/profile", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({
                "display_name": "Lead Cryptographer",
                "email": "lead@vardhan.quantum"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(update_res.status(), reqwest::StatusCode::OK);
        let updated_profile: serde_json::Value = update_res.json().await.unwrap();
        assert_eq!(updated_profile["display_name"], "Lead Cryptographer");
        assert_eq!(updated_profile["email"], "lead@vardhan.quantum");

        // 4. Change Password
        let change_pw_res = client
            .post(format!("{}/api/v1/admin/password", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({
                "current_password": "admin_pass_12345",
                "new_password": "quantum_pass_secure_987",
                "confirm_password": "quantum_pass_secure_987"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(change_pw_res.status(), reqwest::StatusCode::OK);

        // 5. Verify old password fails
        let old_login_res = client
            .post(format!("{}/api/v1/auth/login", base_url))
            .json(&serde_json::json!({
                "username": "admin",
                "password": "admin_pass_12345"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(old_login_res.status(), reqwest::StatusCode::UNAUTHORIZED);

        // 6. Verify new password succeeds
        let new_login_res = client
            .post(format!("{}/api/v1/auth/login", base_url))
            .json(&serde_json::json!({
                "username": "admin",
                "password": "quantum_pass_secure_987"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(new_login_res.status(), reqwest::StatusCode::OK);
    }

    #[tokio::test]
    async fn test_admin_settings_get_update_and_immutability() {
        let (base_url, _state, _dir) = spawn_test_admin().await;
        let client = reqwest::Client::new();

        // Login
        let login_res = client
            .post(format!("{}/api/v1/auth/login", base_url))
            .json(&serde_json::json!({
                "username": "admin",
                "password": "admin_pass_12345"
            }))
            .send()
            .await
            .unwrap();
        let token = login_res.json::<serde_json::Value>().await.unwrap()["token"]
            .as_str()
            .unwrap()
            .to_string();

        // 1. GET Settings
        let get_res = client
            .get(format!("{}/api/v1/settings", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .unwrap();
        assert_eq!(get_res.status(), reqwest::StatusCode::OK);
        let settings: serde_json::Value = get_res.json().await.unwrap();
        assert_eq!(
            settings["cryptographic_identity"]["kem_algorithm"],
            "ML-KEM-1024"
        );
        assert_eq!(
            settings["cryptographic_identity"]["dsa_algorithm"],
            "ML-DSA-87"
        );

        // 2. PUT valid settings update
        let update_res = client
            .put(format!("{}/api/v1/settings", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({
                "user_settings": {
                    "theme": "cyberpunk",
                    "refresh_interval_secs": 15
                },
                "system_settings": {
                    "log_level": "debug"
                }
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(update_res.status(), reqwest::StatusCode::OK);
        let updated: serde_json::Value = update_res.json().await.unwrap();
        assert_eq!(updated["user_settings"]["theme"], "cyberpunk");
        assert_eq!(updated["user_settings"]["refresh_interval_secs"], 15);
        assert_eq!(updated["system_settings"]["log_level"], "debug");

        // 3. PUT illegal modification of immutable cryptographic identity
        let illegal_res = client
            .put(format!("{}/api/v1/settings", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({
                "cryptographic_identity": {
                    "kem_algorithm": "RSA2048"
                }
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(illegal_res.status(), reqwest::StatusCode::BAD_REQUEST);
        let err_body: serde_json::Value = illegal_res.json().await.unwrap();
        assert!(err_body["error"].as_str().unwrap().contains("immutable"));
    }

    #[tokio::test]
    async fn test_admin_session_management_and_flush() {
        let (base_url, _state, _dir) = spawn_test_admin().await;
        let client = reqwest::Client::new();

        // 1. Unauthenticated /api/v1/sessions returns 401
        let unauth = client
            .get(format!("{}/api/v1/sessions", base_url))
            .send()
            .await
            .unwrap();
        assert_eq!(unauth.status(), reqwest::StatusCode::UNAUTHORIZED);

        // 2. Login as admin (Session A)
        let login_res = client
            .post(format!("{}/api/v1/auth/login", base_url))
            .json(&serde_json::json!({
                "username": "admin",
                "password": "admin_pass_12345"
            }))
            .send()
            .await
            .unwrap();
        let token_a = login_res.json::<serde_json::Value>().await.unwrap()["token"]
            .as_str()
            .unwrap()
            .to_string();

        // 3. Login again (Session B)
        let login_b_res = client
            .post(format!("{}/api/v1/auth/login", base_url))
            .json(&serde_json::json!({
                "username": "admin",
                "password": "admin_pass_12345"
            }))
            .send()
            .await
            .unwrap();
        let token_b = login_b_res.json::<serde_json::Value>().await.unwrap()["token"]
            .as_str()
            .unwrap()
            .to_string();

        // 4. GET /api/v1/sessions — returns 2 sessions with safe metadata
        let list_res = client
            .get(format!("{}/api/v1/sessions", base_url))
            .header("Authorization", format!("Bearer {}", token_a))
            .send()
            .await
            .unwrap();
        assert_eq!(list_res.status(), reqwest::StatusCode::OK);
        let sessions: Vec<serde_json::Value> = list_res.json().await.unwrap();
        assert_eq!(sessions.len(), 2);
        for s in &sessions {
            assert!(s["session_id"].as_str().unwrap().starts_with("sess_"));
            assert_eq!(s["session_state"], "active");
            assert_eq!(s["username"], "admin");
            // Tokens and passwords MUST NOT be present in safe view
            assert!(s.get("token").is_none());
            assert!(s.get("password").is_none());
        }

        // 5. Revoke Session B by safe session_id
        let sess_b_id = sessions[0]["session_id"].as_str().unwrap();
        let revoke_res = client
            .post(format!("{}/api/v1/sessions/{}/revoke", base_url, sess_b_id))
            .header("Authorization", format!("Bearer {}", token_a))
            .send()
            .await
            .unwrap();
        assert_eq!(revoke_res.status(), reqwest::StatusCode::OK);
        let revoke_body: serde_json::Value = revoke_res.json().await.unwrap();
        assert_eq!(revoke_body["status"], "revoked");

        // Idempotent repeat revocation returns OK
        let repeat_revoke = client
            .post(format!("{}/api/v1/sessions/{}/revoke", base_url, sess_b_id))
            .header("Authorization", format!("Bearer {}", token_a))
            .send()
            .await
            .unwrap();
        assert_eq!(repeat_revoke.status(), reqwest::StatusCode::OK);

        // 6. Test Flush Sessions without confirm -> 400
        let unconf_flush = client
            .post(format!("{}/api/v1/sessions/flush", base_url))
            .header("Authorization", format!("Bearer {}", token_a))
            .json(&serde_json::json!({ "confirm": false }))
            .send()
            .await
            .unwrap();
        assert_eq!(unconf_flush.status(), reqwest::StatusCode::BAD_REQUEST);

        // 7. Confirmed flush preserves caller Session A
        let conf_flush = client
            .post(format!("{}/api/v1/sessions/flush", base_url))
            .header("Authorization", format!("Bearer {}", token_a))
            .json(&serde_json::json!({ "confirm": true }))
            .send()
            .await
            .unwrap();
        assert_eq!(conf_flush.status(), reqwest::StatusCode::OK);
        let flush_body: serde_json::Value = conf_flush.json().await.unwrap();
        assert_eq!(flush_body["status"], "flushed");

        // Session A is still valid
        let test_a = client
            .get(format!("{}/api/v1/settings", base_url))
            .header("Authorization", format!("Bearer {}", token_a))
            .send()
            .await
            .unwrap();
        assert_eq!(test_a.status(), reqwest::StatusCode::OK);

        // Session B was flushed and is unauthorized
        let test_b = client
            .get(format!("{}/api/v1/settings", base_url))
            .header("Authorization", format!("Bearer {}", token_b))
            .send()
            .await
            .unwrap();
        assert_eq!(test_b.status(), reqwest::StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_admin_api_key_lifecycle() {
        let (base_url, _state, _dir) = spawn_test_admin().await;
        let client = reqwest::Client::new();

        // Login as admin
        let login_res = client
            .post(format!("{}/api/v1/auth/login", base_url))
            .json(&serde_json::json!({
                "username": "admin",
                "password": "admin_pass_12345"
            }))
            .send()
            .await
            .unwrap();
        let token = login_res.json::<serde_json::Value>().await.unwrap()["token"]
            .as_str()
            .unwrap()
            .to_string();

        // 1. Create API key
        let create_res = client
            .post(format!("{}/api/v1/admin/api-keys", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({
                "name": "Integration-Bot",
                "expires_in_days": 30
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(create_res.status(), reqwest::StatusCode::CREATED);
        let created_key: serde_json::Value = create_res.json().await.unwrap();
        let key_id = created_key["id"].as_str().unwrap().to_string();
        let secret = created_key["secret"].as_str().unwrap().to_string();
        assert!(key_id.starts_with("ak_"));
        assert!(secret.starts_with("vq_live_"));

        // 2. GET API keys — secret MUST NOT appear in list
        let list_res = client
            .get(format!("{}/api/v1/admin/api-keys", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .unwrap();
        assert_eq!(list_res.status(), reqwest::StatusCode::OK);
        let keys: Vec<serde_json::Value> = list_res.json().await.unwrap();
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0]["id"], key_id);
        assert_eq!(keys[0]["name"], "Integration-Bot");
        assert!(keys[0].get("secret").is_none());
        assert!(!keys[0]["revoked"].as_bool().unwrap());

        // 3. Authenticate with the API key secret — succeeds!
        let api_key_res = client
            .get(format!("{}/api/v1/settings", base_url))
            .header("Authorization", format!("Bearer {}", secret))
            .send()
            .await
            .unwrap();
        assert_eq!(api_key_res.status(), reqwest::StatusCode::OK);

        // 4. Revoke API key
        let delete_res = client
            .delete(format!("{}/api/v1/admin/api-keys/{}", base_url, key_id))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .unwrap();
        assert_eq!(delete_res.status(), reqwest::StatusCode::OK);
        let revoked_key: serde_json::Value = delete_res.json().await.unwrap();
        assert!(revoked_key["revoked"].as_bool().unwrap());

        // 5. Subsequent authentication with revoked API key is rejected (401)
        let rejected_res = client
            .get(format!("{}/api/v1/settings", base_url))
            .header("Authorization", format!("Bearer {}", secret))
            .send()
            .await
            .unwrap();
        assert_eq!(rejected_res.status(), reqwest::StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_hardened_cluster_drain_and_reboot() {
        let (base_url, state, _dir) = spawn_test_admin().await;
        let client = reqwest::Client::new();

        // 1. Unauthenticated drain -> 401
        let unauth_drain = client
            .post(format!("{}/api/v1/cluster/drain", base_url))
            .send()
            .await
            .unwrap();
        assert_eq!(unauth_drain.status(), reqwest::StatusCode::UNAUTHORIZED);

        // Login as admin
        let login_res = client
            .post(format!("{}/api/v1/auth/login", base_url))
            .json(&serde_json::json!({
                "username": "admin",
                "password": "admin_pass_12345"
            }))
            .send()
            .await
            .unwrap();
        let token = login_res.json::<serde_json::Value>().await.unwrap()["token"]
            .as_str()
            .unwrap()
            .to_string();

        // 2. First drain -> 200 OK
        let drain_res = client
            .post(format!("{}/api/v1/cluster/drain", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .unwrap();
        assert_eq!(drain_res.status(), reqwest::StatusCode::OK);
        let drain_body: serde_json::Value = drain_res.json().await.unwrap();
        assert_eq!(drain_body["status"], "draining");

        // 3. Repeated drain -> 409 CONFLICT ("already draining")
        let repeat_drain = client
            .post(format!("{}/api/v1/cluster/drain", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .unwrap();
        assert_eq!(repeat_drain.status(), reqwest::StatusCode::CONFLICT);

        // 4. Reboot without confirm -> 400 Bad Request
        let unconf_reboot = client
            .post(format!("{}/api/v1/cluster/reboot", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({ "confirm": false }))
            .send()
            .await
            .unwrap();
        assert_eq!(unconf_reboot.status(), reqwest::StatusCode::BAD_REQUEST);

        // 5. Reboot with confirm -> 501 Not Implemented (honest response with guidance)
        let conf_reboot = client
            .post(format!("{}/api/v1/cluster/reboot", base_url))
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({ "confirm": true, "reason": "Scheduled node maintenance" }))
            .send()
            .await
            .unwrap();
        assert_eq!(conf_reboot.status(), reqwest::StatusCode::NOT_IMPLEMENTED);
        let reboot_body: serde_json::Value = conf_reboot.json().await.unwrap();
        assert!(reboot_body["orchestrator_guidance"]
            .as_str()
            .unwrap()
            .contains("systemctl"));

        // 6. Verify audit ledger has durable entries
        let ledger_path = state.ledger_path.unwrap();
        let content = std::fs::read_to_string(ledger_path).unwrap();
        assert!(content.contains("ClusterDrainRequested"));
        assert!(content.contains("ClusterDrainCompleted"));
        assert!(content.contains("ClusterRebootRequested"));
    }
}
