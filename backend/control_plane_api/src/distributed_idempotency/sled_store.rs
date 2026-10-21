use super::{now_ms, IdempotencyError, IdempotencyStore, LifecycleStatus, ReservationOutcome};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sled::transaction::ConflictableTransactionError;
use sled::Db;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredIdempotencyRecord {
    tenant_id: String,
    idempotency_key: String,
    transaction_id: String,
    payload_hash: String,
    lifecycle_status: LifecycleStatus,
    receipt_id: Option<String>,
    response_payload: Option<serde_json::Value>,
    owner_instance_id: String,
    lease_expires_at_ms: u64,
    created_at_ms: u64,
    updated_at_ms: u64,
    failure_reason: Option<String>,
}

pub struct SledIdempotencyStore {
    db: Arc<Db>,
}

impl SledIdempotencyStore {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }

    fn key_bytes(tenant_id: &str, idempotency_key: &str) -> Vec<u8> {
        format!("qcore:idem:{tenant_id}:{idempotency_key}").into_bytes()
    }
}

#[async_trait]
impl IdempotencyStore for SledIdempotencyStore {
    async fn reserve(
        &self,
        tenant_id: &str,
        idempotency_key: &str,
        transaction_id: &str,
        payload_hash: &str,
        lease_duration_ms: u64,
        owner_instance_id: &str,
    ) -> Result<ReservationOutcome, IdempotencyError> {
        let key = Self::key_bytes(tenant_id, idempotency_key);
        let now = now_ms();
        let lease_expires_at = now.saturating_add(lease_duration_ms);

        let t_id = tenant_id.to_string();
        let i_key = idempotency_key.to_string();
        let tx_id = transaction_id.to_string();
        let p_hash = payload_hash.to_string();
        let o_id = owner_instance_id.to_string();

        let outcome = self
            .db
            .transaction::<_, _, String>(|tree| {
                if let Some(existing_bytes) = tree.get(key.as_slice())? {
                    let record: StoredIdempotencyRecord =
                        match serde_json::from_slice(&existing_bytes) {
                            Ok(r) => r,
                            Err(_) => {
                                return Ok(ReservationOutcome::ReplayRejected {
                                    reason: "corrupted stored idempotency record".to_string(),
                                });
                            }
                        };

                    match record.lifecycle_status {
                        LifecycleStatus::Sealed => {
                            if record.payload_hash == p_hash {
                                let r_id = record.receipt_id.unwrap_or_default();
                                let cached = record.response_payload.unwrap_or_else(|| {
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
                                    existing_payload_hash: record.payload_hash,
                                    submitted_payload_hash: p_hash.clone(),
                                });
                            }
                        }
                        LifecycleStatus::Reserved | LifecycleStatus::Sealing => {
                            if record.lease_expires_at_ms > now {
                                return Ok(ReservationOutcome::InFlight {
                                    owner_instance_id: record.owner_instance_id,
                                    lease_expires_at_ms: record.lease_expires_at_ms,
                                });
                            }

                            // Lease expired: claim expired reservation
                            let new_record = StoredIdempotencyRecord {
                                tenant_id: t_id.clone(),
                                idempotency_key: i_key.clone(),
                                transaction_id: tx_id.clone(),
                                payload_hash: p_hash.clone(),
                                lifecycle_status: LifecycleStatus::Reserved,
                                receipt_id: None,
                                response_payload: None,
                                owner_instance_id: o_id.clone(),
                                lease_expires_at_ms: lease_expires_at,
                                created_at_ms: record.created_at_ms,
                                updated_at_ms: now,
                                failure_reason: None,
                            };
                            let bytes = match serde_json::to_vec(&new_record) {
                                Ok(b) => b,
                                Err(e) => {
                                    return Err(ConflictableTransactionError::Abort(e.to_string()))
                                }
                            };
                            tree.insert(key.as_slice(), bytes.as_slice())?;
                            return Ok(ReservationOutcome::Reserved {
                                reservation_id: tx_id.clone(),
                            });
                        }
                        LifecycleStatus::Failed => {
                            if record.payload_hash != p_hash {
                                return Ok(ReservationOutcome::PayloadMismatch {
                                    existing_payload_hash: record.payload_hash,
                                    submitted_payload_hash: p_hash.clone(),
                                });
                            }

                            // Allow retry of previously failed operation
                            let new_record = StoredIdempotencyRecord {
                                tenant_id: t_id.clone(),
                                idempotency_key: i_key.clone(),
                                transaction_id: tx_id.clone(),
                                payload_hash: p_hash.clone(),
                                lifecycle_status: LifecycleStatus::Reserved,
                                receipt_id: None,
                                response_payload: None,
                                owner_instance_id: o_id.clone(),
                                lease_expires_at_ms: lease_expires_at,
                                created_at_ms: record.created_at_ms,
                                updated_at_ms: now,
                                failure_reason: None,
                            };
                            let bytes = match serde_json::to_vec(&new_record) {
                                Ok(b) => b,
                                Err(e) => {
                                    return Err(ConflictableTransactionError::Abort(e.to_string()))
                                }
                            };
                            tree.insert(key.as_slice(), bytes.as_slice())?;
                            return Ok(ReservationOutcome::Reserved {
                                reservation_id: tx_id.clone(),
                            });
                        }
                    }
                }

                // New key
                let new_record = StoredIdempotencyRecord {
                    tenant_id: t_id.clone(),
                    idempotency_key: i_key.clone(),
                    transaction_id: tx_id.clone(),
                    payload_hash: p_hash.clone(),
                    lifecycle_status: LifecycleStatus::Reserved,
                    receipt_id: None,
                    response_payload: None,
                    owner_instance_id: o_id.clone(),
                    lease_expires_at_ms: lease_expires_at,
                    created_at_ms: now,
                    updated_at_ms: now,
                    failure_reason: None,
                };
                let bytes = match serde_json::to_vec(&new_record) {
                    Ok(b) => b,
                    Err(e) => return Err(ConflictableTransactionError::Abort(e.to_string())),
                };
                tree.insert(key.as_slice(), bytes.as_slice())?;
                Ok(ReservationOutcome::Reserved {
                    reservation_id: tx_id.clone(),
                })
            })
            .map_err(|e| IdempotencyError::Storage(format!("{e:?}")))?;

        // Fsync guarantee
        self.db
            .flush_async()
            .await
            .map_err(|e| IdempotencyError::Storage(e.to_string()))?;

        Ok(outcome)
    }

