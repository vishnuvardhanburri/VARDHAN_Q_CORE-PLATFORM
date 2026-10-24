use core_crypto::aer_kep_q::AerKepQ;
use core_crypto::QuantumNodeIdentity;

fn main() {
    let node_a = QuantumNodeIdentity::generate_node_identity().unwrap();
    let receiver = AerKepQ::new("smoke", 1).expect("epoch");
    let descriptor = receiver.descriptor(&node_a).expect("descriptor");
    let dsa_pub = node_a.dsa_public_key_bytes();

    let (ciphertext, sender_key) =
        AerKepQ::encapsulate(&descriptor, &dsa_pub, 1, b"smoke-context", "tx-smoke-1")
            .expect("encapsulate");
    let mut receiver = receiver;
    let receiver_key = receiver
        .decapsulate(&ciphertext, 1, b"smoke-context", "tx-smoke-1")
        .expect("decapsulate");
    assert_eq!(sender_key, receiver_key);
}
