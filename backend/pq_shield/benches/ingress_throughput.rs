use core_crypto::QuantumNodeIdentity;
use pq_shield::IngressShield;
use proxy_engine::aes_gcm_seal;
use std::time::{Duration, Instant};

#[tokio::main]
async fn main() {
    println!("=== VARDHAN TECHNOLOGIES :: gRPC/Ingress High-Throughput Benchmark ===");

    let key = [0x42u8; 32];
    let sample_payload = b"POST /v1/clearing HTTP/1.1\r\nHost: clearing.bank.internal\r\nContent-Type: application/grpc\r\n\r\n[PAYLOAD_1500000_GBP]";

    let iterations = 100_000;
    println!("Executing {} frame encapsulation operations...", iterations);

    let start = Instant::now();
    let mut total_bytes = 0;

    for _ in 0..iterations {
        let sealed = aes_gcm_seal(&key, sample_payload).expect("Seal failed");
        let _entropy = IngressShield::calculate_entropy(&sealed);
        total_bytes += sealed.len();
    }

    let elapsed = start.elapsed();
    let req_per_sec = (iterations as f64) / elapsed.as_secs_f64();
    let mb_per_sec = (total_bytes as f64 / 1_024_000.0) / elapsed.as_secs_f64();

    println!("------------------------------------------------------------------");
    println!("Elapsed Time:           {:.2?}", elapsed);
    println!("Throughput (Req/sec):   {:.2} req/sec", req_per_sec);
    println!("Data Velocity:          {:.2} MB/sec", mb_per_sec);
    println!(
        "Status:                 {}",
        if req_per_sec >= 10000.0 {
            "PASS (Target >10,000 req/sec Exceeded)"
        } else {
            "FAIL"
        }
    );
    println!("------------------------------------------------------------------");
}
