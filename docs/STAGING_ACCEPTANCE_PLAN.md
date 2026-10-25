# Q-Core remote staging acceptance plan

**Purpose:** verify a real, isolated staging deployment—not just unit tests or local Compose. This plan is not evidence that staging is already deployed.

## Evidence record

For each run, record UTC timestamp, git commit, image digest(s), AWS region/account alias (never credentials), task definition revision, RDS engine/version, endpoint hostname, test command, exit status, and sanitized output. Redact tokens, passwords, private key material, customer data and internal IPs if the evidence is shared externally.

## Gate A — deployment and perimeter

- [ ] ALB DNS name resolves to the expected staging ALB.
- [ ] HTTP redirects to HTTPS; certificate chain and hostname validate; TLS 1.2+ policy is enforced (TLS 1.3 preferred where supported by selected ALB security policy).
- [ ] Public ingress is limited to the ALB; task and database endpoints are not publicly reachable.
- [ ] Two distinct ECS task IDs are healthy and registered in the target group.
- [ ] Health endpoint reports operational; health output distinguishes internal crypto self-tests from formal FIPS status.
- [ ] Image digests match the release evidence; container logs contain no secret values.

## Gate B — PostgreSQL and cross-instance behavior

- [ ] Application configuration proves `DATABASE_URL` targets the RDS staging PostgreSQL endpoint, not Sled/local fallback.
- [ ] Database is private; application security group can connect to 5432 and unrelated security groups cannot.
- [ ] Apply migrations from a controlled release step; verify schema version and startup behavior.
- [ ] Submit the same idempotency key and identical payload concurrently through the load balancer; exactly one transaction/receipt is committed and retries return the documented cached outcome.
- [ ] Reuse the idempotency key with a different payload; request is rejected without mutating the original record.
- [ ] Repeat requests pinned to each task (using controlled internal test access) and confirm both tasks observe the same durable idempotency result.
- [ ] Stop one task during a test; requests continue on the remaining healthy task and no duplicate receipt is committed.
- [ ] Restart both tasks sequentially; committed transaction and receipt remain independently verifiable.
- [ ] Confirm DB backup configuration and run a restore drill in an isolated database before claiming recoverability.

## Gate C — receipt/security behavior

- [ ] Submit an authorized, schema-valid synthetic transaction using the documented authenticated API contract.
- [ ] Verify the resulting receipt with the repository's independent offline verifier, with network access disabled during verification.
- [ ] Alter one committed payload byte; verifier rejects it.
- [ ] Submit a previously accepted request again; replay/idempotency behavior matches the API contract.
- [ ] Test invalid authentication, wrong tenant/organization scope and unauthorized policy action; all fail closed.
- [ ] Verify audit linkage connects transaction ID, receipt ID, payload digest, policy version and issuer key fingerprint.
- [ ] Export sanitized evidence bundle and independently recompute its file hashes.

## Gate D — cryptographic/network proof

- [ ] Capture TLS handshake metadata from a client outside the VPC; confirm negotiated version/cipher and certificate identity.
- [ ] For a PQC transport claim, capture the negotiated group and packet evidence from the actual staging path. A local `tc netem` test alone is not proof of WAN negotiation.
- [ ] Verify the configured key provider against the actual target KMS/HSM. Record provider/key identifiers and operation results, never key material.
- [ ] Confirm signing/decryption private key material is not exported when the chosen provider supports non-exportable keys.
- [ ] Report `crypto_self_tests` separately from `fips_140_3_validation`; do not claim formal FIPS certification without an applicable CMVP certificate.

## Gate E — operations

- [ ] Logs, metrics and alarms are enabled; alarms have a named recipient.
- [ ] Secret rotation procedure is tested without logging the secret.
- [ ] Restart, deployment rollback, database backup/restore and teardown procedures are documented and exercised.
- [ ] Cost alert is enabled; staging owner and expiry/review date are recorded.
- [ ] Final evidence report labels each item PASS / FAIL / BLOCKED and links to immutable run artifacts.

## Current blockers

- Cloud account access and cost approval not yet established in this conversation.
- DNS name and ACM certificate ARN not yet supplied.
- ECR image digests and deployed container health/port contract must be confirmed.
- Database and admin secrets must be created in Secrets Manager by an authorized operator.
- Actual KMS/HSM acceptance and external cryptographic review are separate gates.
