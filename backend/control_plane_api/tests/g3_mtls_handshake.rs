//! G3 mTLS client-certificate handshake acceptance tests.
//!
//! Proves, against the REAL rustls 0.21 `ServerConfig` construction used by
//! [`control_plane_api::build_server_config`] (the same helper `serve()`
//! calls), that:
//!   1. a client presenting a certificate chained to the configured CA gets
//!      `200 OK` from `/api/v1/platform/health` with
//!      `"client_auth": "mtls_required"`;
//!   2. a client presenting a certificate from an UNTRUSTED (rogue) CA is
//!      rejected at the TLS handshake (connection error, never HTTP);
//!   3. a client presenting NO certificate is rejected at the handshake.
//!
//! All PKI material is generated at test runtime with the `openssl` CLI into
//! a unique `/tmp` directory (0600 file permissions) and never checked in.

#![cfg(feature = "tls")]

use auth_service::{session::SessionStore, store::CredentialStore, AuthState};
use control_plane_api::{build_server_config, router, ControlPlaneState};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tower_http::cors::CorsLayer;

/// Throwaway PKI paths for one test run.
struct Pki {
    dir: PathBuf,
    ca_pem: Vec<u8>,
    server_cert: PathBuf,
    server_key: PathBuf,
    client_identity_pem: Vec<u8>,
    rogue_identity_pem: Vec<u8>,
}

fn run_openssl(dir: &Path, args: &[&str]) {
    let status = Command::new("openssl")
        .args(args)
        .current_dir(dir)
        .status()
        .expect("openssl CLI must be installed for G3 mTLS tests");
    assert!(
        status.success(),
        "openssl {args:?} failed with status {status}"
    );
}

/// Generate test CA + server cert (SAN 127.0.0.1) + good client cert +
/// rogue CA + rogue client cert. Key files get 0600 permissions.
fn generate_pki(tag: &str) -> Pki {
    let dir =
        std::env::temp_dir().join(format!("g3_mtls_{}_{}", tag, uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).expect("create G3 temp dir");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
            .expect("chmod 0700 G3 temp dir");
    }

    // (1) Trusted client-CA (self-signed), also pins the server cert chain.
    run_openssl(
        &dir,
        &[
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            "ca.key",
            "-out",
            "ca.pem",
            "-days",
            "1",
            "-subj",
            "/CN=g3-test-client-ca",
        ],
    );
    // (2) Server key + CSR, then sign with SAN 127.0.0.1 so hostname
    // verification passes for https://127.0.0.1 without test-only bypasses.
    run_openssl(
        &dir,
        &[
            "req",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            "server.key",
            "-out",
            "server.csr",
            "-subj",
            "/CN=127.0.0.1",
        ],
    );
    // OpenSSL 4.x stamps restrictive default extensions on `x509 -req`
    // output, so pin EKUs explicitly: serverAuth for the server cert (else
    // the rustls client rejects it with EkuError), clientAuth for client
    // certs (else the server's webpki check rejects them the same way).
    // SAN 127.0.0.1 keeps hostname verification passing for
    // https://127.0.0.1 without test-only bypasses.
    std::fs::write(
        dir.join("server.ext"),
        "subjectAltName=IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth\n",
    )
    .expect("write server.ext");
    // Client certs must carry the clientAuth EKU or rustls-webpki rejects
    // them with EkuError (openssl may otherwise stamp a serverAuth-only EKU).
    std::fs::write(dir.join("client.ext"), "extendedKeyUsage=clientAuth\n")
        .expect("write client.ext");
    run_openssl(
        &dir,
        &[
            "x509",
            "-req",
            "-in",
            "server.csr",
            "-CA",
            "ca.pem",
            "-CAkey",
            "ca.key",
            "-CAcreateserial",
            "-out",
            "server.pem",
            "-days",
            "1",
            "-extfile",
            "server.ext",
        ],
    );
    // (3) Good client cert signed by the trusted CA.
    run_openssl(
        &dir,
        &[
            "req",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            "client.key",
            "-out",
            "client.csr",
            "-subj",
            "/CN=g3-good-client",
        ],
    );
    run_openssl(
        &dir,
        &[
            "x509",
            "-req",
            "-in",
            "client.csr",
            "-CA",
            "ca.pem",
            "-CAkey",
            "ca.key",
            "-CAcreateserial",
            "-out",
            "client.pem",
            "-days",
            "1",
            "-extfile",
            "client.ext",
        ],
    );
    // (4) ROGUE CA + rogue client cert (never trusted by the server).
    run_openssl(
        &dir,
        &[
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            "rogue-ca.key",
            "-out",
            "rogue-ca.pem",
            "-days",
            "1",
            "-subj",
            "/CN=g3-rogue-ca",
        ],
    );
    run_openssl(
        &dir,
        &[
            "req",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            "rogue.key",
            "-out",
            "rogue.csr",
            "-subj",
            "/CN=g3-rogue-client",
        ],
    );
    run_openssl(
        &dir,
        &[
            "x509",
            "-req",
            "-in",
            "rogue.csr",
            "-CA",
            "rogue-ca.pem",
            "-CAkey",
            "rogue-ca.key",
            "-CAcreateserial",
            "-out",
            "rogue.pem",
            "-days",
            "1",
            "-extfile",
            "client.ext",
        ],
    );

    // Lock down private key material and bundle reqwest identities
    // (reqwest::Identity::from_pem wants cert + key in one PEM blob).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for name in [
            "ca.key",
            "server.key",
            "client.key",
            "rogue-ca.key",
            "rogue.key",
        ] {
            std::fs::set_permissions(dir.join(name), std::fs::Permissions::from_mode(0o600))
                .expect("chmod 0600 key file");
        }
    }
    let read = |name: &str| std::fs::read(dir.join(name)).expect("read PEM file");
    let mut client_identity_pem = read("client.pem");
    client_identity_pem.extend_from_slice(&read("client.key"));
    let mut rogue_identity_pem = read("rogue.pem");
    rogue_identity_pem.extend_from_slice(&read("rogue.key"));

    Pki {
        server_cert: dir.join("server.pem"),
        server_key: dir.join("server.key"),
        ca_pem: read("ca.pem"),
        client_identity_pem,
        rogue_identity_pem,
        dir,
    }
}

