use axum::{body::Bytes, http::StatusCode, response::IntoResponse, routing::post, Router};
use opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceRequest;
use opentelemetry_proto::tonic::common::v1::any_value::Value as ProtoVal;
use prost::Message;
use serde_json::json;
use std::io::Write;

#[tokio::main]
async fn main() {
    let app = Router::new().route("/v1/traces", post(handle_traces));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:4318")
        .await
        .unwrap();
    println!("[*] OTLP Test Collector listening on 127.0.0.1:4318/v1/traces");
    axum::serve(listener, app).await.unwrap();
}

async fn handle_traces(body: Bytes) -> impl IntoResponse {
    match ExportTraceServiceRequest::decode(body) {
        Ok(req) => {
            let mut recorded_spans = Vec::new();
            for resource_span in req.resource_spans {
                for scope_span in resource_span.scope_spans {
                    for span in scope_span.spans {
                        let mut attrs = serde_json::Map::new();
                        for attr in span.attributes {
                            let json_val = match attr.value.and_then(|v| v.value) {
                                Some(ProtoVal::StringValue(s)) => serde_json::Value::String(s),
                                Some(ProtoVal::IntValue(i)) => serde_json::Value::Number(i.into()),
                                Some(ProtoVal::DoubleValue(d)) => serde_json::json!(d),
                                Some(ProtoVal::BoolValue(b)) => serde_json::Value::Bool(b),
                                other => serde_json::json!(format!("{:?}", other)),
                            };
                            attrs.insert(attr.key, json_val);
                        }
                        println!(
                            "[OTLP RECEIVED SPAN] name: {}, attrs: {}",
                            span.name,
                            serde_json::to_string(&attrs).unwrap_or_default()
                        );
                        recorded_spans.push(json!({
                            "name": span.name,
                            "attributes": attrs,
                        }));
                    }
                }
            }
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open("/tmp/otlp_received_spans.jsonl")
            {
                for s in recorded_spans {
                    let _ = writeln!(f, "{}", s);
                }
            }
            (
                StatusCode::OK,
                [("content-type", "application/x-protobuf")],
                vec![],
            )
        }
        Err(e) => {
            eprintln!("Failed to decode OTLP request: {e}");
            (
                StatusCode::BAD_REQUEST,
                [("content-type", "text/plain")],
                vec![],
            )
        }
    }
}
