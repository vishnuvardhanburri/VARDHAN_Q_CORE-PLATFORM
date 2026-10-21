use super::{
    migrations, now_ms, IdempotencyError, IdempotencyStore, LifecycleStatus, ReservationOutcome,
};
use async_trait::async_trait;
use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
use std::str::FromStr;
use std::time::Duration;
use tokio_postgres::NoTls;

pub struct PostgresIdempotencyStore {
    pool: Pool,
}

impl PostgresIdempotencyStore {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    /// Construct a clustered store from a DATABASE_URL connection string.
    /// Fails fast if the target database cannot be reached, credentials fail,
    /// or table migrations cannot be completed. Never silently falls back.
    pub async fn from_database_url(
        database_url: &str,
        max_pool_size: usize,
    ) -> Result<Self, IdempotencyError> {
        let pg_config = tokio_postgres::Config::from_str(database_url)
            .map_err(|e| IdempotencyError::Configuration(format!("invalid DATABASE_URL: {e}")))?;

        let mut config = Config::default();
        config.user = pg_config.get_user().map(str::to_owned);
        config.password = pg_config
            .get_password()
            .map(|p| String::from_utf8_lossy(p).into_owned());
        config.dbname = pg_config.get_dbname().map(str::to_owned);

        // Host / port
        let hosts = pg_config.get_hosts();
        let ports = pg_config.get_ports();
        if let Some(host) = hosts.first() {
            match host {
                tokio_postgres::config::Host::Tcp(h) => config.host = Some(h.clone()),
                #[cfg(unix)]
                tokio_postgres::config::Host::Unix(p) => {
                    config.host = Some(p.to_string_lossy().into_owned())
                }
            }
        }
        if let Some(port) = ports.first() {
            config.port = Some(*port);
        }

        config.manager = Some(ManagerConfig {
            recycling_method: RecyclingMethod::Fast,
        });
        config.pool = Some(deadpool_postgres::PoolConfig::new(max_pool_size));

        let pool = config
            .create_pool(Some(Runtime::Tokio1), NoTls)
            .map_err(|e| {
                IdempotencyError::Connection(format!("failed to create postgres pool: {e}"))
            })?;

        // 1. Validate connection with timeout
        let mut client = tokio::time::timeout(Duration::from_secs(5), pool.get())
            .await
            .map_err(|_| {
                IdempotencyError::Connection(
                    "timed out acquiring initial postgres connection after 5 seconds".to_string(),
                )
            })?
            .map_err(|e| {
                IdempotencyError::Connection(format!("postgres initial handshake failed: {e}"))
            })?;

        // 2. Run migrations
        migrations::run_migrations(&mut client).await?;

        // 3. Smoke query verification
        client
            .execute("SELECT 1 FROM qcore_idempotency_records LIMIT 0", &[])
            .await
            .map_err(|e| {
                IdempotencyError::Storage(format!(
                    "smoke check against qcore_idempotency_records failed: {e}"
                ))
            })?;

        tracing::info!("PostgreSQL distributed idempotency store initialized and verified");
        Ok(Self { pool })
    }
}