/// Test-only TLS listener mirroring the private `TlsListener` in `lib.rs`:
/// TCP accept + rustls handshake, handshake failures are skipped (logged by
/// the server) so rogue/no-cert clients surface as client-side errors.
struct MtlsTestListener {
    tcp: tokio::net::TcpListener,
    tls: tokio_rustls::TlsAcceptor,
}

impl axum::serve::Listener for MtlsTestListener {
    type Io = tokio_rustls::server::TlsStream<tokio::net::TcpStream>;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            match self.tcp.accept().await {
                Ok((stream, addr)) => match self.tls.accept(stream).await {
                    Ok(tls_stream) => return (tls_stream, addr),
                    Err(_) => continue,
                },
                Err(_) => continue,
            }
        }
    }

    fn local_addr(&self) -> std::io::Result<SocketAddr> {
        self.tcp.local_addr()
    }
}

/// Spawn the REAL control-plane router behind the REAL mTLS `ServerConfig`
/// (built by `build_server_config`, the helper `serve()` calls). Returns the
/// bound address. Health advertises `client_auth` from
/// `VARDHAN_TLS_CLIENT_CA_PATH`, so point it at the test CA.
async fn spawn_mtls_server(pki: &Pki) -> SocketAddr {
    std::env::set_var("VARDHAN_TLS_CLIENT_CA_PATH", pki.dir.join("ca.pem"));

    let tag = uuid::Uuid::new_v4().to_string();
    let workdir = std::env::temp_dir().join(format!("vardhan_test_g3_{tag}"));
    std::fs::create_dir_all(&workdir).unwrap();
    let creds = Arc::new(
        CredentialStore::open(&workdir.join("auth.db")).expect("open test credential store"),
    );
    let auth_state = AuthState {
        credentials: creds,
        sessions: Arc::new(SessionStore::new()),
        mfa: None,
        mfa_policy: Arc::new(auth_service::MfaPolicy::default()),
        rate_limiter: Arc::new(auth_service::rate_limit::RateLimiter::new()),
        ledger: None,
        identity: None,
        node_id: Some("g3-mtls-test-node".to_string()),
        admin_token: None,
    };
    let db = sled::Config::new()
        .path(workdir.join("control_plane.db"))
        .open()
        .expect("open test sled db");
    let control_state = ControlPlaneState::new_with_sled(
        Arc::new(db),
        None,
        auth_state.clone(),
        Arc::new(ha_cluster::ClusterMembership::new()),
    );
    let app = router(control_state, auth_state, CorsLayer::permissive());

    let config = build_server_config(
        &pki.server_cert,
        &pki.server_key,
        Some(&pki.dir.join("ca.pem")),
    )
    .expect("build mTLS server config");
    let tcp = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test listener");
    let addr = tcp.local_addr().expect("test listener addr");
    let listener = MtlsTestListener {
        tcp,
        tls: tokio_rustls::TlsAcceptor::from(Arc::new(config)),
    };
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve test app");
    });
    addr
}

