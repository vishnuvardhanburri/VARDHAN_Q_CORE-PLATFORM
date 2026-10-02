import {
  IntelligenceCase, Evidence, ProspectDecision, FindingClassification,
  TechnicalThesis, TechnicalOwner, FindingStrength, UncertaintyModel, FindingLedEmail, FindingType, SeverityLevel, EngineMode, EvidenceClaim, PublicObservationProvider
} from './IntelligenceCase';
import { LivePublicObservationProvider } from './LivePublicObservationProvider';
import { SignalCorrelationEngine } from './signals/SignalCorrelationEngine';
import { OpportunityDetector } from './findings/OpportunityDetector';
import { DeepSignalExtractor } from './DeepSignalExtractor';
import type { DeepSignal } from './DeepTypes';

export class IntelligenceEngine {
  static async run(
    companyName: string, 
    companyWebsite: string, 
    crmName?: string, 
    crmRole?: string,
    ownerEvidenceString?: string,
    mockEvidence?: Evidence[],
    mode: EngineMode = 'PRODUCTION',
    testOptions?: { injectClaims?: EvidenceClaim[] },
    observationProvider?: PublicObservationProvider,
    onProgress?: (stage: string, message: string) => void
  ): Promise<IntelligenceCase> {
    const audit_trail: string[] = [];
    let discovery_errors = 0;
    
    audit_trail.push(`Initiating Engine in ${mode} mode`);
    
    let evidenceList: Evidence[] = [];
    
    if (mode === 'PRODUCTION') {
      if (!observationProvider) {
        audit_trail.push('PRODUCTION mode requires an observation provider to prevent mock-leakage.');
        return this.createTerminalCase(companyName, evidenceList, discovery_errors, [], 'NOT_FIT', 'NO_GO', audit_trail, mode);
      }
    }

    if (mode === 'TEST') {
      evidenceList = mockEvidence || [];
    } else {
      const activeProvider = observationProvider || new LivePublicObservationProvider();

      audit_trail.push('Observation provider invoked.');
      onProgress?.('evidence', 'Beginning bounded public-surface observation...');
      const result = await activeProvider.observePublicSurface(companyWebsite);
      evidenceList = result.evidence;
      discovery_errors = result.discovery_errors;

      audit_trail.push(`Provider returned ${evidenceList.length} observations and ${discovery_errors} network errors.`);
      onProgress?.('evidence', `Provider returned ${evidenceList.length} observations and ${discovery_errors} network errors.`);

      const origins = Array.from(new Set(evidenceList.map(e => e.evidence_origin)));
      audit_trail.push(`Evidence origins received: ${origins.join(', ')}`);

      for (const ev of evidenceList) {
        if (ev.evidence_origin !== 'REAL_PUBLIC_OBSERVATION' && ev.evidence_origin !== 'DOCUMENTED_SOURCE') {
          audit_trail.push(`Provider returned non-production evidence origin: ${ev.evidence_origin}`);
          return this.createTerminalCase(companyName, evidenceList, discovery_errors, [], 'NOT_FIT', 'NO_GO', audit_trail, mode);
        }
        if (!ev.public_url || !ev.retrieved_at || ev.reproductions === undefined || ev.repeatable === undefined || ev.tested_without_auth === undefined || !ev.not_tested) {
          audit_trail.push(`Provider returned malformed evidence missing required validation fields.`);
          return this.createTerminalCase(companyName, evidenceList, discovery_errors, [], 'NOT_FIT', 'NO_GO', audit_trail, mode);
        }
        if (ev.latency_ms && (ev.baseline_latency_ms === undefined)) {
           audit_trail.push(`Provider returned latency without baseline.`);
           return this.createTerminalCase(companyName, evidenceList, discovery_errors, [], 'NOT_FIT', 'NO_GO', audit_trail, mode);
        }
      }
    }
    
    if (evidenceList.length === 0) {
      return this.createTerminalCase(companyName, evidenceList, discovery_errors, [], 'NOT_FIT', 'NO_GO', [...audit_trail, 'Failed Fit Gate: No meaningful technical evidence found.'], mode);
    }

    if (ownerEvidenceString) {
       for (const ev of evidenceList) {
           ev.owner_source_link = ownerEvidenceString;
       }
    }

    let domainMismatch = false;
    for (const ev of evidenceList) {
      if (ev.public_url && !this.isSameOrSubdomain(companyWebsite, ev.public_url)) {
        domainMismatch = true;
        break;
      }
    }

    if (domainMismatch) {
      return this.createTerminalCase(companyName, evidenceList, discovery_errors, [], 'NOT_FIT', 'NO_GO', [...audit_trail, 'Failed Fit Gate: Evidence URL does not match target company domain.'], mode);
    }

    const { classification, resolvedEvidence } = this.resolveFindings(evidenceList);
    audit_trail.push(`Finding resolution completed. Resolved evidence count: ${resolvedEvidence.length}`);
    onProgress?.('findings', `Finding resolved: ${classification.finding_type} (${classification.impact_severity}).`);

    // ── CROSS-SIGNAL CORRELATION (computed before classification gates) ──
    const deepSignals = DeepSignalExtractor.extract(
      evidenceList.filter(e => e.observed_behavior && e.public_url).map(e => ({
        url: e.public_url,
        type: e.source_type || 'observation',
        raw_text: e.observed_behavior,
        source_url: e.public_url,
        category: e.source_type || 'observation',
      })),
      evidenceList,
      [],
      companyName,
      { onProgress: (s: string, m: string) => onProgress?.('signals', m) }
    );

    const correlationResult = SignalCorrelationEngine.correlate(deepSignals, evidenceList);
    const correlatedGroups = correlationResult.groups;
    audit_trail.push(`Correlation: ${correlatedGroups.length} group(s), dominant: ${correlationResult.dominantTheme || 'none'}`);

    // ── ENGINEERING PRESSURE CLASSIFICATION ──────────────────────────────
    const pressure = correlatedGroups.length > 0
      ? 'CONTEXT'
      : deepSignals.length >= 3 ? 'SIGNAL'
      : deepSignals.length >= 1 ? 'SIGNAL'
      : 'UNKNOWN';

    // ── OPPORTUNITY DETECTION ─────────────────────────────────────────────
    const qualifiedSignalTypes = new Set([
      'PUBLIC_INCIDENT', 'STATUS_PAGE', 'SECURITY_PAGE', 'TECHNICAL_HIRING',
      'API_REFERENCE', 'ARCHITECTURE_DISCUSSION', 'ENGINEERING_ARTICLE',
      'BLOG', 'TECHNICAL_DOCUMENTATION', 'SDK_DOCS',
    ]);
    const qualifiedSignalCount = deepSignals.filter(s => qualifiedSignalTypes.has(s.type)).length;
    const opps = OpportunityDetector.detect(deepSignals, evidenceList);
    const findingAssessment = opps.length > 0
      ? OpportunityDetector.evaluateFinding(opps[0]!, evidenceList.length, correlatedGroups.length, qualifiedSignalCount)
      : { classification: 'LOW_VALUE' as const, opportunity: null, explanation: 'No engineering opportunities detected.', evidenceIds: [], rejectedSignals: [], evaluatedAt: new Date().toISOString() };
    audit_trail.push(`Pressure: ${pressure}`);
    audit_trail.push(`Opportunity: ${findingAssessment.classification}`);

    if (correlationResult.shouldDeepResearch && opps.length > 0) {
      onProgress?.('findings', `Engineering opportunity: ${findingAssessment.classification}`);
    }

    if (classification.finding_type === 'GENERIC_ENGINEERING_ARTICLE') {
       audit_trail.push('Classification: Generic engineering content. No explicit finding established.');
       return this.createTerminalCase(companyName, evidenceList, discovery_errors, resolvedEvidence, 'FIT', 'RESEARCH_MORE', audit_trail, mode, 'N/A', deepSignals, correlatedGroups, pressure, findingAssessment.classification);
    }
    if (classification.finding_type === 'CONFLICTING_EVIDENCE') {
      audit_trail.push('Classification: Conflicting findings from multiple evidence sources. Requires manual resolution.');
      return this.createTerminalCase(companyName, evidenceList, discovery_errors, resolvedEvidence, 'FIT', 'RESEARCH_MORE', audit_trail, mode, 'N/A', deepSignals, correlatedGroups, pressure, findingAssessment.classification);
   }

    const thesis = this.generateTechnicalThesis(resolvedEvidence, classification);
    const uncertainty = this.generateUncertaintyModel(resolvedEvidence, thesis);
    
    audit_trail.push('Identifying Technical Owner');
    const owner = this.identifyTechnicalOwner(resolvedEvidence, crmName, crmRole);
    audit_trail.push(`Owner Verification: ${owner.owner_confidence}`);
    onProgress?.('owner', `Technical owner: ${owner.name || '(none)'} — confidence ${owner.owner_confidence}.`);

    const strength = this.evaluateFindingStrength(resolvedEvidence, owner);
    const contradictions = this.adversarialReview(resolvedEvidence, owner, strength);
    
    audit_trail.push('Running Adversarial Review');
    if (contradictions.length > 0) audit_trail.push(`Contradictions found: ${contradictions.length}`);

    const decision = this.prospectGate(classification, resolvedEvidence, contradictions, owner, strength, mode);
    audit_trail.push(`Gate Decision: ${decision}`);
    
    let subject = '';
    let body = '';
    let claim_validation = 'N/A';
    let emailModel: FindingLedEmail | undefined = undefined;

    if (decision === 'GO' || testOptions?.injectClaims) {
      onProgress?.('email', 'Evaluating email eligibility and claim QA...');
      let claims = this.generateFindingClaims(classification, thesis, resolvedEvidence, owner);
      subject = this.generateSubject(classification, resolvedEvidence);
      
      if (testOptions?.injectClaims) {
        claims = testOptions.injectClaims;
      }

      body = claims.map(c => c.text).join('\n\n');
      emailModel = { claims, subject };

      claim_validation = this.claimQA(claims, resolvedEvidence, classification, owner);
      audit_trail.push(`Claim QA Result: ${claim_validation}`);
      onProgress?.('email', `Claim QA result: ${claim_validation}.`);
      
      if (claim_validation === 'FAILED') {
        audit_trail.push('Claim QA Failed: Generated claims could not be structurally supported by evidence.');
        return this.createTerminalCase(companyName, evidenceList, discovery_errors, resolvedEvidence, 'FIT', 'NO_GO', audit_trail, mode, 'FAILED', deepSignals, correlatedGroups, pressure, findingAssessment.classification);
      }
    }

    audit_trail.push('Completed automated intelligence pipeline.');

    return {
      company: companyName,
      fit_status: 'FIT',
      evidence: evidenceList,
      resolved_evidence: resolvedEvidence,
      discovery_errors,
      finding_classification: classification,
      finding_strength: strength,
      technical_thesis: thesis,
      uncertainty_model: uncertainty,
      technical_owner: owner,
      email_model: emailModel,
      contradictions,
      prospect_decision: decision,
      subject,
      body,
      claim_validation,
      audit_trail,
      mode,
      signals: deepSignals,
      correlated_groups: correlatedGroups,
      pressure_classification: pressure,
      opportunity_classification: findingAssessment.classification,
    };
  }