#[async_trait]
impl IdempotencyStore for PostgresIdempotencyStore {
    async fn reserve(
        &self,
        tenant_id: &str,
        idempotency_key: &str,
        transaction_id: &str,
        payload_hash: &str,
        lease_duration_ms: u64,
        owner_instance_id: &str,
    ) -> Result<ReservationOutcome, IdempotencyError> {
        let mut client = self
            .pool
            .get()
            .await
            .map_err(|e| IdempotencyError::Connection(e.to_string()))?;

        let now = now_ms();
        let lease_expires_at = now.saturating_add(lease_duration_ms) as i64;
        let now_i64 = now as i64;

        // Execute in an explicit transaction
        let tx = client
            .transaction()
            .await
            .map_err(|e| IdempotencyError::Storage(format!("failed to begin reserve tx: {e}")))?;

        let row_opt = tx
            .query_opt(
                "SELECT lifecycle_status, payload_hash, receipt_id, response_payload, owner_instance_id, lease_expires_at_ms \
                 FROM qcore_idempotency_records \
                 WHERE tenant_id = $1 AND idempotency_key = $2 \
                 FOR UPDATE",
                &[&tenant_id, &idempotency_key],
            )
            .await
            .map_err(|e| IdempotencyError::Storage(format!("query lock failed: {e}")))?;

        if let Some(row) = row_opt {
            let status_str: String = row.get(0);
            let raw_hash: String = row.get(1);
            let existing_hash: String = raw_hash.trim().to_string();
            let receipt_id_opt: Option<String> = row.get(2);
            let payload_opt: Option<serde_json::Value> = row.get(3);
            let existing_owner: String = row.get(4);
            let existing_lease_expires: i64 = row.get(5);

            let status = LifecycleStatus::from_str(&status_str)?;

            match status {
                LifecycleStatus::Sealed => {
                    tx.rollback().await.ok();
                    if existing_hash == payload_hash {
                        let r_id = receipt_id_opt.unwrap_or_default();
                        let cached = payload_opt.unwrap_or_else(|| {
                            serde_json::json!({
                                "status": "SEALED",
                                "receipt_id": r_id.clone()
                            })
                        });
                        return Ok(ReservationOutcome::AlreadySealed {
                            receipt_id: r_id,
                            cached_response: cached,
                        });
                    } else {
                        return Ok(ReservationOutcome::PayloadMismatch {
                            existing_payload_hash: existing_hash,
                            submitted_payload_hash: payload_hash.to_string(),
                        });
                    }
                }
                LifecycleStatus::Reserved | LifecycleStatus::Sealing => {
                    if existing_lease_expires as u64 > now {
                        tx.rollback().await.ok();
                        return Ok(ReservationOutcome::InFlight {
                            owner_instance_id: existing_owner,
                            lease_expires_at_ms: existing_lease_expires as u64,
                        });
                    }

                    // Lease expired: previous worker likely crashed. Claim the lease!
                    tx.execute(
                        "UPDATE qcore_idempotency_records \
                         SET lifecycle_status = 'RESERVED', \
                             transaction_id = $3, \
                             payload_hash = $4, \
                             owner_instance_id = $5, \
                             lease_expires_at_ms = $6, \
                             updated_at_ms = $7 \
                         WHERE tenant_id = $1 AND idempotency_key = $2",
                        &[
                            &tenant_id,
                            &idempotency_key,
                            &transaction_id,
                            &payload_hash,
                            &owner_instance_id,
                            &lease_expires_at,
                            &now_i64,
                        ],
                    )
                    .await
                    .map_err(|e| {
                        IdempotencyError::Storage(format!("update expired lease failed: {e}"))
                    })?;

                    tx.commit().await.map_err(|e| {
                        IdempotencyError::Storage(format!("commit lease claim failed: {e}"))
                    })?;

                    return Ok(ReservationOutcome::Reserved {
                        reservation_id: transaction_id.to_string(),
                    });
                }
                LifecycleStatus::Failed => {
                    if existing_hash != payload_hash {
                        tx.rollback().await.ok();
                        return Ok(ReservationOutcome::PayloadMismatch {
                            existing_payload_hash: existing_hash,
                            submitted_payload_hash: payload_hash.to_string(),
                        });
                    }

                    // Allow retry of a previously failed reservation
                    tx.execute(
                        "UPDATE qcore_idempotency_records \
                         SET lifecycle_status = 'RESERVED', \
                             transaction_id = $3, \
                             payload_hash = $4, \
                             owner_instance_id = $5, \
                             lease_expires_at_ms = $6, \
                             updated_at_ms = $7, \
                             failure_reason = NULL \
                         WHERE tenant_id = $1 AND idempotency_key = $2",
                        &[
                            &tenant_id,
                            &idempotency_key,
                            &transaction_id,
                            &payload_hash,
                            &owner_instance_id,
                            &lease_expires_at,
                            &now_i64,
                        ],
                    )
                    .await
                    .map_err(|e| {
                        IdempotencyError::Storage(format!("update failed retry failed: {e}"))
                    })?;

                    tx.commit().await.map_err(|e| {
                        IdempotencyError::Storage(format!("commit retry failed: {e}"))
                    })?;

                    return Ok(ReservationOutcome::Reserved {
                        reservation_id: transaction_id.to_string(),
                    });
                }
            }
        }

        // Row does not exist. Insert brand-new reservation.
        let insert_res = tx
            .execute(
                "INSERT INTO qcore_idempotency_records \
                 (tenant_id, idempotency_key, transaction_id, payload_hash, lifecycle_status, owner_instance_id, lease_expires_at_ms, created_at_ms, updated_at_ms) \
                 VALUES ($1, $2, $3, $4, 'RESERVED', $5, $6, $7, $7)",
                &[
                    &tenant_id,
                    &idempotency_key,
                    &transaction_id,
                    &payload_hash,
                    &owner_instance_id,
                    &lease_expires_at,
                    &now_i64,
                ],
            )
            .await;

        match insert_res {
            Ok(_) => {
                tx.commit()
                    .await
                    .map_err(|e| IdempotencyError::Storage(format!("commit insert failed: {e}")))?;
                Ok(ReservationOutcome::Reserved {
                    reservation_id: transaction_id.to_string(),
                })
            }
            Err(e) => {
                // If unique violation occurred concurrently, abort and report in-flight
                tx.rollback().await.ok();
                if e.code() == Some(&tokio_postgres::error::SqlState::UNIQUE_VIOLATION) {
                    Ok(ReservationOutcome::InFlight {
                        owner_instance_id: "concurrent_winner".to_string(),
                        lease_expires_at_ms: lease_expires_at as u64,
                    })
                } else {
                    Err(IdempotencyError::Storage(format!(
                        "insert reserve failed: {e}"
                    )))
                }
            }
        }
    }

