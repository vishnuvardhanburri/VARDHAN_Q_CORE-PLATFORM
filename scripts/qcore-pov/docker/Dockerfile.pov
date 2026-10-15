# Multi-stage Dockerfile for VARDHAN Q-Core PoV
# Stage 1: Build the Rust binaries
FROM rust:1.98-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    pkg-config \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the full workspace
COPY . .

# Build only the binaries we need
RUN cargo build --release -p vardhan_receipt -p control_plane_api

# Stage 2: Runtime image
FROM rust:1.98-bookworm AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    jq \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages --no-cache-dir cryptography blake3 2>&1 | tail -3

WORKDIR /app

# Copy built binaries from builder stage
COPY --from=builder /app/target/release/control_plane_api /usr/local/bin/control_plane_api
COPY --from=builder /app/target/release/vardhan-receipt /usr/local/bin/vardhan-receipt

# Copy PoV test scripts
COPY scripts/qcore-pov/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY scripts/qcore-pov/security_test.py /usr/local/bin/security_test.py
COPY scripts/qcore-pov/perf_bench.py /usr/local/bin/perf_bench.py
COPY scripts/qcore-pov/crypto_bench.py /usr/local/bin/crypto_bench.py
COPY scripts/qcore-pov/contracts/ /app/contracts/

RUN chmod +x /usr/local/bin/entrypoint.sh \
    && chmod +x /usr/local/bin/security_test.py /usr/local/bin/perf_bench.py /usr/local/bin/crypto_bench.py

# Pre-create data directories with correct permissions
RUN mkdir -p /var/lib/vardhan/control-plane /var/lib/vardhan/keystore /var/lib/vardhan/idempotency /var/lib/vardhan/auth_config

# Non-root user for security
RUN useradd -m -u 10001 appuser && \
    chown -R appuser:appuser /var/lib/vardhan /app/contracts
USER appuser

ENV VARDHAN_ENV=development
ENV VARDHAN_KEYSTORE_DIR=/var/lib/vardhan/keystore
ENV VARDHAN_IDEMPOTENCY_DIR=/var/lib/vardhan/idempotency
ENV VARDHAN_CONTROL_PLANE_DATA_DIR=/var/lib/vardhan/control-plane
ENV VARDHAN_AUTH_CONFIG_DIR=/var/lib/vardhan/auth_config
ENV QCORE_HOST=http://localhost:8080
# Python PoV scripts use ENGINE_BIN; the Rust HTTP API uses RECEIPT_BIN.
ENV VARDHAN_RECEIPT_ENGINE_BIN=/usr/local/bin/vardhan-receipt
ENV VARDHAN_RECEIPT_BIN=/usr/local/bin/vardhan-receipt
# Auth config lives in its own directory to avoid polluting the keystore dir
# (which would cause keystore_manager to mistake auth_config.json for keystore data).
ENV VARDHAN_AUTH_CONFIG_PATH=/var/lib/vardhan/auth_config/auth_config.json

EXPOSE 8080

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=15 \
    CMD curl -sf http://localhost:8080/api/v1/platform/health | grep -q operational || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
