use crate::prometheus_metrics::PrometheusMetrics;
use audit_ledger::LedgerWriter;
use core_crypto::QuantumNodeIdentity;
use hdrhistogram::Histogram;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

// Versioned immutable event schema
#[derive(Debug, Clone, Serialize)]
pub struct QuantumEvent {
    pub schema_version: u32,
    pub event_id: String,
    pub timestamp_ms: u128,
    pub session_id: String,
    pub event_type: String,
    pub sequence: u64,
    pub payload: serde_json::Value,
}

impl QuantumEvent {
    pub fn new(
        session_id: &str,
        event_type: &str,
        sequence: u64,
        payload: serde_json::Value,
    ) -> Self {
        Self {
            schema_version: 1,
            event_id: Uuid::new_v4().to_string(),
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis(),
            session_id: session_id.to_string(),
            event_type: event_type.to_string(),
            sequence,
            payload,
        }
    }
}

// Internal messages from the data plane (hot path) to telemetry aggregator.
// All sends use try_send: drop telemetry under pressure, never block the proxy loop.
#[derive(Debug)]
pub enum InternalMsg {
    // LatencySample carries timing ONLY — does NOT count as a completed request.
    LatencySample(u64),
    // Emitted after a complete upstream roundtrip succeeds.
    RequestCompleted,
    HandshakeCompleted(String, u64),
    UpstreamConnected(String),
    // Emitted on TcpStream::connect or forwarding error paths.
    UpstreamFailed(String),
    FrameRejected,
    SessionClosed(String),
    KemEntropySample(Vec<u8>),
    NonceEntropySample(Vec<u8>),
}

#[derive(Debug, Serialize, Clone)]
pub struct MetricsSnapshot {
    pub requests_per_sec: u64,
    pub handshakes_per_sec: u64,
    pub active_sessions: u32,
    pub successful_handshakes: u64,
    pub rejected_frames: u64,
    pub upstream_failures: u64,
    pub latency_p50_us: u64,
    pub latency_p95_us: u64,
    pub latency_p99_us: u64,
    pub kem_entropy: f64,
    pub nonce_entropy: f64,
    pub sample_window_size: usize,
}

pub struct TelemetryEngine {
    pub tx: mpsc::Sender<InternalMsg>,
    pub event_broadcast: broadcast::Sender<QuantumEvent>,
    pub snapshot: Arc<RwLock<MetricsSnapshot>>,
    pub history: Arc<RwLock<VecDeque<QuantumEvent>>>,
    /// Set to true once the ring buffer has wrapped (oldest event evicted).
    pub history_wrapped: Arc<std::sync::atomic::AtomicBool>,
    pub prometheus: Arc<PrometheusMetrics>,
}

