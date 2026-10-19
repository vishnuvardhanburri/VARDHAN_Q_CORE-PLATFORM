#!/bin/bash
set -e
cd /Users/vishnuvardhanburri/vardhan-q-core/zk_engine/packages/engine/circuit

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
echo "✅ Finished!"
