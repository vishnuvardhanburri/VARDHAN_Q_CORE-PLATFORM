/**
 * VARDHAN REAL-TIME TARGET QUALIFICATION LAYER (Engine v4.2+)
 *
 * OBJECTIVE:
 * Find companies with credible, current, publicly verifiable business/technical
 * signals that justify a technical conversation.
 *
 * HARD RULES:
 * - NO SIGNAL = NO EMAIL
 * - NO SOURCE = NO EMAIL
 * - NO DATE = NO EMAIL
 * - THIN EVIDENCE = NO EMAIL
 * - OLD SIGNAL (>90d) = Downgraded / Capped
 * - P3 = NO EMAIL
 * - IDENTITY MISMATCH = NO EMAIL
 * - EMAIL DOMAIN MISMATCH = NO EMAIL
 * - FABRICATED CLAIM / METRIC = NO EMAIL
 * - NEVER automatically send
 * - NEVER infer queue contention, latency, GPU, outages without explicit public proof
 */

import { SIGNAL_DATABASE, RealSignalEntry } from '../utils/signalEngineReal';
import { ALL_COMPANIES_RESEARCH_DATA, AllCompanyResearch } from '../data/allCompaniesResearch';
import { SignalRecord } from './signalDiscoveryPipeline';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type FreshnessCategory = 'VERY_RECENT' | 'RECENT' | 'HISTORICAL' | 'OLD';
export type PriorityTier = 'P0' | 'P1' | 'P2' | 'P3';
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export type QualificationStatus = 
  | 'READY_FOR_HUMAN_APPROVAL'
  | 'BLOCKED'
  | 'NEEDS_VERIFICATION'
  | 'AUTOMATION_STOPPED';

export interface QualifiedTargetRecord {
  company: string;
  person: string;
  role: string;
  signal: string;             // Signal Type
  source: string;             // Source URL or Publisher
  sourceType: string;
  date: string;               // Published Date (ISO format)
  age: number;                // Age in Days
  freshness: FreshnessCategory;
  evidence: string;           // Verbatim Quote from Source
  confidence: ConfidenceLevel;
  score: number;              // 0–100 Deterministic Signal Score
  priority: PriorityTier;
  personaMatch: string;       // Matched Persona (CTO, VP Eng, etc.)
  emailVerified: boolean;     // Mailbox format and accessibility valid
  identityVerified: boolean;  // Person name matches mailbox prefix or user-verified
  domainVerified: boolean;    // Mailbox domain matches company domain
  angle: string;              // Recommended Technical Inquiry Angle
  status: QualificationStatus;
  blockReason: string;
  pilotRankScore: number;     // Ranking score for Top 10 Pilot View
  allGatesPassed: boolean;
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Email Domain Validation Service
// ─────────────────────────────────────────────────────────────────────────────

export class EmailDomainValidator {
  private static FREE_EMAIL_PROVIDERS = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
    'mail.com', 'protonmail.com', 'zoho.com', 'aol.com', 'example.com'
  ];

