export interface Provenance {
    source_identity: string;
    timestamp: string;
    version: string;
}

export interface EvidencePackage {
    evidence_id: string;
    data_hash: string;
    category: string;
}

export interface DecisionCandidate {
    action_type: string;
    policy_reference: string;
}

export interface QCoreValidationRequest {
    tenant_id: string;
    finding_id: string;
    provenance: Provenance;
    evidence_package: EvidencePackage;
    decision_candidate: DecisionCandidate;
}

export interface DualSignature {
    ed25519_sig: string;
    ed25519_key_id: string;
    ml_dsa_87_sig: string;
    ml_dsa_87_key_id: string;
}

export interface VardhanSealedReceipt {
    receipt_id: string;
    transaction_id: string;
    status: string;
    tenant_id: string;
    subject_id: string;
    actor_identity: string;
    proposed_action: string;
    policy_id: string;
    policy_version: string;
    evidence_commitments: any[];
    authority_reference: string;
    decision: string;
    state_hash_at_decision?: string;
    timestamp_ms: number;
    payload_hash: string;
    issuer_key_fingerprint: string;
    signatures: DualSignature;
}

export class QCoreClient {
    private baseUrl: string;
    private apiKey?: string;

    constructor(baseUrl: string = "http://localhost:8080", apiKey?: string) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.apiKey = apiKey;
    }

    async sealTransaction(request: QCoreValidationRequest): Promise<VardhanSealedReceipt> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (this.apiKey) {
            headers["Authorization"] = `Bearer ${this.apiKey}`;
        }

        const response = await fetch(`${this.baseUrl}/api/v1/seal`, {
            method: "POST",
            headers,
            body: JSON.stringify(request),
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Q-Core API Error: ${response.status} - ${errBody}`);
        }

        return response.json();
    }
}
