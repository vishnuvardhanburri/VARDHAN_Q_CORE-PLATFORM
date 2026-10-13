import { VerifiedFindingContract } from '../../VerifiedFindingContract';

export interface QuantumAsset {
  asset_id: string;
  algorithm: string;
  role: 'Identity' | 'Key Establishment' | 'Digital Signature' | 'Symmetric Encryption' | 'Hashing' | 'Unknown';
  confidence: number;
  sensitivity: 'LOW' | 'MEDIUM' | 'HIGH';
  provenance: string;
}

export interface RiskAssessment {
  asset_id: string;
  quantum_risk_score: number; // 0.0 to 1.0
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  rationale: string;
  recommended_algorithm: string;
  confidence: number;
}

export class RiskEngine {
  /**
   * Calculates quantum risk based on the algorithm and the sensitivity of the data.
   * High risk = (Vulnerable Algorithm) AND (High Sensitivity OR Long Retention).
 l
  */
  public static evaluate(asset: QuantumAsset): RiskAssessment {
    const vulnerableAlgorithms = ['RSA', 'ECDSA', 'Diffie-Hellman', 'DSA'];
    const isVulnerable = vulnerableAlgorithms.some(alg => asset.algorithm.toUpperCase().includes(alg));

    let score = 0;
    let priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    let rationale = "";

    if (isVulnerable) {
      score = 0.5;
      rationale = `Asset uses ${asset.algorithm}, which is vulnerable to Shor's algorithm.`;

      if (asset.sensitivity === 'HIGH') {
        score += 0.4;
        priority = 'CRITICAL';
        rationale += " High sensitivity data increases urgency.";
      } else if (asset.sensitivity === 'MEDIUM') {
        score += 0.2;
        priority = 'HIGH';
        rationale += " Medium sensitivity data increases urgency.";
      } else {
        priority = 'MEDIUM';
      }
    } else {
      score = 0.1;
      priority = 'LOW';
      rationale = "Asset uses a quantum-resistant or unknown algorithm.";
    }

    if (score >= 0.9) priority = 'CRITICAL';
    else if (score >= 0.7) priority = 'HIGH';
    else if (score >= 0.4) priority = 'MEDIUM';

    // Recommend NIST-standardized alternatives based on operation
    let recommended = "TBD";
    if (isVulnerable) {
      if (asset.role === 'Digital Signature') {
        recommended = "ML-DSA-87 (FIPS 204)";
      } else if (asset.role === 'Key Establishment') {
        recommended = "ML-KEM-1024 (FIPS 203)";
      } else if (asset.role === 'Symmetric Encryption') {
        recommended = "AES-256";
      } else if (asset.role === 'Hashing') {
        recommended = "SHA-3";
      } else {
        recommended = "Consult NIST PQC standards for " + asset.role;
      }
    }

    return {
      asset_id: asset.asset_id,
      quantum_risk_score: score,
      priority: priority,
      rationale: rationale,
      recommended_algorithm: recommended,
      confidence: asset.confidence,
    };
  }
}