  private static isSameOrSubdomain(targetUrl: string, evidenceUrl: string): boolean {
    try {
      const targetHost = new URL(targetUrl).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
      const evHost = new URL(evidenceUrl).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
      
      if (targetHost === evHost) return true;
      if (evHost.endsWith('.' + targetHost)) return true;
      return false;
    } catch {
      return false;
    }
  }

  private static createTerminalCase(
    company: string, evidence: Evidence[], discovery_errors: number, resolved_evidence: Evidence[],
    fit_status: any, decision: any, audit_trail: string[], mode: EngineMode,
    claim_validation: string = 'N/A',
    signals?: any[], correlated_groups?: any[], pressure?: string, opportunity?: string,
  ): IntelligenceCase {
    return {
      company, fit_status, evidence, resolved_evidence, discovery_errors, contradictions: [], prospect_decision: decision,
      subject: '', body: '', claim_validation, audit_trail, mode,
      ...(signals ? { signals } : {}),
      ...(correlated_groups ? { correlated_groups } : {}),
      ...(pressure ? { pressure_classification: pressure } : {}),
      ...(opportunity ? { opportunity_classification: opportunity } : {}),
    };
  }

  private static classifySingleEvidence(ev: Evidence): { type: FindingType, severity: SeverityLevel, basis: string } {
    if (ev.source_type === 'API_ENDPOINT') {
      if (ev.latency_ms && ev.baseline_latency_ms && ev.latency_ms > ev.baseline_latency_ms * 2) {
        return { type: 'OBSERVED_LATENCY', severity: 'MEDIUM', basis: `Latency measured at ${ev.latency_ms}ms against baseline ${ev.baseline_latency_ms}ms.` };
      }
      if (ev.status && ev.status >= 500) {
        if (ev.repeatable === true && (ev.reproductions || 0) >= 2) {
          return { type: 'REPEATED_ERRORS', severity: 'MEDIUM', basis: `Repeated HTTP ${ev.status} across ${ev.reproductions || 0} attempts.` };
        } else {
          return { type: 'UNEXPECTED_PUBLIC_BEHAVIOR', severity: 'LOW', basis: `Single unexpected HTTP ${ev.status} response.` };
        }
      }
      
      if (ev.sensitive_fields && ev.sensitive_fields.length > 0) {
         if (ev.sensitive_fields.some(f => ['password', 'token', 'credential', 'api_key', 'private_key', 'secret'].includes(f.toLowerCase()))) {
            return { type: 'POSSIBLE_PUBLIC_EXPOSURE', severity: 'HIGH', basis: 'Structured exposure of credential-like fields.' };
         }
         return { type: 'POSSIBLE_SENSITIVE_METADATA_EXPOSURE', severity: 'MEDIUM', basis: 'Structured exposure of internal metadata fields.' };
      }
      
      const text = ev.observed_behavior.toLowerCase();
      if (text.includes('metadata') || text.includes('internal path') || text.includes('storage_path')) {
        return { type: 'POSSIBLE_SENSITIVE_METADATA_EXPOSURE', severity: 'MEDIUM', basis: 'Textual observation of internal path variables.' };
      }
      if (text.includes('password') || text.includes('token') || text.includes('credential')) {
        return { type: 'POSSIBLE_PUBLIC_EXPOSURE', severity: 'HIGH', basis: 'Textual observation of credential-like patterns.' };
      }
      return { type: 'UNEXPECTED_PUBLIC_BEHAVIOR', severity: 'LOW', basis: 'Non-standard response structure.' };
    } else if (ev.source_type === 'ENGINEERING_BLOG' || ev.source_type === 'PUBLIC_DOCUMENTATION') {
      const text = ev.observed_behavior.toLowerCase();
      if (text.includes('incident') || text.includes('outage')) {
        return { type: 'DOCUMENTED_INCIDENT', severity: 'HIGH', basis: 'Self-reported production incident.' };
      } else if (text.includes('failure') || text.includes('broke')) {
        return { type: 'DOCUMENTED_ENGINEERING_FAILURE', severity: 'MEDIUM', basis: 'Self-reported engineering failure.' };
      } else if (text.includes('constraint') || text.includes('bottleneck')) {
        return { type: 'DOCUMENTED_SCALING_CONSTRAINT', severity: 'LOW', basis: 'Self-reported architectural constraint.' };
      }
    }
    return { type: 'GENERIC_ENGINEERING_ARTICLE', severity: 'LOW', basis: 'General engineering content.' };
  }

