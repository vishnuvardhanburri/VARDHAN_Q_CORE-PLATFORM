import { Evidence, InvestigationHypothesis } from './src/server/IntelligenceCase';
import { EntryPoint } from './src/server/EntryPointModel';
import { ExpectationEngine } from './src/server/ExpectationEngine';
import { OpportunityDecisionEngine } from './src/server/discovery/OpportunityDecisionEngine';
import { FindingVerificationEngine } from './src/server/FindingVerificationEngine';
import { ApiOperationParser } from './src/server/ApiOperationParser';

function makeEp(id: string, url: string, isContext: boolean = false, verificationEligible: boolean = true): EntryPoint {
    return {
        entry_point_id: id,
        organization_id: "org-1",
        canonical_domain: "example.com",
        surface_url: url,
        canonical_url: url,
        hostname: "example.com",
        reference: "",
        surface_type: "API_REST",
        semantic_roles: ["API_REST"],
        functional_role: "DATA_API",
        protocol: "HTTPS",
        method: "GET",
        authentication_model: "UNKNOWN",
        authorization_model: "UNKNOWN",
        tenant_boundary: "UNKNOWN",
        is_context_artifact: isContext,
        verification_eligibility: { eligible: verificationEligible, reason: "test", limitations: [] },
        evidence_ids: [id + "_ev"],
        relationships: [],
        status: "ACTIVE",
        temporal_status: "CURRENT",
        discovery_confidence: "HIGH",
        provenance: []
    };
}

const caseICurlEvidence: Evidence = {
    id: "ep_case_i_ev", evidence_type: "DOCUMENTED_SOURCE", company_id: "org-1",
    public_url: "https://example.com/api/v1/public-data", temporal_status: "CURRENT",
    factualObservation: "curl -X GET https://example.com/api/v1/public-data", evidence_origin: "DOCUMENTED_SOURCE"
};

const caseJCurlEvidence: Evidence = {
    id: "ep_case_j_ev", evidence_type: "DOCUMENTED_SOURCE", company_id: "org-1",
    public_url: "https://example.com/api/v1/status", temporal_status: "CURRENT",
    factualObservation: "Bearer token authentication is required for some endpoints. Here is the status endpoint: curl -X GET https://example.com/api/v1/status", evidence_origin: "DOCUMENTED_SOURCE"
};

const caseNEvidence: Evidence = {
    id: "ep_case_n_ev", evidence_type: "INFERENCE", company_id: "org-1",
    public_url: "https://github.com/example/repo/issues/1", temporal_status: "CURRENT",
    factualObservation: "We should add a login endpoint at /api/login that requires auth.",
    structured_data: { auth_requirement: 'REQUIRED' }, evidence_origin: "DOCUMENTED_SOURCE"
};

const caseGEvidence: Evidence = {
    id: "ep_case_g_ev", evidence_type: "FACT", company_id: "org-1",
    public_url: "https://example.com/api/v1/old-endpoint", temporal_status: "HISTORICAL",
    structured_data: { auth_requirement: 'REQUIRED' }, evidence_origin: "DOCUMENTED_SOURCE"
};

async function runBenchmark() {
    console.log("=========================================");
    console.log("INTELLIGENCE REALITY BENCHMARK EXECUTING");
    console.log("=========================================");
    
    let passCount = 0;
    let failCount = 0;

    const assert = (condition: boolean, msg: string) => {
        if (condition) {
            console.log(`[PASS] ${msg}`);
            passCount++;
        } else {
            console.error(`[FAIL] ${msg}`);
            failCount++;
        }
    };

    const parser = new ApiOperationParser();
    const opsI = await parser.extractOperations([caseICurlEvidence]);
    assert(opsI[0].authRequirement === 'UNKNOWN', "Case I: API Without Auth Header correctly parsed as UNKNOWN");

    const opsJ = await parser.extractOperations([caseJCurlEvidence]);
    assert(opsJ[0].authRequirement === 'UNKNOWN', "Case J: Doc mentioning 'Bearer' but curl missing header parsed as UNKNOWN");
    assert(opsJ[0].operationId.startsWith('curl_'), "Determinism: operationId is stable hash-based");

    const expectationEngine = new ExpectationEngine();
    
    const epN = makeEp("ep_case_n", "https://github.com/example/repo/issues/1", true, false);
    const exN = expectationEngine.generate([epN], [caseNEvidence], {nodes:[], edges:[], metrics: {} as any});
    assert(!exN.some(e => e.expectation_type === 'AUTH_REQUIRED'), "Case N: Context artifact suppressed AUTH_REQUIRED verification expectations");

    const epG = makeEp("ep_case_g", "https://example.com/api/v1/old-endpoint", false, true);
    const exG = expectationEngine.generate([epG], [caseGEvidence], {nodes:[], edges:[], metrics: {} as any});
    assert(!exG.some(e => e.expectation_type === 'AUTH_REQUIRED'), "Case G: Historical evidence suppressed current AUTH_REQUIRED expectation");

    const mockHypothesisN: any = { type: 'OBSERVED_LATENCY', evidence_ids: ["ep_case_n_ev"], evidenceIds: ["ep_case_n_ev"] };
    const resContext = FindingVerificationEngine.verify(mockHypothesisN, [caseNEvidence], "Example");
    assert(resContext.isVerified === false && resContext.reasons.some(r => r.includes("PHYSICAL_SURFACE_FAILURE")), "Verification Engine strictly rejects context artifacts for physical vulnerabilities");

    const mockHypothesisG: any = { type: 'OBSERVED_LATENCY', evidence_ids: ["ep_case_g_ev"], evidenceIds: ["ep_case_g_ev"] };
    const resHistorical = FindingVerificationEngine.verify(mockHypothesisG, [caseGEvidence], "Example");
    assert(resHistorical.isVerified === false && resHistorical.reasons.some(r => r.includes("TEMPORAL_CONTAMINATION")), "Verification Engine strictly rejects historical contamination");

    const decisionEngine = new OpportunityDecisionEngine();
    const weakHyp: InvestigationHypothesis = {
        id: "h1", technicalArea: "Auth", statement: "Weak guess", technical_mechanism: "none",
        evidenceIds: ["ev1"], contradictory_evidence_ids: ["ev2"], uncertainty: [],
        affected_surface: "", expected_behavior: "", observed_behavior: "", materiality_rationale: "",
        required_verification: "", benign_explanation: "", confidence_rationale: "", confidence: 0.6,
        status: "HYPOTHESIS"
    };
    // add 'type' to hypothesis for the mock engine so it doesn't crash on isAdvisoryType
    (weakHyp as any).type = 'test';
    
    const decision = await decisionEngine.decide("org", [{id:"ev1"} as any, {id:"ev2"} as any], ["sig1"], {nodes:["n1"]}, {} as any, [], [], [weakHyp], [], {});
    assert(decision.state !== 'INVESTIGATION_OPPORTUNITY', "Decision Engine successfully blocked a weak, contradicted hypothesis from advancing");

    console.log("=========================================");
    console.log(`RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
    console.log("=========================================");
}

runBenchmark().catch(console.error);
