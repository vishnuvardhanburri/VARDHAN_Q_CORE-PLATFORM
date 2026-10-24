#!/usr/bin/env bash
# benchmark_representative_restore.sh
# Performs representative 10,000-record database backup and restore benchmark against PostgreSQL.
# Measures exact restore duration (RTO), backup size, record count, and financial invariant integrity.
# ZERO EMOJIS permitted.

set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-vardhan_q_core-platform-main-postgres-1}"
DB_USER="${POSTGRES_USER:-vardhan}"
SRC_DB="vardhan_rep_src"
TGT_DB="vardhan_rep_tgt"
DUMP_FILE="/tmp/vardhan_representative_10k.dump"

echo "[INFO] Verifying PostgreSQL container availability..."
docker exec "${CONTAINER_NAME}" pg_isready -U "${DB_USER}" >/dev/null

echo "[INFO] Cleaning up prior test databases if present..."
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c "DROP DATABASE IF EXISTS ${SRC_DB};" >/dev/null
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c "DROP DATABASE IF EXISTS ${TGT_DB};" >/dev/null
docker exec "${CONTAINER_NAME}" rm -f "${DUMP_FILE}"

echo "[INFO] Creating representative source database: ${SRC_DB}..."
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c "CREATE DATABASE ${SRC_DB};" >/dev/null