  private static resolveFindings(evidenceList: Evidence[]): { classification: FindingClassification, resolvedEvidence: Evidence[] } {
    const classifications = evidenceList.map(e => this.classifySingleEvidence(e));
    const types = Array.from(new Set(classifications.map(c => c.type))).filter(t => t !== 'GENERIC_ENGINEERING_ARTICLE' && t !== 'UNEXPECTED_PUBLIC_BEHAVIOR');

    if (types.length === 0) {
       const unex = classifications.filter(c => c.type === 'UNEXPECTED_PUBLIC_BEHAVIOR');
       if (unex.length > 0) {
           const resolvedEvidence = evidenceList.filter((_, i) => classifications[i].type === 'UNEXPECTED_PUBLIC_BEHAVIOR');
           return { classification: { finding_type: 'UNEXPECTED_PUBLIC_BEHAVIOR', impact_severity: 'LOW', severity_basis: 'No repeatable strong finding.' }, resolvedEvidence };
       }
       return { 
        classification: { finding_type: 'GENERIC_ENGINEERING_ARTICLE', impact_severity: 'LOW', severity_basis: 'No actionable finding' }, 
        resolvedEvidence: evidenceList 
      };
    }
    if (types.length > 1) {
      return { 
        classification: { finding_type: 'CONFLICTING_EVIDENCE', impact_severity: 'UNKNOWN', severity_basis: 'Multiple conflicting finding types' }, 
        resolvedEvidence: evidenceList 
      };
    }

    const primaryType = types[0];
    const resolvedEvidence = evidenceList.filter((_, i) => classifications[i].type === primaryType);
    const primaryClassification = classifications.find(c => c.type === primaryType)!;

    return {
      classification: { finding_type: primaryType, impact_severity: primaryClassification.severity, severity_basis: primaryClassification.basis },
      resolvedEvidence
    };
  }

