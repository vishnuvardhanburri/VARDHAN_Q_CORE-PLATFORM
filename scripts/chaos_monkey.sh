#!/bin/bash
# Chaos Monkey: Simulates 10 concurrent attacker vectors against pq_shield

TARGET="127.0.0.1"
PORT=8080

echo "[*] RED TEAM: Launching Chaos Monkey..."

# 1. Volumetric TCP SYN-like connection spam (Slowloris/Connection Exhaustion)
echo "[*] Attacker 1-3: Connection Exhaustion Spam"
for i in {1..300}; do
    nc -w 1 $TARGET $PORT < /dev/null &
done

# 2. Malformed Payload Injection (Fuzzing)
echo "[*] Attacker 4-6: Malformed Cryptographic Payloads"
for i in {1..100}; do
    head -c 200 /dev/urandom | nc -w 1 $TARGET $PORT &
done

# 3. HTTP Protocol Smuggling / Garbage (Application Layer)
echo "[*] Attacker 7-10: Protocol Smuggling / Garbage Injection"
for i in {1..100}; do
    echo -e "GET / HTTP/1.1\r\nHost: evil.com\r\nTransfer-Encoding: chunked\r\n\r\n1\r\nZ\r\n0\r\n\r\n" | nc -w 1 $TARGET $PORT &
done

echo "[*] RED TEAM: All malicious payloads fired."
wait
