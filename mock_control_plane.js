const http = require('http');

const server = http.createServer((req, res) => {
  console.log(`Request: ${req.method} ${req.url}`);
  
  if (req.url.startsWith('/api/v1/organizations/') && req.url.endsWith('/security/validate') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const payload = JSON.parse(body);
      console.log('Received validation request for:', payload.contract.organization.name);
      
      const receipt = {
        receipt_id: 'VQR-MOCK-12345',
        schema_version: '1.1',
        transaction_id: 'TX-MOCK-67890',
        status: 'SEALED',
        tenant_id: payload.contract.organization.organization_id,
        subject_id: payload.contract.finding.finding_id,
        actor_identity: payload.actor_workload_id,
        proposed_action: 'MIGRATE',
        policy_id: payload.contract.capability_mapping.capability_id,
        policy_version: '1.0',
        evidence_commitments: [],
        authority_reference: 'MOCK-AUTHORITY',
        decision: 'AUTHORIZED',
        outcome_code: 'OK',
        timestamp_ms: Date.now(),
        ledger_commit_index: 100,
        payload_hash: 'MOCK_HASH_VQR_123',
        issuer_key_fingerprint: 'MOCK_FINGERPRINT_456',
        signatures: {
          ed25519_sig: 'mock_ed_sig_123',
          ed25519_key_id: 'ed-mock-1',
          ml_dsa_87_sig: 'mock_pq_sig_456',
          ml_dsa_87_key_id: 'pq-mock-1'
        }
      };
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(receipt));
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(8080, () => {
  console.log('Mock Control Plane API listening on port 8080');
});