  private static generateTechnicalThesis(resolvedEvidence: Evidence[], classification: FindingClassification): TechnicalThesis {
    const urls = Array.from(new Set(resolvedEvidence.map(e => e.public_url))).join(', ');
    
    let observations = '';
    const sensitive = Array.from(new Set(resolvedEvidence.flatMap(e => e.sensitive_fields || [])));
    if (sensitive.length > 0) {
       observations = `The payload exposes internal fields like ${sensitive.slice(0,3).join(', ')}.`;
    } else {
       observations = Array.from(new Set(resolvedEvidence.map(e => e.observed_behavior))).join(' ');
    }

    let fact = '';
    let inference = '';

    const isApi = resolvedEvidence.some(e => e.source_type === 'API_ENDPOINT');
    
    if (isApi) {
      fact = `The endpoint(s) ${urls} are publicly accessible.`;
      if (classification.finding_type === 'REPEATED_ERRORS') inference = `This behavior may indicate an availability issue or a failing dependency path under specific request structures.`;
      else if (classification.finding_type === 'OBSERVED_LATENCY') inference = `This repeatable latency may suggest an unoptimized data-access path or resource exhaustion on the public boundary.`;
      else if (classification.finding_type === 'POSSIBLE_SENSITIVE_METADATA_EXPOSURE') inference = `This payload exposes fields that may map to internal operational infrastructure.`;
      else inference = `This behavior deviates from standard API responses.`;
    } else {
      fact = `The company publicly documented their architecture at ${urls}.`;
      observations = `The documentation explicitly outlines: ${Array.from(new Set(resolvedEvidence.map(e => e.observed_behavior))).join(' ')}`;
      inference = ``; 
    }

    return { source_fact: fact, vardhan_observation: observations, vardhan_inference: inference };
  }