  static extractDomain(urlOrEmail: string): string {
    if (!urlOrEmail) return '';
    let cleaned = urlOrEmail.toLowerCase().trim();
    
    // If it's an email
    if (cleaned.includes('@')) {
      return cleaned.split('@')[1].trim();
    }
    
    // If it's a website URL
    try {
      if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
        cleaned = 'https://' + cleaned;
      }
      const parsed = new URL(cleaned);
      return parsed.hostname.replace(/^www\./, '').toLowerCase().trim();
    } catch {
      return cleaned.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase().trim();
    }
  }

  static validate(email: string, companyWebsite: string, isUserResearchVerified = false): { isValid: boolean; blockReason: string } {
    if (!email || !email.includes('@')) {
      return { isValid: false, blockReason: 'EMAIL_DOMAIN_MISMATCH: Invalid or empty email address.' };
    }

    const emailDomain = this.extractDomain(email);
    const companyDomain = this.extractDomain(companyWebsite);

    if (this.FREE_EMAIL_PROVIDERS.includes(emailDomain)) {
      return { isValid: false, blockReason: `EMAIL_DOMAIN_MISMATCH: Free/generic provider (${emailDomain}) used instead of corporate domain.` };
    }

    if (isUserResearchVerified) {
      return { isValid: true, blockReason: '' };
    }

    if (!companyDomain) {
      return { isValid: true, blockReason: '' };
    }

    // Direct match or subdomain match (e.g. eng.shopify.com vs shopify.com) or root name match (graphite-arch.com vs graphite.dev)
    const companyRoot = companyDomain.split('.')[0];
    const isMatch = emailDomain === companyDomain || 
                    emailDomain.endsWith('.' + companyDomain) || 
                    companyDomain.endsWith('.' + emailDomain) ||
                    (companyRoot.length >= 4 && emailDomain.includes(companyRoot));

    if (!isMatch) {
      return {
        isValid: false,
        blockReason: `EMAIL_DOMAIN_MISMATCH: Mailbox domain (@${emailDomain}) does not match company website (${companyDomain}).`
      };
    }

    return { isValid: true, blockReason: '' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Claim & Metric Validation Service
// ─────────────────────────────────────────────────────────────────────────────

export class ClaimAndMetricValidator {
  private static FORBIDDEN_METRIC_PATTERNS = [
    /\b\d+x\s*(slower|faster|increase|decrease|growth|latency|spikes?)\b/i,
    /\bp99\s*(latency|spiked|increased|doubled|tripled|\+\d+%)\b/i,
    /\blatency\s*(doubled|tripled|4x|3x|\d+\s*ms|\d+\s*seconds?)\b/i,
    /\bgpu\s*(utilization|contention|\d+%)\b/i,
    /\b\d+%\s*(drop|degradation|failure|packet loss)\b/i
  ];

  private static FORBIDDEN_CLAIM_PATTERNS = [
    /\byour\s*(outage|incident|downtime|security breach|vulnerability|failure)\b/i,
    /\bcustomers\s*are\s*(complaining|leaving|churning|unhappy)\b/i,
    /\byour\s*infrastructure\s*is\s*(broken|failing|struggling|unstable)\b/i,
    /\byour\s*cloud\s*spend\s*is\s*(wasted|too high|exploding)\b/i
  ];

  static validate(text: string): { isValid: boolean; blockReason: string } {
    if (!text) return { isValid: true, blockReason: '' };

    for (const pattern of this.FORBIDDEN_METRIC_PATTERNS) {
      if (pattern.test(text)) {
        return {
          isValid: false,
          blockReason: 'FABRICATED_METRIC: Contains quantitative claims (e.g. p99 latency spikes, 4x metrics) not verified by public source.'
        };
      }
    }

    for (const pattern of this.FORBIDDEN_CLAIM_PATTERNS) {
      if (pattern.test(text)) {
        return {
          isValid: false,
          blockReason: 'FABRICATED_CLAIM: Contains unproven negative/downfall claims about internal infrastructure or outages.'
        };
      }
    }

    return { isValid: true, blockReason: '' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Target Freshness Classifier
// ─────────────────────────────────────────────────────────────────────────────

export class TargetFreshnessClassifier {
  static computeAgeDays(dateStr: string): number {
    if (!dateStr || dateStr.trim() === '') return 9999;
    if (dateStr.startsWith('DIRECT_CONTACT')) return 2;
    try {
      const pub = new Date(dateStr);
      const now = new Date();
      const diff = Math.floor((now.getTime() - pub.getTime()) / (1000 * 60 * 60 * 24));
      return isNaN(diff) ? 9999 : Math.max(0, diff);
    } catch {
      return 9999;
    }
  }

  static classify(ageDays: number): FreshnessCategory {
    if (ageDays <= 7) return 'VERY_RECENT';
    if (ageDays <= 30) return 'RECENT';
    if (ageDays <= 90) return 'HISTORICAL';
    return 'OLD';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Target Qualification Engine (Main Orchestrator)
// ─────────────────────────────────────────────────────────────────────────────

export class TargetQualificationEngine {
  
  /**
   * Qualifies a single prospect against every mandatory gate.
   */
  static qualifyTarget(
    rawCompany: AllCompanyResearch | any,
    options?: {
      overrideRecipient?: string;
      overrideEmail?: string;
      isUserResearchVerified?: boolean;
      outreachStatus?: string;
      liveSignal?: SignalRecord | null;
    }
  ): QualifiedTargetRecord {
    const companyName = rawCompany.name || rawCompany.n || '';
    const companyWebsite = rawCompany.website || rawCompany.web || '';
    const companyCto = rawCompany.cto || '';
    const companyVp = rawCompany.vpEngineering || rawCompany.vp || '';
    const companyCeo = rawCompany.ceo || '';
    const companyEmail = rawCompany.email || rawCompany.em || '';
    const outreachStatus = options?.outreachStatus || 'UNCONTACTED';

    // Gate 0: If technical conversation already started, stop automation immediately
    if (outreachStatus === 'REPLIED_TECHNICAL' || outreachStatus === 'MEETING_BOOKED' || outreachStatus === 'CONVERTED') {
      return {
        company: companyName,
        person: options?.overrideRecipient || companyCto || companyCeo || 'Executive',
        role: 'Technical Executive',
        signal: 'TECHNICAL_CONVERSATION_ACTIVE',
        source: 'Direct Inbound/Outbound Exchange',
        sourceType: 'Direct Technical Conversation',
        date: new Date().toISOString().split('T')[0],
        age: 0,
        freshness: 'VERY_RECENT',
        evidence: `Active technical discussion in progress (Status: ${outreachStatus}). Automated outreach strictly halted.`,
        confidence: 'HIGH',
        score: 100,
        priority: 'P0',
        personaMatch: 'CTO',
        emailVerified: true,
        identityVerified: true,
        domainVerified: true,
        angle: 'K_TECHNICAL_FOLLOWUP',
        status: 'AUTOMATION_STOPPED',
        blockReason: `AUTOMATION_STOPPED: Prospect is already engaged in technical discussion (${outreachStatus}).`,
        pilotRankScore: 2000,
        allGatesPassed: true
      };
    }

    // Gate 1: Check Live Discovered Signal or Verified Signal Database
    const liveSignal = options?.liveSignal;
    const staticSignal = !liveSignal ? SIGNAL_DATABASE.find(
      s => s.company.toLowerCase() === companyName.toLowerCase()
    ) : null;

    const signalEntry = liveSignal ? {
      company: liveSignal.company,
      signalType: liveSignal.signalType,
      sourceUrl: liveSignal.sourceUrl,
      sourceType: liveSignal.sourceType,
      publishedAt: liveSignal.publishedAt,
      evidenceVerbatim: liveSignal.evidenceText,
      confidenceLevel: liveSignal.confidence,
      technicalRelevance: liveSignal.technicalRelevance,
      personaRelevance: liveSignal.personaRelevance,
      recommendedPersona: liveSignal.recommendedPersona,
      recommendedAngle: liveSignal.recommendedAngle,
      businessImplication: liveSignal.businessImplication,
      engineeringImplication: liveSignal.engineeringImplication,
      verificationStatus: liveSignal.verificationStatus
    } : staticSignal ? {
      ...staticSignal
    } : null;

    // Hard Block: NO ACTIONABLE SIGNAL FOUND
    if (!signalEntry || signalEntry.signalType === 'NO_ACTIONABLE_SIGNAL' || !signalEntry.sourceUrl) {
      return {
        company: companyName,
        person: options?.overrideRecipient || companyCto || companyCeo || 'Engineering Lead',
        role: companyCto ? 'CTO' : companyVp ? 'VP Engineering' : 'CEO',
        signal: 'NO_ACTIONABLE_SIGNAL',
        source: '',
        sourceType: '',
        date: '',
        age: 9999,
        freshness: 'OLD',
        evidence: '',
        confidence: 'LOW',
        score: 0,
        priority: 'P3',
        personaMatch: '',
        emailVerified: false,
        identityVerified: false,
        domainVerified: false,
        angle: '',
        status: 'BLOCKED',
        blockReason: 'P3: No real, publicly verifiable signal found. Must be researched before outreach.',
        pilotRankScore: 0,
        allGatesPassed: false
      };
    }

    // Gate 2: Source URL Verification
    if (!signalEntry.sourceUrl || signalEntry.sourceUrl.trim() === '') {
      return this.buildBlockedRecord(rawCompany, signalEntry, 'NO_SOURCE', 'Missing public source URL.');
    }
    if (!signalEntry.sourceUrl.startsWith('DIRECT_CONTACT') && !signalEntry.sourceUrl.startsWith('http')) {
      return this.buildBlockedRecord(rawCompany, signalEntry, 'NO_SOURCE', 'Malformed or invalid source URL.');
    }

    // Gate 3: Published Date Verification
    if (!signalEntry.publishedAt || signalEntry.publishedAt.trim() === '') {
      return this.buildBlockedRecord(rawCompany, signalEntry, 'NO_DATE', 'Missing published date in public signal.');
    }
    const ageDays = TargetFreshnessClassifier.computeAgeDays(signalEntry.publishedAt);
    if (isNaN(ageDays) || ageDays >= 9000) {
      return this.buildBlockedRecord(rawCompany, signalEntry, 'NO_DATE', 'Unparseable or invalid published date.');
    }

    // Gate 4: Evidence Text Verification (No thin or fake evidence)
    if (!signalEntry.evidenceVerbatim || signalEntry.evidenceVerbatim.trim().length < 40) {
      return this.buildBlockedRecord(rawCompany, signalEntry, 'THIN_EVIDENCE', 'Evidence text too short (<40 chars) or generic.');
    }

    // Gate 5: Freshness & Stale Downgrade
    const freshness = TargetFreshnessClassifier.classify(ageDays);
    const isOldSignal = freshness === 'OLD'; // >90 days

    // Gate 6: Deterministic Scoring
    const confidenceScore = signalEntry.confidenceLevel === 'HIGH' ? 25 : signalEntry.confidenceLevel === 'MEDIUM' ? 15 : 5;
    const recencyScore = ageDays <= 7 ? 25 : ageDays <= 30 ? 20 : ageDays <= 90 ? 10 : 2;
    const rawScore = Math.min(100, recencyScore + signalEntry.technicalRelevance + signalEntry.personaRelevance + confidenceScore);
    
    let priority: PriorityTier = rawScore >= 85 ? 'P0' : rawScore >= 70 ? 'P1' : rawScore >= 50 ? 'P2' : 'P3';
    
    // Core Rule: Stale signal (>90d) CANNOT be P0 — automatically downgraded
    if (isOldSignal && priority === 'P0') {
      priority = 'P1';
    }

    // Gate 7: P3 Hard Block
    if (priority === 'P3' || rawScore < 50) {
      return this.buildBlockedRecord(rawCompany, signalEntry, 'P3', `Signal score (${rawScore}/100) below qualification threshold.`);
    }

    // Gate 8: Persona Matching
    const personaMatch = signalEntry.recommendedPersona || (companyCto ? 'CTO' : companyVp ? 'VP_ENGINEERING' : 'FOUNDER');
    if (!personaMatch || personaMatch === 'NO_MATCH') {
      return this.buildBlockedRecord(rawCompany, signalEntry, 'PERSONA_MISMATCH', 'Inferred persona does not align with technical signal.');
    }

    // Gate 9: Recipient Person & Identity Validation
    const recipient = options?.overrideRecipient?.trim() || companyCto || companyVp || companyCeo || 'Engineering Lead';
    const email = options?.overrideEmail?.trim() || companyEmail || '';
    const isUserResearchVerified = !!options?.isUserResearchVerified;

    const firstName = recipient.split(' ')[0].toLowerCase();
    const emailPrefix = email.toLowerCase().split('@')[0];
    const emailParts = emailPrefix.split(/[._-]/);
    
    const autoNameMatch = emailParts.some(part => part.includes(firstName) || (firstName.length > 2 && firstName.includes(part))) ||
                          emailPrefix.includes(firstName) ||
                          firstName.length <= 2;
    
    const isIdentityVerified = isUserResearchVerified || autoNameMatch;

    if (!isIdentityVerified) {
      return this.buildBlockedRecord(
        rawCompany, 
        signalEntry, 
        'IDENTITY_MISMATCH', 
        `IDENTITY_MISMATCH: Recipient (${recipient}) does not match mailbox (${email}). Verify via research.`
      );
    }

    // Gate 10: Email Domain Validation
    const domainValidation = EmailDomainValidator.validate(
      email, 
      companyWebsite || companyName.toLowerCase() + '.com', 
      isUserResearchVerified
    );
    if (!domainValidation.isValid) {
      return this.buildBlockedRecord(rawCompany, signalEntry, 'EMAIL_DOMAIN_MISMATCH', domainValidation.blockReason);
    }

    // Gate 11: Claim & Metric Validation on Evidence & Angle
    const claimCheck = ClaimAndMetricValidator.validate(signalEntry.evidenceVerbatim + ' ' + signalEntry.engineeringImplication);
    if (!claimCheck.isValid) {
      return this.buildBlockedRecord(rawCompany, signalEntry, 'FABRICATED_CLAIM', claimCheck.blockReason);
    }

    // Gate 12: Stale Signal Block (If >90d and not direct contact P0)
    if (isOldSignal && signalEntry.signalType !== 'DIRECT_CONTACT_EVIDENCE') {
      return this.buildBlockedRecord(
        rawCompany, 
        signalEntry, 
        'OLD_SIGNAL', 
        `OLD_SIGNAL: Public signal is ${ageDays} days old (>90d). Requires fresh research before outreach.`
      );
    }

    // ── ALL MANDATORY GATES PASSED ──────────────────────────────────────────
    // Compute Pilot Ranking Score
    let pilotRankScore = 0;
    if (priority === 'P0') pilotRankScore += 1000;
    else if (priority === 'P1') pilotRankScore += 500;
    else if (priority === 'P2') pilotRankScore += 100;

    if (freshness === 'VERY_RECENT') pilotRankScore += 100;
    else if (freshness === 'RECENT') pilotRankScore += 50;
    else if (freshness === 'HISTORICAL') pilotRankScore += 10;

    if (signalEntry.confidenceLevel === 'HIGH') pilotRankScore += 50;
    else if (signalEntry.confidenceLevel === 'MEDIUM') pilotRankScore += 25;

    pilotRankScore += signalEntry.technicalRelevance;
    pilotRankScore += signalEntry.personaRelevance;
    if (isIdentityVerified && domainValidation.isValid) pilotRankScore += 50;

    return {
      company: companyName,
      person: recipient,
      role: companyCto && recipient === companyCto ? 'CTO' : companyVp && recipient === companyVp ? 'VP Engineering' : 'Executive',
      signal: signalEntry.signalType,
      source: signalEntry.sourceUrl,
      sourceType: signalEntry.sourceType,
      date: signalEntry.publishedAt,
      age: ageDays,
      freshness,
      evidence: signalEntry.evidenceVerbatim,
      confidence: signalEntry.confidenceLevel,
      score: rawScore,
      priority,
      personaMatch,
      emailVerified: true,
      identityVerified: true,
      domainVerified: true,
      angle: signalEntry.recommendedAngle,
      status: 'READY_FOR_HUMAN_APPROVAL',
      blockReason: '',
      pilotRankScore,
      allGatesPassed: true,
      notes: signalEntry.businessImplication
    };
  }

  /**
   * Qualifies all companies in the dataset and ranks Top 10 Pilot Targets.
   */
  static qualifyAllCompanies(
    outreachStore: Record<string, any> = {},
    discoveredSignalsMap: Record<string, SignalRecord> = {}
  ): {
    allTargets: QualifiedTargetRecord[];
    top10PilotTargets: QualifiedTargetRecord[];
    metrics: {
      total: number;
      readyForHumanApproval: number;
      p0Count: number;
      p1Count: number;
      p2Count: number;
      p3Blocked: number;
      identityBlocked: number;
      domainBlocked: number;
      oldSignalBlocked: number;
    };
  } {
    const allTargets: QualifiedTargetRecord[] = [];
    const metrics = {
      total: ALL_COMPANIES_RESEARCH_DATA.length,
      readyForHumanApproval: 0,
      p0Count: 0,
      p1Count: 0,
      p2Count: 0,
      p3Blocked: 0,
      identityBlocked: 0,
      domainBlocked: 0,
      oldSignalBlocked: 0
    };

    for (const company of ALL_COMPANIES_RESEARCH_DATA) {
      const slug = company.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const storeItem = outreachStore[slug] || {};
      const liveSignal = discoveredSignalsMap[company.name.toLowerCase()];

      const qualified = this.qualifyTarget(company, {
        overrideRecipient: storeItem.activeRecipient,
        overrideEmail: storeItem.verifiedEmailAddress,
        isUserResearchVerified: storeItem.isUserResearchVerified,
        outreachStatus: storeItem.status,
        liveSignal
      });

      allTargets.push(qualified);

      if (qualified.status === 'READY_FOR_HUMAN_APPROVAL') {
        metrics.readyForHumanApproval++;
      }

      if (qualified.priority === 'P0') metrics.p0Count++;
      else if (qualified.priority === 'P1') metrics.p1Count++;
      else if (qualified.priority === 'P2') metrics.p2Count++;
      else metrics.p3Blocked++;

      if (qualified.blockReason.includes('IDENTITY_MISMATCH')) {
        metrics.identityBlocked++;
      }
      if (qualified.blockReason.includes('EMAIL_DOMAIN_MISMATCH')) {
        metrics.domainBlocked++;
      }
      if (qualified.blockReason.includes('OLD_SIGNAL')) {
        metrics.oldSignalBlocked++;
      }
    }

    // Top 10 Pilot Targets: Filter items passing all gates, sort by pilotRankScore DESC
    const top10PilotTargets = allTargets
      .filter(t => t.status === 'READY_FOR_HUMAN_APPROVAL' && t.allGatesPassed)
      .sort((a, b) => b.pilotRankScore - a.pilotRankScore)
      .slice(0, 10);

    return {
      allTargets,
      top10PilotTargets,
      metrics
    };
  }

  private static buildBlockedRecord(
    rawCompany: any,
    signalEntry: any,
    hardBlockType: string,
    reasonDetail: string
  ): QualifiedTargetRecord {
    const companyName = rawCompany.name || rawCompany.n || '';
    const companyCto = rawCompany.cto || '';
    const companyVp = rawCompany.vpEngineering || rawCompany.vp || '';
    const companyCeo = rawCompany.ceo || '';

    const ageDays = TargetFreshnessClassifier.computeAgeDays(signalEntry.publishedAt || '');
    const freshness = TargetFreshnessClassifier.classify(ageDays);

    return {
      company: companyName,
      person: companyCto || companyVp || companyCeo || 'Engineering Lead',
      role: companyCto ? 'CTO' : companyVp ? 'VP Engineering' : 'CEO',
      signal: signalEntry.signalType || 'NO_ACTIONABLE_SIGNAL',
      source: signalEntry.sourceUrl || '',
      sourceType: signalEntry.sourceType || 'Direct',
      date: signalEntry.publishedAt || '',
      age: ageDays,
      freshness,
      evidence: signalEntry.evidenceVerbatim || '',
      confidence: signalEntry.confidenceLevel || 'LOW',
      score: 0,
      priority: 'P3',
      personaMatch: signalEntry.recommendedPersona || '',
      emailVerified: false,
      identityVerified: false,
      domainVerified: false,
      angle: signalEntry.recommendedAngle || '',
      status: 'BLOCKED',
      blockReason: `${hardBlockType}: ${reasonDetail}`,
      pilotRankScore: 0,
      allGatesPassed: false
    };
  }
}
