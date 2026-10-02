use core_crypto::QuantumNodeIdentity;
fn main() {
    let _id = QuantumNodeIdentity::generate_node_identity().unwrap();
    let _id2 = _id.clone();
}
