use core_crypto::QuantumNodeIdentity;
use proxy_engine::run_initiator;
use proxy_engine::transport::AeadTransport;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

fn parse_args() -> (String, usize, u64) {
    let args: Vec<String> = std::env::args().collect();
    let mut target = "127.0.0.1:8080".to_string();
    let mut concurrency = 100usize;
    let mut duration = 5u64;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--target" => {
                if i + 1 < args.len() {
                    target = args[i + 1].clone();
                    i += 2;
                } else {
                    eprintln!("Error: --target requires a value");
                    std::process::exit(1);
                }
            }
            "--concurrency" => {
                if i + 1 < args.len() {
                    concurrency = args[i + 1].parse().unwrap_or_else(|_| {
                        eprintln!("Error: --concurrency must be a number");
                        std::process::exit(1);
                    });
                    i += 2;
                } else {
                    eprintln!("Error: --concurrency requires a value");
                    std::process::exit(1);
                }
            }
            "--duration" => {
                if i + 1 < args.len() {
                    duration = args[i + 1].parse().unwrap_or_else(|_| {
                        eprintln!("Error: --duration must be a number (seconds)");
                        std::process::exit(1);
                    });
                    i += 2;
                } else {
                    eprintln!("Error: --duration requires a value");
                    std::process::exit(1);
                }
            }
            _ => {
                i += 1;
            }
        }
    }
    (target, concurrency, duration)
}

#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() {
    let (target_addr, concurrency, duration_secs) = parse_args();
    let test_duration = Duration::from_secs(duration_secs);

    println!("==================================================================");
    println!(" VARDHAN TECHNOLOGIES :: SUSTAINED E2E LOAD TEST (P0 Final Gate)");
    println!("==================================================================");

    println!("[*] Target: {}", target_addr);
    println!("[*] Concurrency: {}", concurrency);
    println!("[*] Soak Duration: {:?}", test_duration);

    let payload = b"GET / HTTP/1.1\r\nHost: benchmark\r\n\r\n";
    let identity = Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap());

    let successful_requests = Arc::new(AtomicUsize::new(0));
    let failed_requests = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::new();

    let start_time = Instant::now();

    for _ in 0..concurrency {
        let identity = Arc::clone(&identity);
        let succ = Arc::clone(&successful_requests);
        let fail = Arc::clone(&failed_requests);
        let target = target_addr.clone();

        let handle = tokio::spawn(async move {
            if let Ok(mut stream) = TcpStream::connect(target).await {
                // PQ Handshake (blocks here initially)
                if let Ok(session) = run_initiator(&mut stream, &identity).await {
                    let mut transport = AeadTransport::new(
                        stream,
                        *session.client_to_server_key, // tx_key
                        *session.server_to_client_key, // rx_key
                        session.session_id,
                        session.session_salt,
                        true,
                    );

                    while start_time.elapsed() < test_duration {
                        if transport.write_frame(payload).await.is_ok() {
                            if let Ok(Some(_)) = transport.read_frame().await {
                                succ.fetch_add(1, Ordering::Relaxed);
                                continue;
                            }
                        }
                        fail.fetch_add(1, Ordering::Relaxed);
                        break;
                    }
                } else {
                    fail.fetch_add(1, Ordering::Relaxed); // handshake fail
                }
            } else {
                fail.fetch_add(1, Ordering::Relaxed); // connect fail
            }
        });
        handles.push(handle);
    }

    for handle in handles {
        let _ = handle.await;
    }

    let elapsed = start_time.elapsed();
    let total_succ = successful_requests.load(Ordering::Relaxed);
    let total_fail = failed_requests.load(Ordering::Relaxed);
    let rps = total_succ as f64 / elapsed.as_secs_f64();

    println!("------------------------------------------------------------------");
    println!("Sustained Test Complete!");
    println!("Elapsed Time:          {:.2?}", elapsed);
    println!("Total E2E Successful:  {}", total_succ);
    println!("Total E2E Failures:    {}", total_fail);
    println!("E2E Sustained Rate:    {:.2} req/sec", rps);
    println!("==================================================================");
}