    async fn mark_sealing(
        &self,
        tenant_id: &str,
        idempotency_key: &str,
        transaction_id: &str,
        _owner_instance_id: &str,
    ) -> Result<(), IdempotencyError> {
        let key = Self::key_bytes(tenant_id, idempotency_key);
        let now = now_ms();
        let tx_id = transaction_id.to_string();

        self.db
            .transaction::<_, _, String>(|tree| {
                if let Some(existing_bytes) = tree.get(key.as_slice())? {
                    if let Ok(mut record) =
                        serde_json::from_slice::<StoredIdempotencyRecord>(&existing_bytes)
                    {
                        if record.transaction_id == tx_id {
                            record.lifecycle_status = LifecycleStatus::Sealing;
                            record.updated_at_ms = now;
                            let bytes = match serde_json::to_vec(&record) {
                                Ok(b) => b,
                                Err(e) => {
                                    return Err(ConflictableTransactionError::Abort(e.to_string()))
                                }
                            };
                            tree.insert(key.as_slice(), bytes.as_slice())?;
                        }
                    }
                }
                Ok(())
            })
            .map_err(|e| IdempotencyError::Storage(format!("{e:?}")))?;

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
        let key = Self::key_bytes(tenant_id, idempotency_key);
        let now = now_ms();
        let tx_id = transaction_id.to_string();
        let r_id = receipt_id.to_string();
        let r_json = receipt_json.clone();

        self.db
            .transaction::<_, _, String>(|tree| {
                if let Some(existing_bytes) = tree.get(key.as_slice())? {
                    if let Ok(mut record) =
                        serde_json::from_slice::<StoredIdempotencyRecord>(&existing_bytes)
                    {
                        if record.transaction_id == tx_id {
                            record.lifecycle_status = LifecycleStatus::Sealed;
                            record.receipt_id = Some(r_id.clone());
                            record.response_payload = Some(r_json.clone());
                            record.updated_at_ms = now;
                            let bytes = match serde_json::to_vec(&record) {
                                Ok(b) => b,
                                Err(e) => {
                                    return Err(ConflictableTransactionError::Abort(e.to_string()))
                                }
                            };
                            tree.insert(key.as_slice(), bytes.as_slice())?;
                        }
                    }
                }
                Ok(())
            })
            .map_err(|e| IdempotencyError::Storage(format!("{e:?}")))?;

        self.db
            .flush_async()
            .await
            .map_err(|e| IdempotencyError::Storage(e.to_string()))?;

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
        let key = Self::key_bytes(tenant_id, idempotency_key);
        let now = now_ms();
        let tx_id = transaction_id.to_string();
        let reason = failure_reason.to_string();

        self.db
            .transaction::<_, _, String>(|tree| {
                if let Some(existing_bytes) = tree.get(key.as_slice())? {
                    if let Ok(mut record) =
                        serde_json::from_slice::<StoredIdempotencyRecord>(&existing_bytes)
                    {
                        if record.transaction_id == tx_id {
                            record.lifecycle_status = LifecycleStatus::Failed;
                            record.failure_reason = Some(reason.clone());
                            record.updated_at_ms = now;
                            let bytes = match serde_json::to_vec(&record) {
                                Ok(b) => b,
                                Err(e) => {
                                    return Err(ConflictableTransactionError::Abort(e.to_string()))
                                }
                            };
                            tree.insert(key.as_slice(), bytes.as_slice())?;
                        }
                    }
                }
                Ok(())
            })
            .map_err(|e| IdempotencyError::Storage(format!("{e:?}")))?;

        Ok(())
    }