impl TelemetryEngine {
    /// Create the engine. If `ledger` is Some, every auditable event is durably
    /// written and ML-DSA-87 signed before being broadcast.
    pub fn new(
        ledger: Option<Arc<LedgerWriter>>,
        identity: Option<Arc<QuantumNodeIdentity>>,
        prometheus: Arc<PrometheusMetrics>,
    ) -> Self {
        let (tx, mut rx) = mpsc::channel::<InternalMsg>(100_000);
        let (event_tx, _) = broadcast::channel::<QuantumEvent>(1024);

        let event_broadcast = event_tx.clone();

        let initial_snapshot = MetricsSnapshot {
            requests_per_sec: 0,
            handshakes_per_sec: 0,
            active_sessions: 0,
            successful_handshakes: 0,
            rejected_frames: 0,
            upstream_failures: 0,
            latency_p50_us: 0,
            latency_p95_us: 0,
            latency_p99_us: 0,
            kem_entropy: 0.0,
            nonce_entropy: 0.0,
            sample_window_size: 4096,
        };

        let snapshot = Arc::new(RwLock::new(initial_snapshot));
        let snapshot_ref = snapshot.clone();

        let history = Arc::new(RwLock::new(VecDeque::with_capacity(1000)));
        let history_ref = history.clone();

        let history_wrapped = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let history_wrapped_ref = history_wrapped.clone();
        let prom_ref = prometheus.clone();

        tokio::spawn(async move {
            let mut hist = Histogram::<u64>::new_with_bounds(1, 1_000_000, 3).unwrap();
            let mut active_sessions = 0u32;
            let mut successful_handshakes = 0u64;
            let mut rejected_frames = 0u64;
            let mut upstream_failures = 0u64;

            let mut requests_this_sec = 0u64;
            let mut handshakes_this_sec = 0u64;
            let mut last_tick = Instant::now();

            let mut kem_samples: VecDeque<u8> = VecDeque::with_capacity(4096);
            let mut nonce_samples: VecDeque<u8> = VecDeque::with_capacity(4096);

            fn calc_shannon(samples: &VecDeque<u8>) -> f64 {
                if samples.is_empty() {
                    return 0.0;
                }
                let mut freqs = [0usize; 256];
                for &b in samples {
                    freqs[b as usize] += 1;
                }
                let len = samples.len() as f64;
                freqs
                    .iter()
                    .filter(|&&f| f > 0)
                    .map(|&f| {
                        let p = (f as f64) / len;
                        -p * p.log2()
                    })
                    .sum()
            }

            // P2/P3: emit_event:
            //   1. Durably writes to ledger (fsync, ML-DSA-87 signed) — under write lock
            //   2. Increments prometheus ledger entry counter
            //   3. Pushes to in-memory ring buffer
            //   4. Broadcasts to SSE subscribers
            async fn emit_event(
                ev: QuantumEvent,
                history: &Arc<RwLock<VecDeque<QuantumEvent>>>,
                wrapped: &Arc<std::sync::atomic::AtomicBool>,
                tx: &broadcast::Sender<QuantumEvent>,
                ledger: &Option<Arc<LedgerWriter>>,
                identity: &Option<Arc<QuantumNodeIdentity>>,
                prom: &Arc<PrometheusMetrics>,
            ) {
                if let (Some(lw), Some(id)) = (ledger, identity) {
                    let event_value = serde_json::to_value(&ev).unwrap_or(serde_json::Value::Null);
                    if let Err(e) = lw.append(event_value, id) {
                        tracing::warn!("Ledger write failed (event still broadcast): {e}");
                    } else {
                        prom.ledger_entries_total.inc();
                    }
                }

                let mut h = history.write().await;
                if h.len() >= 1000 {
                    h.pop_front();
                    wrapped.store(true, std::sync::atomic::Ordering::Relaxed);
                }
                h.push_back(ev.clone());
                let _ = tx.send(ev);
            }

            loop {
                match tokio::time::timeout(tokio::time::Duration::from_millis(50), rx.recv()).await
                {
                    Ok(Some(msg)) => match msg {
                        InternalMsg::LatencySample(us) => {
                            let _ = hist.record(us);
                            prom_ref
                                .request_duration_seconds
                                .observe((us as f64) / 1_000_000.0);
                        }
                        InternalMsg::RequestCompleted => {
                            requests_this_sec += 1;
                            prom_ref
                                .requests_total
                                .with_label_values(&["success"])
                                .inc();
                        }
                        InternalMsg::HandshakeCompleted(sid, us) => {
                            handshakes_this_sec += 1;
                            successful_handshakes += 1;
                            active_sessions += 1;
                            prom_ref
                                .handshakes_total
                                .with_label_values(&["success"])
                                .inc();
                            prom_ref
                                .handshake_duration_seconds
                                .observe((us as f64) / 1_000_000.0);
                            prom_ref.active_sessions.set(active_sessions as i64);

                            let ev = QuantumEvent::new(
                                &sid,
                                "HandshakeCompleted",
                                0,
                                serde_json::json!({}),
                            );
                            emit_event(
                                ev,
                                &history_ref,
                                &history_wrapped_ref,
                                &event_tx,
                                &ledger,
                                &identity,
                                &prom_ref,
                            )
                            .await;
                        }
                        InternalMsg::UpstreamConnected(sid) => {
                            let ev = QuantumEvent::new(
                                &sid,
                                "UpstreamConnected",
                                0,
                                serde_json::json!({}),
                            );
                            emit_event(
                                ev,
                                &history_ref,
                                &history_wrapped_ref,
                                &event_tx,
                                &ledger,
                                &identity,
                                &prom_ref,
                            )
                            .await;
                        }
                        InternalMsg::UpstreamFailed(sid) => {
                            upstream_failures += 1;
                            prom_ref.upstream_failures_total.inc();
                            prom_ref
                                .requests_total
                                .with_label_values(&["failure"])
                                .inc();

                            let ev =
                                QuantumEvent::new(&sid, "UpstreamFailed", 0, serde_json::json!({}));
                            emit_event(
                                ev,
                                &history_ref,
                                &history_wrapped_ref,
                                &event_tx,
                                &ledger,
                                &identity,
                                &prom_ref,
                            )
                            .await;
                        }
                        InternalMsg::SessionClosed(sid) => {
                            if active_sessions > 0 {
                                active_sessions -= 1;
                            }
                            prom_ref.active_sessions.set(active_sessions as i64);

                            let ev =
                                QuantumEvent::new(&sid, "SessionClosed", 0, serde_json::json!({}));
                            emit_event(
                                ev,
                                &history_ref,
                                &history_wrapped_ref,
                                &event_tx,
                                &ledger,
                                &identity,
                                &prom_ref,
                            )
                            .await;
                        }
                        InternalMsg::FrameRejected => {
                            rejected_frames += 1;
                            prom_ref.frames_rejected_total.inc();
                            prom_ref
                                .handshakes_total
                                .with_label_values(&["rejected"])
                                .inc();
                        }
                        InternalMsg::KemEntropySample(bytes) => {
                            for b in bytes {
                                if kem_samples.len() == 4096 {
                                    kem_samples.pop_front();
                                }
                                kem_samples.push_back(b);
                            }
                        }
                        InternalMsg::NonceEntropySample(bytes) => {
                            for b in bytes {
                                if nonce_samples.len() == 4096 {
                                    nonce_samples.pop_front();
                                }
                                nonce_samples.push_back(b);
                            }
                        }
                    },
                    Ok(None) => break,
                    Err(_) => {
                        if last_tick.elapsed().as_secs() >= 1 {
                            let kem_entropy = calc_shannon(&kem_samples);
                            let nonce_entropy = calc_shannon(&nonce_samples);

                            prom_ref
                                .shannon_entropy_bits
                                .with_label_values(&["kem"])
                                .set(kem_entropy);
                            prom_ref
                                .shannon_entropy_bits
                                .with_label_values(&["nonce"])
                                .set(nonce_entropy);

                            let mut w = snapshot_ref.write().await;
                            w.requests_per_sec = requests_this_sec;
                            w.handshakes_per_sec = handshakes_this_sec;
                            w.active_sessions = active_sessions;
                            w.successful_handshakes = successful_handshakes;
                            w.rejected_frames = rejected_frames;
                            w.upstream_failures = upstream_failures;
                            w.latency_p50_us = hist.value_at_percentile(50.0);
                            w.latency_p95_us = hist.value_at_percentile(95.0);
                            w.latency_p99_us = hist.value_at_percentile(99.0);
                            w.kem_entropy = kem_entropy;
                            w.nonce_entropy = nonce_entropy;

                            requests_this_sec = 0;
                            handshakes_this_sec = 0;
                            hist.clear();
                            last_tick = Instant::now();
                        }
                    }
                }
            }
        });

        Self {
            tx,
            event_broadcast,
            snapshot,
            history,
            history_wrapped,
            prometheus,
        }
    }
}
