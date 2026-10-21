use super::IdempotencyError;
use deadpool_postgres::Client;

pub struct Migration {
    pub version: i32,
    pub name: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "init_idempotency_records",
        sql: r#"
        CREATE TABLE IF NOT EXISTS qcore_schema_migrations (
            version INT PRIMARY KEY,
            name VARCHAR(128) NOT NULL,
            applied_at_ms BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS qcore_idempotency_records (
            tenant_id VARCHAR(128) NOT NULL,
            idempotency_key VARCHAR(256) NOT NULL,
            transaction_id VARCHAR(128) NOT NULL,
            payload_hash VARCHAR(128) NOT NULL,
            lifecycle_status VARCHAR(32) NOT NULL,
            receipt_id VARCHAR(128),
            response_payload JSONB,
            owner_instance_id VARCHAR(128) NOT NULL,
            lease_expires_at_ms BIGINT NOT NULL,
            created_at_ms BIGINT NOT NULL,
            updated_at_ms BIGINT NOT NULL,
            failure_reason TEXT,
            PRIMARY KEY (tenant_id, idempotency_key)
        );

        CREATE INDEX IF NOT EXISTS idx_qcore_idem_lease 
            ON qcore_idempotency_records (lifecycle_status, lease_expires_at_ms);

        CREATE INDEX IF NOT EXISTS idx_qcore_idem_tx_id 
            ON qcore_idempotency_records (transaction_id);
    "#,
    },
    Migration {
        version: 2,
        name: "widen_payload_hash",
        sql: r#"
        ALTER TABLE qcore_idempotency_records 
            ALTER COLUMN payload_hash TYPE VARCHAR(128);
    "#,
    },
];

pub async fn run_migrations(client: &mut Client) -> Result<(), IdempotencyError> {
    // Acquire advisory lock to ensure concurrent nodes/threads serialize migration checks
    client
        .batch_execute("SELECT pg_advisory_lock(9248720194829104);")
        .await
        .map_err(|e| {
            IdempotencyError::Storage(format!("failed to acquire migration advisory lock: {e}"))
        })?;

    let res = run_migrations_inner(client).await;

    // Always release advisory lock
    let _ = client
        .batch_execute("SELECT pg_advisory_unlock(9248720194829104);")
        .await;

    res
}

async fn run_migrations_inner(client: &mut Client) -> Result<(), IdempotencyError> {
    // 1. Ensure migrations table exists
    client
        .batch_execute(
            r#"
            CREATE TABLE IF NOT EXISTS qcore_schema_migrations (
                version INT PRIMARY KEY,
                name VARCHAR(128) NOT NULL,
                applied_at_ms BIGINT NOT NULL
            );
        "#,
        )
        .await
        .map_err(|e| {
            IdempotencyError::Storage(format!("failed to initialize migrations table: {e}"))
        })?;

    // 2. Run pending migrations in transaction
    for migration in MIGRATIONS {
        let rows = client
            .query(
                "SELECT version FROM qcore_schema_migrations WHERE version = $1",
                &[&migration.version],
            )
            .await
            .map_err(|e| {
                IdempotencyError::Storage(format!("failed to check migration version: {e}"))
            })?;

        if rows.is_empty() {
            let tx = client.transaction().await.map_err(|e| {
                IdempotencyError::Storage(format!("failed to begin migration tx: {e}"))
            })?;

            tx.batch_execute(migration.sql).await.map_err(|e| {
                IdempotencyError::Storage(format!(
                    "failed to execute migration {} ({}): {e}",
                    migration.version, migration.name
                ))
            })?;

            let now = super::now_ms() as i64;
            tx.execute(
                "INSERT INTO qcore_schema_migrations (version, name, applied_at_ms) VALUES ($1, $2, $3)",
                &[&migration.version, &migration.name, &now],
            )
            .await
            .map_err(|e| {
                IdempotencyError::Storage(format!("failed to record migration completion: {e}"))
            })?;

            tx.commit().await.map_err(|e| {
                IdempotencyError::Storage(format!("failed to commit migration tx: {e}"))
            })?;

            tracing::info!(
                version = migration.version,
                name = migration.name,
                "Applied database migration successfully"
            );
        }
    }

    Ok(())
}
