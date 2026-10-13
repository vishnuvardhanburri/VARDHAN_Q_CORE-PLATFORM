use core_crypto::QuantumNodeIdentity;
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn bench_pq_identity_generation(c: &mut Criterion) {
    c.bench_function("generate_node_identity_ml_kem_1024_dsa_87", |b| {
        b.iter(|| {
            let identity = QuantumNodeIdentity::generate_node_identity().unwrap();
            black_box(identity);
        });
    });
}

fn bench_kem_encapsulation(c: &mut Criterion) {
    let node = QuantumNodeIdentity::generate_node_identity().unwrap();
    let ek_bytes = node.encap_key_bytes();

    c.bench_function("ml_kem_1024_encapsulate", |b| {
        b.iter(|| {
            let res =
                QuantumNodeIdentity::encapsulate_shared_secret_from_bytes(black_box(&ek_bytes))
                    .unwrap();
            black_box(res);
        });
    });
}

fn bench_dsa_signing_and_verification(c: &mut Criterion) {
    let node = QuantumNodeIdentity::generate_node_identity().unwrap();
    let pub_key = node.dsa_public_key_bytes();
    let payload = b"VARDHAN_QUANTUM_BENCHMARK_PAYLOAD_64_BYTES_DATA_STREAM";

    c.bench_function("ml_dsa_87_sign", |b| {
        b.iter(|| {
            let sig = node.sign_payload(black_box(payload)).unwrap();
            black_box(sig);
        });
    });

    let sig = node.sign_payload(payload).unwrap();
    c.bench_function("ml_dsa_87_verify", |b| {
        b.iter(|| {
            let valid = QuantumNodeIdentity::verify_signature(
                black_box(&pub_key),
                black_box(payload),
                black_box(&sig),
            );
            black_box(valid);
        });
    });
}

criterion_group!(
    benches,
    bench_pq_identity_generation,
    bench_kem_encapsulation,
    bench_dsa_signing_and_verification
);
criterion_main!(benches);