fn https_client_with_ca(ca_pem: &[u8]) -> reqwest::ClientBuilder {
    let ca = reqwest::Certificate::from_pem(ca_pem).expect("parse test CA PEM");
    reqwest::Client::builder()
        .use_rustls_tls()
        .add_root_certificate(ca)
        .timeout(Duration::from_secs(8))
}

/// G3-1: trusted client certificate -> 200 + client_auth mtls_required.
#[tokio::test]
async fn g3_mtls_trusted_client_health_200() {
    let pki = generate_pki("trusted");
    let addr = spawn_mtls_server(&pki).await;
    let url = format!("https://{addr}/api/v1/platform/health");

    let identity =
        reqwest::Identity::from_pem(&pki.client_identity_pem).expect("parse client identity");
    let client = https_client_with_ca(&pki.ca_pem)
        .identity(identity)
        .build()
        .expect("build trusted client");

    let resp = client.get(&url).send().await.expect("trusted client GET");
    assert_eq!(resp.status(), 200, "trusted client must get 200");
    let body: serde_json::Value = resp.json().await.expect("health JSON");
    assert_eq!(
        body.get("client_auth").and_then(|v| v.as_str()),
        Some("mtls_required"),
        "health must advertise client_auth=mtls_required, got {body}"
    );
    println!("G3-MTLS TRUSTED-200 PASS status=200 client_auth=mtls_required url={url}");
}

/// G3-2: client certificate from an UNTRUSTED (rogue) CA -> handshake rejected.
#[tokio::test]
async fn g3_mtls_rogue_ca_client_rejected() {
    let pki = generate_pki("rogue");
    let addr = spawn_mtls_server(&pki).await;
    let url = format!("https://{addr}/api/v1/platform/health");

    let rogue_identity =
        reqwest::Identity::from_pem(&pki.rogue_identity_pem).expect("parse rogue identity");
    let client = https_client_with_ca(&pki.ca_pem)
        .identity(rogue_identity)
        .build()
        .expect("build rogue client");

    let err = client
        .get(&url)
        .send()
        .await
        .expect_err("rogue-CA client MUST fail the handshake");
    println!("G3-MTLS ROGUE-REJECTED PASS error={err}");
}

/// G3-3: no client certificate at all -> handshake rejected (mTLS mandatory).
#[tokio::test]
async fn g3_mtls_no_cert_client_rejected() {
    let pki = generate_pki("nocert");
    let addr = spawn_mtls_server(&pki).await;
    let url = format!("https://{addr}/api/v1/platform/health");

    let client = https_client_with_ca(&pki.ca_pem)
        .build()
        .expect("build no-cert client");

    let err = client
        .get(&url)
        .send()
        .await
        .expect_err("no-cert client MUST fail the handshake");
    println!("G3-MTLS NOCERT-REJECTED PASS error={err}");
}

/// G3-4 (fail closed): CA path naming a missing file must be a hard error,
/// never a silent plaintext/mTLS-less fallback.
#[tokio::test]
async fn g3_mtls_missing_ca_path_fails_closed() {
    let pki = generate_pki("failclosed");
    let err = build_server_config(
        &pki.server_cert,
        &pki.server_key,
        Some(&pki.dir.join("does-not-exist-ca.pem")),
    )
    .expect_err("missing client-CA file MUST fail closed");
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
    println!("G3-MTLS FAILCLOSED PASS error={err}");
}