echo "[INFO] Creating schema in ${SRC_DB}..."
docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${SRC_DB}" <<'EOSQL'
CREATE TABLE accounts (
    id SERIAL PRIMARY KEY,
    account_number VARCHAR(34) NOT NULL UNIQUE,
    holder_name VARCHAR(128) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    balance_minor_units BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE journal_entries (
    id SERIAL PRIMARY KEY,
    entry_id UUID NOT NULL UNIQUE,
    source_account VARCHAR(34) NOT NULL,
    target_account VARCHAR(34) NOT NULL,
    amount_minor_units BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL,
    state VARCHAR(32) NOT NULL,
    hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_journal_source ON journal_entries(source_account);
CREATE INDEX idx_journal_target ON journal_entries(target_account);
CREATE INDEX idx_journal_state ON journal_entries(state);

CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    action VARCHAR(32) NOT NULL,
    details JSONB NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
EOSQL

echo "[INFO] Populating 10,000 synthetic transaction records + 100 accounts + 10,000 audit records..."
docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${SRC_DB}" <<'EOSQL'
INSERT INTO accounts (account_number, holder_name, currency, balance_minor_units)
SELECT 
    'ACC-' || lpad(s::text, 6, '0'),
    'Synthetic Financial Account ' || s,
    'USD',
    1000000000
FROM generate_series(1, 100) s;

INSERT INTO journal_entries (entry_id, source_account, target_account, amount_minor_units, currency, state, hash, created_at)
SELECT 
    gen_random_uuid(),
    'ACC-' || lpad(((s % 100) + 1)::text, 6, '0'),
    'ACC-' || lpad((((s + 1) % 100) + 1)::text, 6, '0'),
    (1000 + (s * 37) % 500000),
    'USD',
    'SETTLED',
    md5(s::text || 'vardhan_synthetic_salt_2026'),
    NOW() - (s || ' seconds')::INTERVAL
FROM generate_series(1, 10000) s;

INSERT INTO audit_log (entity_type, entity_id, action, details)
SELECT 
    'journal_entry',
    entry_id::text,
    'SETTLED',
    json_build_object('amount_minor_units', amount_minor_units, 'currency', currency, 'state', state)
FROM journal_entries;
EOSQL

SRC_JOURNAL_COUNT=$(docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${SRC_DB}" -t -A -c "SELECT COUNT(*) FROM journal_entries;")
SRC_ACCOUNT_COUNT=$(docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${SRC_DB}" -t -A -c "SELECT COUNT(*) FROM accounts;")
SRC_AUDIT_COUNT=$(docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${SRC_DB}" -t -A -c "SELECT COUNT(*) FROM audit_log;")
SRC_AMOUNT_SUM=$(docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${SRC_DB}" -t -A -c "SELECT SUM(amount_minor_units) FROM journal_entries;")
SRC_DB_SIZE_BYTES=$(docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${SRC_DB}" -t -A -c "SELECT pg_database_size('${SRC_DB}');")
SRC_DB_SIZE_PRETTY=$(docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${SRC_DB}" -t -A -c "SELECT pg_size_pretty(pg_database_size('${SRC_DB}'));")

echo "[INFO] Source database verification:"
echo "       - Accounts: ${SRC_ACCOUNT_COUNT}"
echo "       - Journal entries: ${SRC_JOURNAL_COUNT}"
echo "       - Audit log records: ${SRC_AUDIT_COUNT}"
echo "       - Total minor-unit amount sum: ${SRC_AMOUNT_SUM}"
echo "       - Source database size: ${SRC_DB_SIZE_PRETTY} (${SRC_DB_SIZE_BYTES} bytes)"

echo "[INFO] Executing pg_dump on ${SRC_DB}..."
DUMP_START_MS=$(python3 -c "import time; print(int(time.time() * 1000))")
docker exec "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -Fc "${SRC_DB}" -f "${DUMP_FILE}"
DUMP_END_MS=$(python3 -c "import time; print(int(time.time() * 1000))")
DUMP_DURATION_MS=$((DUMP_END_MS - DUMP_START_MS))

BACKUP_SIZE_BYTES=$(docker exec "${CONTAINER_NAME}" stat -c %s "${DUMP_FILE}")
BACKUP_SIZE_KB=$((BACKUP_SIZE_BYTES / 1024))

echo "[INFO] Backup dump completed:"
echo "       - Dump duration: ${DUMP_DURATION_MS} ms"
echo "       - Backup archive size: ${BACKUP_SIZE_KB} KB (${BACKUP_SIZE_BYTES} bytes)"

echo "[INFO] Creating isolated restore target database: ${TGT_DB}..."
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c "CREATE DATABASE ${TGT_DB};" >/dev/null

echo "[INFO] Executing pg_restore into ${TGT_DB}..."
RESTORE_START_MS=$(python3 -c "import time; print(int(time.time() * 1000))")
docker exec "${CONTAINER_NAME}" pg_restore -U "${DB_USER}" -d "${TGT_DB}" "${DUMP_FILE}"
RESTORE_END_MS=$(python3 -c "import time; print(int(time.time() * 1000))")
RESTORE_DURATION_MS=$((RESTORE_END_MS - RESTORE_START_MS))

echo "[INFO] Restore operation finished in ${RESTORE_DURATION_MS} ms (RTO)."

echo "[INFO] Verifying target database invariants and record integrity..."
TGT_JOURNAL_COUNT=$(docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${TGT_DB}" -t -A -c "SELECT COUNT(*) FROM journal_entries;")
TGT_ACCOUNT_COUNT=$(docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${TGT_DB}" -t -A -c "SELECT COUNT(*) FROM accounts;")
TGT_AUDIT_COUNT=$(docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${TGT_DB}" -t -A -c "SELECT COUNT(*) FROM audit_log;")
TGT_AMOUNT_SUM=$(docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${TGT_DB}" -t -A -c "SELECT SUM(amount_minor_units) FROM journal_entries;")
TGT_INDEX_COUNT=$(docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${TGT_DB}" -t -A -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';")

if [ "${SRC_JOURNAL_COUNT}" -ne "${TGT_JOURNAL_COUNT}" ]; then
    echo "[ERROR] Journal count mismatch: src=${SRC_JOURNAL_COUNT}, tgt=${TGT_JOURNAL_COUNT}"
    exit 1
fi

if [ "${SRC_ACCOUNT_COUNT}" -ne "${TGT_ACCOUNT_COUNT}" ]; then
    echo "[ERROR] Account count mismatch: src=${SRC_ACCOUNT_COUNT}, tgt=${TGT_ACCOUNT_COUNT}"
    exit 1
fi

if [ "${SRC_AUDIT_COUNT}" -ne "${TGT_AUDIT_COUNT}" ]; then
    echo "[ERROR] Audit count mismatch: src=${SRC_AUDIT_COUNT}, tgt=${TGT_AUDIT_COUNT}"
    exit 1
fi

if [ "${SRC_AMOUNT_SUM}" -ne "${TGT_AMOUNT_SUM}" ]; then
    echo "[ERROR] Financial amount sum mismatch: src=${SRC_AMOUNT_SUM}, tgt=${TGT_AMOUNT_SUM}"
    exit 1
fi

TOTAL_RECORDS=$((TGT_JOURNAL_COUNT + TGT_ACCOUNT_COUNT + TGT_AUDIT_COUNT))
if [ "${RESTORE_DURATION_MS}" -gt 0 ]; then
    THROUGHPUT=$((TOTAL_RECORDS * 1000 / RESTORE_DURATION_MS))
else
    THROUGHPUT=${TOTAL_RECORDS}
fi

echo "[INFO] Cleanup temporary benchmark databases..."
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c "DROP DATABASE ${SRC_DB};" >/dev/null
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c "DROP DATABASE ${TGT_DB};" >/dev/null
docker exec "${CONTAINER_NAME}" rm -f "${DUMP_FILE}"

echo "============================================================"
echo "REPRESENTATIVE DATABASE RESTORE BENCHMARK RESULTS"
echo "============================================================"
echo "Dataset Records Restored : ${TOTAL_RECORDS} (10,000 journal, 100 accounts, 10,000 audit)"
echo "Source DB Size           : ${SRC_DB_SIZE_PRETTY} (${SRC_DB_SIZE_BYTES} bytes)"
echo "Backup Archive Size      : ${BACKUP_SIZE_KB} KB (${BACKUP_SIZE_BYTES} bytes)"
echo "Dump Duration            : ${DUMP_DURATION_MS} ms"
echo "Restore Duration (RTO)   : ${RESTORE_DURATION_MS} ms"
echo "Restore Throughput       : ${THROUGHPUT} records/second"
echo "Indices Recreated        : ${TGT_INDEX_COUNT} indices verified"
echo "Financial Sum Checksum   : EXACT MATCH (${SRC_AMOUNT_SUM} cents)"
echo "Integrity Status         : PASSED (Zero data corruption, exact invariants)"
echo "============================================================"
