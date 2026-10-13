/**
 * VARDHAN SUBJECT INTELLIGENCE ENGINE v4.2 (EVIDENCE-ONLY ARCHITECTURE)
 */

import {
  SubjectLineService,
  ClaimValidationEngine,
  SubjectSimilarityChecker,
  SubjectStrategy,
  VerifiedSignalInput,
  SubjectLineGenerationResult,
  GeneratedSubjectCandidate
} from './subjectLineService';

export {
  SubjectLineService,
  ClaimValidationEngine,
  SubjectSimilarityChecker
};

export type SubjectPerspectiveType =
  | 'SIGNAL_CURIOSITY'
  | 'EVENT_TO_QUESTION'
  | 'TECHNICAL_DIRECTION'
  | 'EXECUTIVE_CURIOSITY'
  | 'CONTEXTUAL_FOLLOW_UP'
  | 'OBSERVED_CHANGE'
  | 'TECHNICAL_THEME'
  | 'SIGNAL_QUESTION'
  | 'EVENT_IMPLICATION'
  | 'EXECUTIVE_SHORT'
  | 'CONTEXTUAL_FOLLOWUP';

export interface SubjectCandidate {
  text: string;
  perspective: SubjectPerspectiveType;
  perspectiveLabel: string;
  score: number;
  evidence_anchor: string;
  claim_risk: string;
  approval_status: string;
  block_reason: string;
  similarity_score: number;
  isOptimal: boolean;
  strategy: SubjectStrategy;
}

export interface SubjectIntelligenceResult {
  company: string;
  domainTheme: string;
  selectedSubject: string;
  selectedPerspective: SubjectPerspectiveType;
  candidates: SubjectCandidate[];
  rationale: string;
  status: 'APPROVED' | 'BLOCKED' | 'REGENERATED';
  code: string;
}

export class SubjectIntelligenceEngine {
  static evaluate(
    company: string,
    signalOrEvidence?: any,
    previousSubjects: string[] = [],
    isFollowUp: boolean = false
  ): SubjectIntelligenceResult {
    const safeCompany = (company || '').trim();
    const rawEvidence = typeof signalOrEvidence === 'string'
      ? signalOrEvidence
      : (signalOrEvidence?.evidenceText || signalOrEvidence?.evidenceVerbatim || signalOrEvidence?.scalingRisks || '');

    const signalInput: VerifiedSignalInput = {
      company: safeCompany,
      evidenceText: rawEvidence,
      verificationStatus: signalOrEvidence?.verificationStatus || (rawEvidence ? 'VERIFIED' : 'UNVERIFIED'),
      signalType: signalOrEvidence?.signalType,
      publishedAt: signalOrEvidence?.publishedAt || (rawEvidence ? new Date().toISOString().split('T')[0] : '')
    };

    const serviceResult = SubjectLineService.generateSubjects(signalInput, previousSubjects, isFollowUp);

    if (serviceResult.status === 'BLOCKED') {
      return {
        company: safeCompany,
        domainTheme: 'unverified',
        selectedSubject: '',
        selectedPerspective: 'SIGNAL_CURIOSITY',
        candidates: [],
        rationale: serviceResult.rationale,
        status: 'BLOCKED',
        code: serviceResult.code
      };
    }

    const mappedCandidates: SubjectCandidate[] = serviceResult.candidates.map(c => ({
      text: c.subject,
      perspective: c.strategy,
      perspectiveLabel: c.strategyLabel,
      score: c.score,
      evidence_anchor: c.evidence_anchor,
      claim_risk: c.claim_risk,
      approval_status: c.approval_status,
      block_reason: c.block_reason,
      similarity_score: c.similarityScore,
      isOptimal: c.subject === serviceResult.selectedSubject,
      strategy: c.strategy
    }));

    return {
      company: safeCompany,
      domainTheme: serviceResult.intelligence?.infraFocus || serviceResult.intelligence?.exactVerifiedEvent || 'platform scale',
      selectedSubject: serviceResult.selectedSubject,
      selectedPerspective: serviceResult.selectedStrategy || 'SIGNAL_CURIOSITY',
      candidates: mappedCandidates,
      rationale: serviceResult.rationale,
      status: serviceResult.status,
      code: serviceResult.code
    };
  }
}