  private static generateUncertaintyModel(resolvedEvidence: Evidence[], thesis: TechnicalThesis): UncertaintyModel {
    const isApi = resolvedEvidence.some(e => e.source_type === 'API_ENDPOINT');
    const dontKnow = isApi 
      ? 'Whether the exposure/behavior is intentional, or whether it maps to critical internal infrastructure.'
      : 'Whether this specific constraint has already been fully remediated or if it remains an active architectural bottleneck.';

    return {
      what_we_know: thesis.source_fact,
      what_we_observed: thesis.vardhan_observation,
      what_we_infer: thesis.vardhan_inference,
      what_we_do_not_know: dontKnow
    };
  }

  private static identifyTechnicalOwner(resolvedEvidence: Evidence[], crmName?: string, crmRole?: string): TechnicalOwner {
    if (!crmName || !crmRole) {
      return { name: '', role: '', owner_source: 'NONE', owner_evidence: 'None', verified_relevance: 'No specific individual provided.', owner_confidence: 'LOW' };
    }
    
    const explicitMatch = resolvedEvidence.find(e => 
      e.owner_source_link && 
      e.owner_source_link.includes(crmName) &&
      (e.owner_source_link.includes('author explicitly matches') || e.owner_source_link.includes('repository owner') || e.owner_source_link.includes('source explicitly names') || e.owner_source_link.includes('trusted owner-source') || e.owner_source_link.includes('is listed as'))
    );
    
    let confidence: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    let verified = `Role '${crmRole}' lacks verified connection to the specific finding.`;
    let ownerEv = 'No direct evidence.';

    if (explicitMatch) {
      confidence = 'HIGH';
      verified = `Explicitly verified: ${crmName} is tied to the primary source.`;
      ownerEv = explicitMatch.owner_source_link || 'Directly matched to source artifact.';
    } else if (/(cto|vp|director|head|manager|lead|architect)/i.test(crmRole)) {
      confidence = 'MEDIUM'; 
      verified = `CRM role '${crmRole}' indicates candidate technical leadership, but lacks direct primary source linkage.`;
      ownerEv = 'CRM role inference.';
    }

    return {
      name: crmName,
      role: crmRole,
      owner_source: explicitMatch ? 'PRIMARY_SOURCE' : 'CRM_ENRICHMENT',
      owner_evidence: ownerEv,
      verified_relevance: verified,
      owner_confidence: confidence
    };
  }

