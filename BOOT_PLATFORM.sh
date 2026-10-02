#!/bin/bash
echo "==========================================================="
echo "   VARDHAN Q-CORE ENTERPRISE PLATFORM (£250M EDITION)   "
echo "==========================================================="
echo "Booting all 3 pillars of the Sovereign Architecture..."

# 1. Compile Rust Backend
echo "1. Compiling Quantum Cryptography Core (Rust/ML-DSA-87)..."
cd backend && cargo build --workspace --quiet &
cd ..

# 2. Boot ZK Engine Background Workers
echo "2. Initializing Zero-Knowledge Proof Engine (Groth16)..."
cd zk_engine && npm install --silent && npm run build --silent &
cd ..

# 3. Boot Intelligence Dashboard
echo "3. Booting Intelligence Plane (Vite/React/TS)..."
cd intelligence_plane && npm install --silent && npm run dev