    async fn mark_sealing(
        &self,
        tenant_id: &str,
        idempotency_key: &str,
        transaction_id: &str,
        _owner_instance_id: &str,
    ) -> Result<(), IdempotencyError> {
        let client = self
            .pool
            .get()
            .await
            .map_err(|e| IdempotencyError::Connection(e.to_string()))?;

        let now_i64 = now_ms() as i64;
        let rows = client
            .execute(
                "UPDATE qcore_idempotency_records \
                 SET lifecycle_status = 'SEALING', updated_at_ms = $4 \
                 WHERE tenant_id = $1 AND idempotency_key = $2 AND transaction_id = $3",
                &[&tenant_id, &idempotency_key, &transaction_id, &now_i64],
            )
            .await
            .map_err(|e| IdempotencyError::Storage(format!("mark_sealing failed: {e}")))?;

        if rows == 0 {
            return Err(IdempotencyError::Storage(
                "mark_sealing affected 0 rows (reservation mismatch)".to_string(),
            ));
        }

        Ok(())
    }

    async fn commit_sealed(
        &self,
        tenant_id: &str,
        idempotency_key: &str,
        transaction_id: &str,
        receipt_id: &str,
        receipt_json: &serde_json::Value,
        _owner_instance_id: &str,
    ) -> Result<(), IdempotencyError> {
        let client = self
            .pool
            .get()
            .await
            .map_err(|e| IdempotencyError::Connection(e.to_string()))?;

        let now_i64 = now_ms() as i64;
        let rows = client
            .execute(
                "UPDATE qcore_idempotency_records \
                 SET lifecycle_status = 'SEALED', \
                     receipt_id = $4, \
                     response_payload = $5, \
                     updated_at_ms = $6 \
                 WHERE tenant_id = $1 AND idempotency_key = $2 AND transaction_id = $3",
                &[
                    &tenant_id,
                    &idempotency_key,
                    &transaction_id,
                    &receipt_id,
                    &receipt_json,
                    &now_i64,
                ],
            )
            .await
            .map_err(|e| IdempotencyError::Storage(format!("commit_sealed failed: {e}")))?;

        if rows == 0 {
            return Err(IdempotencyError::Storage(
                "commit_sealed affected 0 rows (reservation mismatch)".to_string(),
            ));
        }

        Ok(())
    }

    async fn release_or_fail(
        &self,
        tenant_id: &str,
        idempotency_key: &str,
        transaction_id: &str,
        failure_reason: &str,
        _owner_instance_id: &str,
    ) -> Result<(), IdempotencyError> {
        let client = self
            .pool
            .get()
            .await
            .map_err(|e| IdempotencyError::Connection(e.to_string()))?;

        let now_i64 = now_ms() as i64;
        client
            .execute(
                "UPDATE qcore_idempotency_records \
                 SET lifecycle_status = 'FAILED', \
                     failure_reason = $4, \
                     updated_at_ms = $5 \
                 WHERE tenant_id = $1 AND idempotency_key = $2 AND transaction_id = $3",
                &[
                    &tenant_id,
                    &idempotency_key,
                    &transaction_id,
                    &failure_reason,
                    &now_i64,
                ],
            )
            .await
            .map_err(|e| IdempotencyError::Storage(format!("release_or_fail failed: {e}")))?;

        Ok(())
    }

