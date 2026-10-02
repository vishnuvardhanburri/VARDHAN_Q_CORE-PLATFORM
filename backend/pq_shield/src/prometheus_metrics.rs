use prometheus::{
    CounterVec, Encoder, GaugeVec, Histogram, HistogramOpts, IntCounter, IntGauge, Opts, Registry,
    TextEncoder,
};

#[derive(Clone)]
pub struct PrometheusMetrics {
    pub registry: Registry,
    pub requests_total: CounterVec,
    pub request_duration_seconds: Histogram,
    pub handshakes_total: CounterVec,
    pub handshake_duration_seconds: Histogram,
    pub active_sessions: IntGauge,
    pub frames_rejected_total: IntCounter,
    pub upstream_failures_total: IntCounter,
    pub shannon_entropy_bits: GaugeVec,
    pub ledger_entries_total: IntCounter,
}

impl PrometheusMetrics {
    pub fn new() -> Result<Self, prometheus::Error> {
        let registry = Registry::new();

        let requests_total = CounterVec::new(
            Opts::new(
                "proxy_requests_total",
                "Total completed upstream proxy requests",
            ),
            &["status"],
        )?;
        registry.register(Box::new(requests_total.clone()))?;

        let request_duration_opts = HistogramOpts::new(
            "proxy_request_duration_seconds",
            "Histogram of request roundtrip duration in seconds",
        )
        .buckets(vec![
            0.0001, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0,
        ]);
        let request_duration_seconds = Histogram::with_opts(request_duration_opts)?;
        registry.register(Box::new(request_duration_seconds.clone()))?;

        let handshakes_total = CounterVec::new(
            Opts::new(
                "proxy_handshakes_total",
                "Total post-quantum handshake attempts",
            ),
            &["status"],
        )?;
        registry.register(Box::new(handshakes_total.clone()))?;

        let handshake_duration_opts = HistogramOpts::new(
            "proxy_handshake_duration_seconds",
            "Histogram of post-quantum handshake duration in seconds",
        )
        .buckets(vec![0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1]);
        let handshake_duration_seconds = Histogram::with_opts(handshake_duration_opts)?;
        registry.register(Box::new(handshake_duration_seconds.clone()))?;

        let active_sessions = IntGauge::new(
            "proxy_active_sessions",
            "Number of active post-quantum sessions",
        )?;
        registry.register(Box::new(active_sessions.clone()))?;

        let frames_rejected_total = IntCounter::new(
            "proxy_frames_rejected_total",
            "Total frames rejected due to AEAD decryption, sequence, or integrity failure",
        )?;
        registry.register(Box::new(frames_rejected_total.clone()))?;

        let upstream_failures_total = IntCounter::new(
            "proxy_upstream_failures_total",
            "Total upstream connection or forwarding failures",
        )?;
        registry.register(Box::new(upstream_failures_total.clone()))?;

        let shannon_entropy_bits = GaugeVec::new(
            Opts::new(
                "proxy_shannon_entropy_bits",
                "Byte Shannon Entropy (bits/byte)",
            ),
            &["source"],
        )?;
        registry.register(Box::new(shannon_entropy_bits.clone()))?;

        let ledger_entries_total = IntCounter::new(
            "proxy_ledger_entries_total",
            "Total ML-DSA-87 signed audit ledger entries recorded",
        )?;
        registry.register(Box::new(ledger_entries_total.clone()))?;

        Ok(Self {
            registry,
            requests_total,
            request_duration_seconds,
            handshakes_total,
            handshake_duration_seconds,
            active_sessions,
            frames_rejected_total,
            upstream_failures_total,
            shannon_entropy_bits,
            ledger_entries_total,
        })
    }

    /// Encode all registered metrics into official Prometheus text format (0.0.4).
    pub fn encode(&self) -> String {
        let encoder = TextEncoder::new();
        let metric_families = self.registry.gather();
        let mut buffer = Vec::new();
        if let Err(e) = encoder.encode(&metric_families, &mut buffer) {
            tracing::warn!("Failed to encode Prometheus metrics: {e}");
            return String::new();
        }
        String::from_utf8(buffer).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prometheus_metrics_lifecycle() {
        let metrics = PrometheusMetrics::new().expect("PrometheusMetrics::new should succeed");

        metrics
            .requests_total
            .with_label_values(&["success"])
            .inc_by(42.0);
        metrics.active_sessions.set(7);
        metrics.request_duration_seconds.observe(0.0025);
        metrics
            .handshakes_total
            .with_label_values(&["success"])
            .inc();
        metrics.handshake_duration_seconds.observe(0.015);
        metrics
            .shannon_entropy_bits
            .with_label_values(&["nonce"])
            .set(7.99);
        metrics.ledger_entries_total.inc_by(10);

        let output = metrics.encode();
        assert!(output.contains("# TYPE proxy_requests_total counter"));
        assert!(output.contains("proxy_requests_total{status=\"success\"} 42"));
        assert!(output.contains("# TYPE proxy_active_sessions gauge"));
        assert!(output.contains("proxy_active_sessions 7"));
        assert!(output.contains("proxy_request_duration_seconds_bucket"));
        assert!(output.contains("proxy_handshake_duration_seconds_bucket"));
        assert!(output.contains("proxy_shannon_entropy_bits{source=\"nonce\"} 7.99"));
        assert!(output.contains("proxy_ledger_entries_total 10"));
    }
}