  private static evaluateFindingStrength(resolvedEvidence: Evidence[], owner: TechnicalOwner): FindingStrength {
    let evStr: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    let repStr: 'LOW' | 'MEDIUM' | 'HIGH' | 'NOT_APPLICABLE' = 'LOW';
    let srcStr: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    let techStr: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

    const hasApi = resolvedEvidence.some(e => e.source_type === 'API_ENDPOINT');
    const totalReps = resolvedEvidence.reduce((acc, curr) => acc + (curr.reproductions || 0), 0);
    const allRepeatable = resolvedEvidence.every(e => e.repeatable !== false);

    if (hasApi) {
      srcStr = 'HIGH';
      if (allRepeatable && totalReps >= 2) { evStr = 'HIGH'; repStr = 'HIGH'; }
      else if (allRepeatable && totalReps > 0) { evStr = 'MEDIUM'; repStr = 'MEDIUM'; }
    } else {
      srcStr = 'MEDIUM';
      repStr = 'NOT_APPLICABLE'; 
      evStr = resolvedEvidence.some(e => e.observed_behavior.length > 20) ? 'MEDIUM' : 'LOW';
    }

    techStr = resolvedEvidence.some(e => e.observed_behavior.length > 30 || (e.sensitive_fields && e.sensitive_fields.length > 0)) ? 'MEDIUM' : 'LOW';

    return {
      evidence_strength: evStr,
      reproducibility: repStr,
      source_quality: srcStr,
      technical_specificity: techStr,
      owner_confidence: owner.owner_confidence
    };
  }

  private static adversarialReview(
    resolvedEvidence: Evidence[], 
    owner: TechnicalOwner,
    strength: FindingStrength
  ): string[] {
    const contradictions = [];
    
    if (strength.owner_confidence !== 'HIGH') {
      contradictions.push('Missing explicit technical owner verification (HIGH required for GO).');
    }
    const hasUnrepeatableApi = resolvedEvidence.some(e => e.source_type === 'API_ENDPOINT' && !e.repeatable);
    if (hasUnrepeatableApi) {
      contradictions.push('Security-like issue cannot be safely reproduced.');
    }
    if (strength.evidence_strength === 'LOW') {
      contradictions.push('Finding lacks sufficient evidence strength.');
    }
    
    return contradictions;
  }