    async fn check_health(&self) -> Result<(), IdempotencyError> {
        self.db
            .get(b"__health_check__")
            .map_err(|e| IdempotencyError::Storage(e.to_string()))?;
        Ok(())
    }

    fn backend_name(&self) -> &'static str {
        "sled_embedded"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_store() -> SledIdempotencyStore {
        let db = sled::Config::new().temporary(true).open().unwrap();
        SledIdempotencyStore::new(Arc::new(db))
    }

    #[tokio::test]
    async fn test_full_idempotency_lifecycle() {
        let store = create_test_store();
        let tenant = "tenant-a";
        let key = "idem-key-001";
        let payload_hash = "blake3-hash-payload-1";
        let tx1 = "tx-001";
        let instance = "node-1";

        // 1. Initial reservation succeeds
        let res = store
            .reserve(tenant, key, tx1, payload_hash, 5_000, instance)
            .await
            .unwrap();
        assert!(matches!(res, ReservationOutcome::Reserved { .. }));

        // 2. Concurrent reservation while lease is active returns InFlight
        let res2 = store
            .reserve(tenant, key, "tx-002", payload_hash, 5_000, "node-2")
            .await
            .unwrap();
        assert!(matches!(res2, ReservationOutcome::InFlight { .. }));

        // 3. Mark sealing
        store
            .mark_sealing(tenant, key, tx1, instance)
            .await
            .unwrap();

        // 4. Commit sealed
        let receipt_payload = serde_json::json!({
            "receipt_id": "rcpt-001",
            "status": "SEALED",
            "decision": "SEAL_VERIFIED_FINDING"
        });
        store
            .commit_sealed(tenant, key, tx1, "rcpt-001", &receipt_payload, instance)
            .await
            .unwrap();

        // 5. Identical retry with matching payload hash returns AlreadySealed
        let res3 = store
            .reserve(tenant, key, "tx-003", payload_hash, 5_000, "node-2")
            .await
            .unwrap();
        match res3 {
            ReservationOutcome::AlreadySealed {
                receipt_id,
                cached_response,
            } => {
                assert_eq!(receipt_id, "rcpt-001");
                assert_eq!(cached_response["status"], "SEALED");
            }
            other => panic!("expected AlreadySealed, got {:?}", other),
        }

        // 6. Conflicting payload returns PayloadMismatch
        let res4 = store
            .reserve(
                tenant,
                key,
                "tx-004",
                "blake3-different-hash",
                5_000,
                instance,
            )
            .await
            .unwrap();
        assert!(matches!(res4, ReservationOutcome::PayloadMismatch { .. }));

        // 7. Same key under different tenant is completely isolated
        let res5 = store
            .reserve("tenant-b", key, "tx-005", payload_hash, 5_000, instance)
            .await
            .unwrap();
        assert!(matches!(res5, ReservationOutcome::Reserved { .. }));
    }

    #[tokio::test]
    async fn test_expired_lease_recovery() {
        let store = create_test_store();
        let tenant = "tenant-a";
        let key = "idem-key-expired";
        let payload_hash = "blake3-hash";

        // Reserve with 0ms lease so it immediately expires
        let res = store
            .reserve(tenant, key, "tx-old", payload_hash, 0, "crashed-node")
            .await
            .unwrap();
        assert!(matches!(res, ReservationOutcome::Reserved { .. }));

        // Wait 2ms
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;

        // Peer node can recover the expired lease
        let res2 = store
            .reserve(tenant, key, "tx-new", payload_hash, 10_000, "recovery-node")
            .await
            .unwrap();
        assert!(matches!(res2, ReservationOutcome::Reserved { .. }));
    }
}
