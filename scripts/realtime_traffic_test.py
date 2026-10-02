#!/usr/bin/env python3
import asyncio
import httpx
import random
import time
import json
import statistics

TARGET_URL = "http://localhost:8080/v1/clearing"
DURATION_SEC = 60
RPS = 50

# Pre-defined financial mock data
ACCOUNTS = [f"VGI-CH-{random.randint(1000, 9999)}" for _ in range(20)]
CURRENCIES = ["GBP", "USD", "EUR", "CHF", "JPY"]
STATUSES = ["SETTLED", "PENDING_CLEARING", "MARGIN_CALL", "LOCKED"]

async def send_request(client, req_id):
    payload = {
        "transaction_id": f"TXN-{req_id:08d}",
        "status": random.choice(STATUSES),
        "account": random.choice(ACCOUNTS),
        "amount": f"{random.randint(1000, 50000000)}_{random.choice(CURRENCIES)}",
        "timestamp": time.time()
    }
    start_time = time.time()
    try:
        response = await client.post(TARGET_URL, json=payload, timeout=5.0)
        latency = (time.time() - start_time) * 1000
        return True, latency, response.status_code
    except Exception as e:
        print(f"Error: {e}")
        return False, 0, str(e)

async def traffic_generator():
    print(f"[*] Starting Real-time Traffic Simulator: {RPS} RPS for {DURATION_SEC} seconds...", flush=True)
    print(f"[*] Target: {TARGET_URL}", flush=True)
    
    latencies = []
    success_count = 0
    fail_count = 0
    
    start_time = time.time()
    req_id = 1
    
    async with httpx.AsyncClient() as client:
        while time.time() - start_time < DURATION_SEC:
            batch_start = time.time()
            
            # Fire a batch of RPS requests concurrently
            tasks = [send_request(client, req_id + i) for i in range(RPS)]
            req_id += RPS
            
            results = await asyncio.gather(*tasks)
            
            batch_latencies = []
            for success, lat, code in results:
                if success and code == 200:
                    success_count += 1
                    batch_latencies.append(lat)
                    latencies.append(lat)
                else:
                    fail_count += 1
            
            if batch_latencies:
                avg_lat = statistics.mean(batch_latencies)
                p95_lat = statistics.quantiles(batch_latencies, n=20)[18] if len(batch_latencies) > 20 else max(batch_latencies)
                print(f"[LIVE] {RPS} reqs sent | Success: {success_count} | Fail: {fail_count} | Avg Latency: {avg_lat:.2f}ms | p95: {p95_lat:.2f}ms", flush=True)
            
            # Throttle to maintain exact RPS
            elapsed = time.time() - batch_start
            if elapsed < 1.0:
                await asyncio.sleep(1.0 - elapsed)
                
    if latencies:
        print("\n=== FINAL METRICS ===")
        print(f"Total Requests: {req_id - 1}")
        print(f"Successful: {success_count}")
        print(f"Failed: {fail_count}")
        print(f"Overall Avg Latency: {statistics.mean(latencies):.2f}ms")
        print(f"Overall Max Latency: {max(latencies):.2f}ms")
    else:
        print("No successful requests recorded.")

if __name__ == "__main__":
    asyncio.run(traffic_generator())
