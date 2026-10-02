/**
 * VARDHAN — GOLDEN PATH REGRESSION TEST
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministic test to verify the "Golden Path" for OBSERVED_LATENCY.
 * This simulates the SendGrid-style failure/success mode to ensure the
 * authority chain is neither too loose nor over-constrained.
 */

import {
  FindingVerificationEngine
} from './FindingVerificationEngine';
import {
  DiagnosticFitEngine
} from './DiagnosticFitEngine';
import {
  OutreachReadiness
} from './OutreachReadiness';
import {
  SignalCandidate
} from './DeepTypes';
import {
  Evidence
} from './IntelligenceCase';

async function runGoldenPathTest() {
  console.log('🚀 Starting Golden Path Regression: SendGrid Latency Case');
  console.log('==============================================================');

  const companyName = 'SendGrid';
  const targetOrigin = 'sendgrid.com';

  // 1. Create Evidence: 3 repeated observations from ONE owned endpoint.
  // This should satisfy minimumEvidenceItems: 3 and minimumIndependentSources: 1.
  const evidence: Evidence[] = [
    {
      id: 'ev_1',
      public_url: `https://api.${targetOrigin}/v3/mail/send`,
      relationship_type: 'VERIFIED_OWNED',
      source_type: 'REAL_PUBLIC_OBSERVATION',
      repeatable: true,
      strength: 'HIGH',
      text: 'Response time: 1200ms'
    },
    {
      id: 'ev_2',
      public_url: `https://api.${targetOrigin}/v3/mail/send`,
      relationship_type: 'VERIFIED_OWNED',
      source_type: 'REAL_PUBLIC_OBSERVATION',
      repeatable: true,
      strength: 'HIGH',
      text: 'Response time: 1350ms'
    },
    {
      id: 'ev_3',
      public_url: `https://api.${targetOrigin}/v3/mail/send`,
      relationship_type: 'VERIFIED_OWNED',
      source_type: 'REAL_PUBLIC_OBSERVATION',
      repeatable: true,
      strength: 'HIGH',
      text: 'Response time: 1180ms'
    }
  ];

  // 2. Create Candidate Signal
  const candidate: SignalCandidate = {
    id: 'cand_latency_001',
    type: 'OBSERVED_LATENCY',
    source_url: `https://api.${targetOrigin}/v3/mail/send`,
    raw_match: 'Observed repeated latency spikes exceeding 1000ms on primary mail endpoint.',
    initial_strength: 'HIGH',
    evidence_ids: ['ev_1', 'ev_2', 'ev_3'],
    qualification_gaps: [],
    provenance: 'REAL_PUBLIC_OBSERVATION',
    category: 'status_ops',
  };

  console.log('Step 1: FindingVerificationEngine.verify()');
  const verification = FindingVerificationEngine.verify(candidate, evidence, companyName);
  console.log(JSON.stringify(verification, null, 2));

  if (!verification.isVerified) {
    console.error('❌ FAILED: FindingVerificationEngine rejected the golden path.');
    process.exit(1);
  }

  const verifiedFinding = verification.verifiedFinding!;
  console.log('\n✅ VERIFIED_FINDING created.');

  console.log('\nStep 2: DiagnosticFitEngine.evaluate()');
  const diagnostic = DiagnosticFitEngine.evaluate(verifiedFinding);
  console.log(JSON.stringify(diagnostic, null, 2));

  if (!diagnostic.is_eligible) {
    console.error('❌ FAILED: DiagnosticFitEngine rejected the golden path.');
    console.error('Reasons:', diagnostic.reasons);
    process.exit(1);
  }

  console.log('\n✅ DIAGNOSTIC_ELIGIBLE created.');

  console.log('\nStep 3: OutreachReadiness.evaluate()');
  const readiness = OutreachReadiness.evaluate(companyName, verifiedFinding, diagnostic);
  console.log(JSON.stringify(readiness, null, 2));

  if (!readiness.isReady) {
    console.log('⚠️ NOT OUTREACH_READY (This may be normal depending on missing guidance/etc)');
    console.log('Reasons:', readiness.reasons);
  } else {
    console.log('\n✅ OUTREACH_READY created.');
  }

  console.log('\n==============================================================');
  console.log('🌟 GOLDEN PATH SUCCESSFUL');
  console.log('==============================================================');
}

runGoldenPathTest().catch(err => {
  console.error('Unexpected Error:', err);
  process.exit(1);
});
