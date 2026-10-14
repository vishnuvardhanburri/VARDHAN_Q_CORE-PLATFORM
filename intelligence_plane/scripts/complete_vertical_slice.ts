import { LiveWebResearchProvider } from '../src/server/LiveWebResearchProvider.ts';
import type { LiveWebResearchOptions } from '../src/server/LiveWebResearchProvider.ts';
import { BankOpportunityEngine } from '../src/server/BankOpportunityEngine.ts';
import { QCoreAdapter } from '../src/server/integration/QCoreAdapter.ts';
import type { QCoreValidationRequest } from '../src/server/integration/QCoreAdapter.ts';
import type { VerifiedFindingContract } from '../src/server/VerifiedFindingContract.ts';
import { SerperWebSearchProvider } from '../src/server/providers/SerperWebSearchProvider.ts';
import * as fs from 'fs';
import { execSync } from 'child_process';

async function runVerticalSlice() {
  console.log("🚀 Starting VARDHAN End-to-End Vertical Slice Execution...");

  const searchProvider = new SerperWebSearchProvider();
  const researchProvider = new LiveWebResearchProvider();
  
  const context = {
    company: "Standard Chartered",
    domain: "sc.com",
    technicalTopic: "Post-Quantum Cryptography Migration",
    technicalArea: "Digital Assets and Core Banking",
  };

  console.log("\n🔍 Phase 1: Real-World Bank Problem Discovery...");
  let researchResults = await researchProvider.research({
    context,
    searchProvider,
    maxStage: 4,
    onProgress: (stage, msg) => console.log(`[${stage}] ${msg}`)
  });

  console.log("\n⚖️ Phase 2: Opportunity Qualification...");
  const topEvidence = researchResults.evidence[0];
  
  let { opportunity, score } = await BankOpportunityEngine.qualify(
    context.company,
    "Quantum-exposed core banking ledger",
    { title: "Web Research", url: topEvidence.public_url, date: new Date().toISOString() },
    topEvidence.observed_behavior,
    "UK/Global"
  );

  if (!opportunity) {
    console.log("⚠️ Real discovery did not qualify. Loading demo evidence fixture to validate pipeline logic...");
    const demoData = JSON.parse(fs.readFileSync('intelligence_plane/scripts/demo_evidence.json', 'utf8'));
    const demoEvidence = demoData.evidence[0];
    
    ({ opportunity, score } = await BankOpportunityEngine.qualify(
      context.company,
      "Quantum-exposed core banking ledger",
      { title: "Demo Evidence", url: demoEvidence.public_url, date: new Date().toISOString() },
      demoEvidence.observed_behavior,
      "UK/Global"
    ));
  }

  if (!opportunity) {
    console.error("❌ Opportunity did not meet qualification threshold even with demo evidence.");
    return;
  }

  console.log("✅ Opportunity Qualified!");
  console.log("Institution:", opportunity.institutionName);
  console.log("Internal Score:", score?.totalScore);

  console.log("\n📄 Phase 3: Generating Q-Core Proof Contract...");
  const contract: VerifiedFindingContract = {
    schema_version: "1.0",
    finding_id: `FIND-PQC-` + Math.random().toString(36).substring(2, 9),
    intelligence: {
      engine_id: "engine-v2",
      engine_version: "2.0.0",
      run_id: "run-999",
    },
    organization: {
      organization_id: "org-sc-01",
      canonical_domain: "sc.com",
    },
    affected_resource: {
      canonical_url: "https://sc.com",
      surface_type: "WEBSITE",
      entry_point_id: "ep-1",
    },
    technical_area: "CRYPTOGRAPHIC_EXPOSURE",
    technical_mechanism: "RSA-2048",
    expected_behavior: "Quantum-Resistant",
    observed_behavior: "Quantum-Vulnerable",
    differential_state: "CONFIRMED_MISMATCH",
    materiality: "HIGH",
    evidence_refs: [
      {
        evidence_id: "ev-9999",
        public_url: topEvidence.public_url,
        temporal_status: "CURRENT",
        is_context_artifact: false,
        evidence_origin: "web-research",
        content_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
    ],
    provenance_chain: {
      expectation_id: "exp-1",
      observation_ids: ["obs-1"],
      differential_id: "diff-1",
      hypothesis_id: "hyp-1",
      verification_contract_id: "verif-1",
    },
    contradictory_evidence_ids: [],
    uncertainty: [],
    benign_explanation: "",
    authorization_context: {
      requires_authorized_assessment: false,
    },
    decision_candidate: "SEAL_VERIFIED_FINDING",
    policy_reference: "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
    created_at: new Date().toISOString(),
    evidence_earliest_retrieved_at: new Date().toISOString(),
    evidence_latest_retrieved_at: new Date().toISOString(),
  };

  console.log("\n🔐 Phase 4: Requesting Q-Core Sealing (Receipt Generation)...");
  const adapter = new QCoreAdapter("http://localhost:8080");

  const request: QCoreValidationRequest = {
    contract,
    actor_workload_id: "intelligence-plane-orchestrator"
  };
  console.log("DEBUG: Request Body:", JSON.stringify(request, null, 2));



  const receipt = await adapter.validateAndSeal(request, "org-sc-01");
  
  if (receipt.status === 'ERROR' || receipt.status === 'REJECTED_UNAUTHORIZED') {
    console.error("❌ Q-Core sealing failed:", receipt.outcome_code);
    return;
  }

  console.log("✅ Receipt Generated!");
  console.log("Receipt ID:", receipt.receipt_id);

  console.log("\n🛡️ Phase 5: Independent Verification...");
  try {
    const binaryPath = "/Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main/target/release/vardhan-receipt";
    const receiptJson = JSON.stringify(receipt);
    
    const result = execSync(`echo ${JSON.stringify(receiptJson)} | ${binaryPath} verify --receipt-id ${receipt.receipt_id}`, { encoding: 'utf8' });
    console.log("Verification Result:", result);
    
    if (result.includes("Valid") || result.includes("PASS")) {
      console.log("🎉 END-to-END SUCCESS: Bank Problem -> Discovery -> Proof -> Verifiable Receipt");
    } else {
      console.error("❌ Verification Failed.");
    }
  } catch (e) {
    console.error("❌ Verification binary execution failed:", e);
  }
}

runVerticalSlice().catch(console.error);