  private static prospectGate(
    classification: FindingClassification,
    resolvedEvidence: Evidence[], 
    contradictions: string[], 
    owner: TechnicalOwner,
    strength: FindingStrength,
    mode: EngineMode
  ): ProspectDecision {
    if (contradictions.length > 0) return 'RESEARCH_MORE';
    
    const isMock = resolvedEvidence.some(e => e.evidence_origin === 'MOCK_TEST');
    if (mode === 'PRODUCTION' && isMock) return 'NO_GO';

    const isDoc = resolvedEvidence.every(e => e.evidence_origin === 'DOCUMENTED_SOURCE');
    const isReal = resolvedEvidence.some(e => e.evidence_origin === 'REAL_PUBLIC_OBSERVATION');

    if (!isMock && !isDoc && !isReal) return 'RESEARCH_MORE';
    
    if (strength.owner_confidence !== 'HIGH') return 'RESEARCH_MORE';

    const hasApi = resolvedEvidence.some(e => e.source_type === 'API_ENDPOINT');
    
    if (hasApi) {
      const defensible = ['REPEATED_ERRORS', 'OBSERVED_LATENCY', 'POSSIBLE_SENSITIVE_METADATA_EXPOSURE', 'POSSIBLE_PUBLIC_EXPOSURE', 'POSSIBLE_INFORMATION_DISCLOSURE'].includes(classification.finding_type);
      if (!defensible) return 'RESEARCH_MORE';
      
      const safe = resolvedEvidence.every(e => e.tested_without_auth);
      if (strength.reproducibility !== 'LOW' && safe) return 'GO';
    } else {
      const docDefensible = classification.finding_type.startsWith('DOCUMENTED_');
      if (docDefensible && strength.evidence_strength !== 'LOW') return 'GO';
    }

    return 'RESEARCH_MORE';
  }

  private static generateSubject(classification: FindingClassification, resolvedEvidence: Evidence[]): string {
    const primaryUrl = resolvedEvidence[0].public_url;
    const path = primaryUrl ? new URL(primaryUrl).pathname : '';
    const originLabel = resolvedEvidence.some(e => e.evidence_origin === 'MOCK_TEST') ? '[MOCK ACCEPTANCE FINDING] ' : '';

    switch (classification.finding_type) {
      case 'POSSIBLE_PUBLIC_EXPOSURE': return `${originLabel}Possible public exposure in ${path}`;
      case 'POSSIBLE_INFORMATION_DISCLOSURE': return `${originLabel}Possible information disclosure in ${path}`;
      case 'POSSIBLE_SENSITIVE_METADATA_EXPOSURE': return `${originLabel}Possible metadata exposure in ${path}`;
      case 'OBSERVED_LATENCY': return `${originLabel}Observed latency on ${path}`;
      case 'REPEATED_ERRORS': return `${originLabel}Repeated errors on ${path}`;
      case 'UNEXPECTED_PUBLIC_BEHAVIOR': return `${originLabel}Unexpected behavior on ${path}`;
      case 'DOCUMENTED_INCIDENT': return `${originLabel}Your publicly documented API incident`;
      case 'DOCUMENTED_SCALING_CONSTRAINT': return `${originLabel}Scaling constraints — technical note`;
      default: return `${originLabel}Technical observation note`;
    }
  }

  private static generateFindingClaims(
    classification: FindingClassification,
    thesis: TechnicalThesis,
    resolvedEvidence: Evidence[],
    owner: TechnicalOwner
  ): EvidenceClaim[] {
    const claims: EvidenceClaim[] = [];
    const allIds = resolvedEvidence.map(e => e.id);
    const urls = Array.from(new Set(resolvedEvidence.map(e => e.public_url)));
    
    claims.push({ text: `Hi ${owner.name.split(' ')[0]},`, evidence_ids: [], claim_type: 'STANDARD_BLOCK' });
    claims.push({ text: `I'm Vishnu, the solo founder building VARDHAN. I'd rather show you something you can verify than ask you to trust me.`, evidence_ids: [], claim_type: 'STANDARD_BLOCK' });

    const isApi = resolvedEvidence.some(e => e.source_type === 'API_ENDPOINT');

    if (isApi) {
      claims.push({ text: `While checking the publicly accessible surface at:\n${urls.join('\n')}\n\nI observed that:\n${thesis.vardhan_observation}`, evidence_ids: allIds, claim_type: 'OBSERVATION' });
      
      const totalReps = resolvedEvidence.reduce((acc, curr) => acc + (curr.reproductions || 0), 0);
      const allRepeatable = resolvedEvidence.every(e => e.repeatable);
      const uniqueNotTested = Array.from(new Set(resolvedEvidence.flatMap(e => e.not_tested)));
      const notTestedStr = uniqueNotTested.length > 0 ? uniqueNotTested.join(', ') : 'attempt further exploitation';
      const isRealObservation = resolvedEvidence.some(e => e.evidence_origin === 'REAL_PUBLIC_OBSERVATION');

      let repText = `I observed this once from the public side. I did not bypass authentication, ${notTestedStr}.`;
      if (allRepeatable && totalReps >= 2 && isRealObservation) {
        repText = `The behavior was repeatable from the public side using a normal read-only request. I did not bypass authentication, ${notTestedStr}.`;
      } else if (allRepeatable && totalReps >= 2) {
        repText = `The behavior was repeatable from the public side. I did not bypass authentication, ${notTestedStr}.`;
      } else if (allRepeatable && totalReps === 1) {
        repText = `I observed this from the public side and was able to repeat the request once. I did not bypass authentication, ${notTestedStr}.`;
      }
      
      claims.push({ text: repText, evidence_ids: allIds, claim_type: 'REPRODUCTION' });
    } else {
      claims.push({ text: `I was reading your write-up on ${urls[0]}.\n\nYour article explicitly documents:\n${thesis.vardhan_observation}`, evidence_ids: allIds, claim_type: 'DOCUMENTED_FACT' });
      claims.push({ text: `This is publicly documented.`, evidence_ids: allIds, claim_type: 'REPRODUCTION' });
    }

    claims.push({ text: `I'm contacting you because your role appears to cover this area.`, evidence_ids: allIds, claim_type: 'OWNER' });
    claims.push({ text: `This isn't a sales pitch, and there is no meeting request.`, evidence_ids: [], claim_type: 'STANDARD_BLOCK' });
    claims.push({ text: isApi ? `Reply "details" and I'll send the evidence.` : `Reply "details" and I'll send the note directly.`, evidence_ids: [], claim_type: 'STANDARD_BLOCK' });

    return claims;
  }