    async fn check_health(&self) -> Result<(), IdempotencyError> {
        let client = self
            .pool
            .get()
            .await
            .map_err(|e| IdempotencyError::Connection(e.to_string()))?;

        client
            .execute("SELECT 1", &[])
            .await
            .map_err(|e| IdempotencyError::Connection(format!("ping query failed: {e}")))?;

        Ok(())
    }

    fn backend_name(&self) -> &'static str {
        "postgresql_cluster"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_postgres_idempotency_lifecycle() {
        let db_url = std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| {
            "postgresql://postgres:qcore_secret@127.0.0.1:5433/qcore_test".to_string()
        });

        let store = match PostgresIdempotencyStore::from_database_url(&db_url, 10).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Skipping live postgres test: {e}");
                return;
            }
        };

        let tenant = "tenant-pg-test";
        let key = format!("pg-key-{}", uuid::Uuid::new_v4());
        let p_hash = "blake3-hash-pg-1";
        let tx1 = "tx-pg-1";

        // 1. Initial reservation
        let res = store
            .reserve(tenant, &key, tx1, p_hash, 5_000, "pg-node-1")
            .await
            .unwrap();
        assert!(matches!(res, ReservationOutcome::Reserved { .. }));

        // 2. Concurrent reservation while lease is active
        let res2 = store
            .reserve(tenant, &key, "tx-pg-2", p_hash, 5_000, "pg-node-2")
            .await
            .unwrap();
        assert!(matches!(res2, ReservationOutcome::InFlight { .. }));

        // 3. Mark sealing
        store
            .mark_sealing(tenant, &key, tx1, "pg-node-1")
            .await
            .unwrap();

        // 4. Commit sealed
        let receipt = serde_json::json!({
            "receipt_id": "rcpt-pg-001",
            "status": "SEALED",
            "decision": "SEAL_VERIFIED_FINDING"
        });
        store
            .commit_sealed(tenant, &key, tx1, "rcpt-pg-001", &receipt, "pg-node-1")
            .await
            .unwrap();

        // 5. Identical retry
        let res3 = store
            .reserve(tenant, &key, "tx-pg-3", p_hash, 5_000, "pg-node-2")
            .await
            .unwrap();
        match res3 {
            ReservationOutcome::AlreadySealed {
                receipt_id,
                cached_response,
            } => {
                assert_eq!(receipt_id, "rcpt-pg-001");
                assert_eq!(cached_response["status"], "SEALED");
            }
            other => panic!("expected AlreadySealed, got {:?}", other),
        }

        // 6. Conflicting payload
        let res4 = store
            .reserve(tenant, &key, "tx-pg-4", "diff-hash", 5_000, "pg-node-1")
            .await
            .unwrap();
        assert!(matches!(res4, ReservationOutcome::PayloadMismatch { .. }));

        // 7. Same key under different tenant
        let res5 = store
            .reserve(
                "tenant-pg-other",
                &key,
                "tx-pg-5",
                p_hash,
                5_000,
                "pg-node-1",
            )
            .await
            .unwrap();
        assert!(matches!(res5, ReservationOutcome::Reserved { .. }));

        // 8. Health check
        store.check_health().await.unwrap();
    }

    #[tokio::test]
    async fn test_postgres_expired_lease_recovery() {
        let db_url = std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| {
            "postgresql://postgres:qcore_secret@127.0.0.1:5433/qcore_test".to_string()
        });

        let store = match PostgresIdempotencyStore::from_database_url(&db_url, 10).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Skipping live postgres test: {e}");
                return;
            }
        };

        let tenant = "tenant-pg-recovery";
        let key = format!("pg-expired-{}", uuid::Uuid::new_v4());
        let p_hash = "blake3-hash";

        // Reserve with 0ms lease so it immediately expires
        let res = store
            .reserve(tenant, &key, "tx-crashed", p_hash, 0, "crashed-worker")
            .await
            .unwrap();
        assert!(matches!(res, ReservationOutcome::Reserved { .. }));

        // Wait 2ms
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;

        // Peer worker recovers the expired lease
        let res2 = store
            .reserve(
                tenant,
                &key,
                "tx-recovered",
                p_hash,
                10_000,
                "healthy-worker",
            )
            .await
            .unwrap();
        assert!(matches!(res2, ReservationOutcome::Reserved { .. }));
    }
}
