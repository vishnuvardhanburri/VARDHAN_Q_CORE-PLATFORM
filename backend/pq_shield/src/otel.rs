use opentelemetry::trace::TracerProvider as _;
use opentelemetry::KeyValue;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::trace::{Sampler, SdkTracerProvider};
use opentelemetry_sdk::Resource;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Registry;

pub struct OtelGuard {
    pub provider: Option<SdkTracerProvider>,
}

impl Drop for OtelGuard {
    fn drop(&mut self) {
        if let Some(ref provider) = self.provider {
            let _ = provider.shutdown();
        }
    }
}

pub fn init_observability() -> OtelGuard {
    let service_name =
        std::env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| "vardhan-quantum-proxy".to_string());

    let otlp_endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").ok();

    let fmt_layer = tracing_subscriber::fmt::layer()
        .with_target(false)
        .with_thread_ids(false);

    if let Some(endpoint) = otlp_endpoint {
        tracing::info!(endpoint = %endpoint, "Initializing OpenTelemetry OTLP tracer");

        let sample_ratio: f64 = std::env::var("OTEL_TRACES_SAMPLER_ARG")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.05); // 5% default under high load

        let resource = Resource::builder()
            .with_attributes(vec![
                KeyValue::new("service.name", service_name),
                KeyValue::new("service.version", env!("CARGO_PKG_VERSION")),
            ])
            .build();

        let exporter_builder = opentelemetry_otlp::SpanExporter::builder()
            .with_http()
            .with_endpoint(&endpoint);

        match exporter_builder.build() {
            Ok(exporter) => {
                let provider = SdkTracerProvider::builder()
                    .with_resource(resource)
                    .with_sampler(Sampler::ParentBased(Box::new(Sampler::TraceIdRatioBased(
                        sample_ratio,
                    ))))
                    .with_batch_exporter(exporter)
                    .build();

                let tracer = provider.tracer("pq_shield");
                let otel_layer = tracing_opentelemetry::OpenTelemetryLayer::new(tracer);

                let subscriber = Registry::default().with(fmt_layer).with(otel_layer);

                let _ = subscriber.try_init();
                return OtelGuard {
                    provider: Some(provider),
                };
            }
            Err(e) => {
                eprintln!(
                    "WARN: Failed to initialize OTLP exporter ({e}), falling back to local tracing"
                );
            }
        }
    }

    // Default: local fmt tracing only
    let subscriber = Registry::default().with(fmt_layer);
    let _ = subscriber.try_init();
    OtelGuard { provider: None }
}