  private static claimQA(claims: EvidenceClaim[], resolvedEvidence: Evidence[], classification: FindingClassification, owner: TechnicalOwner): string {
    const fullText = claims.map(c => c.text).join(' ').toLowerCase();

    // A. Founder statement exists
    if (!fullText.includes("vishnu, the solo founder")) return 'FAILED';

    const unsupported = ["vulnerable", "definitely", "guaranteed", "most teams", "i usually see", "critical exposure", "breached", "hacked", "customer data exposed"];
    for (const term of unsupported) {
      if (fullText.includes(term)) {
        const explicitlySupported = resolvedEvidence.some(e => 
           e.observed_behavior.toLowerCase().includes(term) || 
           e.sensitive_fields?.some(f => f.toLowerCase().includes(term))
        );
        if (!explicitlySupported) return 'FAILED';
      }
    }

    for (const claim of claims) {
      const text = claim.text.toLowerCase();
      
      if (claim.claim_type === 'OBSERVATION' || claim.claim_type === 'DOCUMENTED_FACT') {
        const supportValid = claim.evidence_ids.every(id => {
           const ev = resolvedEvidence.find(e => e.id === id);
           if (!ev) return false;
           
           if (!text.includes(ev.public_url.toLowerCase())) return false;
           
           let behaviorMatch = text.includes(ev.observed_behavior.toLowerCase().slice(0, 15));
           if (ev.sensitive_fields && ev.sensitive_fields.length > 0) {
              const structuredMatch = ev.sensitive_fields.some(f => text.includes(f.toLowerCase()));
              if (structuredMatch) behaviorMatch = true;
           }
           
           return behaviorMatch;
        });
        if (!supportValid && claim.evidence_ids.length > 0) return 'FAILED';
      }

      if (claim.claim_type === 'REPRODUCTION') {
        if (text.includes('repeatable') || text.includes('reproduced')) {
          if (!resolvedEvidence.some(e => e.repeatable === true && (e.reproductions || 0) >= 2)) return 'FAILED';
        }
        if (text.includes('publicly documented') && !resolvedEvidence.every(e => e.evidence_origin === 'DOCUMENTED_SOURCE')) return 'FAILED';
      }

      if (claim.claim_type === 'OWNER' && owner.owner_confidence !== 'HIGH') return 'FAILED';

      if (text.includes('latency') || text.includes('ms')) {
        const hasLatency = resolvedEvidence.some(e => e.latency_ms && e.baseline_latency_ms);
        if (!hasLatency) return 'FAILED';
      }
    }

    return 'PASSED';
  }
}
