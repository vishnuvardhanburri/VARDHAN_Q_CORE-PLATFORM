#!/bin/bash
set -e
mkdir -p circuit
cd circuit

cat << 'CIRCOM' > compliance.circom
pragma circom 2.0.0;
include "/Users/vishnuvardhanburri/vardhan-q-core/zk_engine/node_modules/circomlib/circuits/poseidon.circom";

template ComplianceShield() {
    signal input secretData;
    signal input policyHash;
    signal output decisionHash;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== secretData;
    hasher.inputs[1] <== policyHash;

    decisionHash <== hasher.out;
}

component main {public [policyHash]} = ComplianceShield();
CIRCOM

echo "[CIRCOM] Compiling Zero-Knowledge Circuit..."
circom compliance.circom --r1cs --wasm --sym

echo "[SNARKJS] Running Powers of Tau Trusted Setup..."
npx snarkjs powersoftau new bn128 12 pot12_0000.ptau -v
echo "entropy123456789" | npx snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau --name="First contribution" -v
npx snarkjs powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau -v

echo "[SNARKJS] Generating ZKey..."
npx snarkjs groth16 setup compliance.r1cs pot12_final.ptau compliance_0000.zkey
echo "entropy987654321" | npx snarkjs zkey contribute compliance_0000.zkey compliance_final.zkey --name="Second contribution" -v
npx snarkjs zkey export verificationkey compliance_final.zkey verification_key.json

cp compliance_js/compliance.wasm ../
cp compliance_final.zkey ../
cp verification_key.json ../

echo "✅ Real Zero-Knowledge Cryptographic Assets Generated Successfully."
