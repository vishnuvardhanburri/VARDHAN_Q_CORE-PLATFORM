/**
 * VARDHAN — STAGE 6 OUTREACH DRAFTING + SIMILARITY CONTROLS
 * ─────────────────────────────────────────────────────────────────────────────
 * Draft-only outreach layer over QualifiedOpportunity (commercial
 * qualification). This module NEVER sends, enrols, or transmits anything:
 * it produces OutreachDraft objects for human review. No SMTP, no network.
 *
 * Hard invariants (enforced in CODE, not comments):
 *   - Drafts require a GO verdict (anything else → brief-without-email null).
 *   - Drafts require a dated, sourced WHY_NOW and ≥1 URL-backed public fact.
 *   - Body is 60–100 words inclusive. Over budget → trim the closing
 *     politely (optional sentences first, then a word-boundary truncation
 *     that preserves the verbatim CTA); under budget → null, never pad.
 *   - Exactly one question in the body: the verbatim CTA.
 *   - Inference is labelled ("we hypothesize"); the draft acknowledges that
 *     the prospect's existing controls may already suffice.
 *   - Facts only from opp.publicFacts / opp.whyNow. No named persons, no
 *     guessed emails or phones (buyer role titles only).
 *   - No price by default; a price may appear only when opp.commercial
 *     carries an explicit priceNote on a stage.
 *   - Unsupported claims (guarantees, compliance/certification language,
 *     breach/control-failure language, production-ready or multi-node
 *     claims) block the draft → null with a reason.
 *   - Template reuse is policed by word-bigram Jaccard similarity:
 *     maxSim >= 0.55 against prior texts → regenerate once with reordered
 *     sentences; still too similar → null ('template reuse blocked').
 *
 * Determinism: pure functions of their input. No randomness, no Date.now(),
 * no network.
 */

import type {
  CapabilityMapping,
  CommercialStage,
  PublicFact,
  QualifiedOpportunity,
} from './OpportunityQualification.ts';

/** Verbatim call-to-action closing every draft (the single question). */
export const OUTREACH_CTA = 'Would it be worth a 10-minute review?';

/** Verbatim acknowledgement that existing controls may suffice. */
export const CONTROLS_ACK = 'your existing controls may already cover this';

/** Inference-label marker required in the hypothesis sentence. */
export const HYPOTHESIS_MARKER = 'we hypothesize';

/** Body word-count budget (inclusive on both ends). */
export const BODY_MIN_WORDS = 60;
export const BODY_MAX_WORDS = 100;

/** Bigram-Jaccard similarity at/above which a draft is "too similar". */
export const SIMILARITY_THRESHOLD = 0.55;

/** Draft-only outreach artefact. No sending, no enrolment, no SMTP. */
export interface OutreachDraft {
  company: string;
  buyerFunction: string;
  subject: string;
  body: string;
  wordCount: number;
  signalUrl: string;
  signalDate: string;
  workflowHypothesis: string;
  qcoreSentence: string;
  question: string;
  cta: string;
  templateHash: string;
}

/** Null-with-reason wrapper. reason is non-null exactly when draft is null. */
export interface DraftResult {
  draft: OutreachDraft | null;
  reason: string | null;
}

/** Outcome of a template-reuse similarity check against prior outreach. */
export interface SimilarityCheck {
  maxSim: number;
  tooSimilar: boolean;
}

/** Phrases that block a draft (case-insensitive substring match). */
export const UNSUPPORTED_CLAIM_PHRASES: readonly string[] = [
  'guarantee',
  'certified',
  'compliant',
  'vulnerability in your',
  'breach',
  'control failure',
  'production-ready',
  'multi-node',
] as const;

type SentenceOrder = 'standard' | 'reordered';

/** Count whitespace-separated words. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
}

function countChar(text: string, ch: string): number {
  let n = 0;
  for (const c of text) {
    if (c === ch) n += 1;
  }
  return n;
}

/** Strip question marks (the CTA owns the single '?'), collapse whitespace. */
function sanitizeInline(text: string): string {
  return text.replace(/\?/g, '.').replace(/\s+/g, ' ').trim();
}

/** Remove a single trailing period so fragments compose into new sentences. */
function unfragment(text: string): string {
  const clean: string = sanitizeInline(text);
  return clean.endsWith('.') ? clean.slice(0, -1).trim() : clean;
}

function decapitalize(text: string): string {
  if (text.length === 0) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** 'sealed-receipts' → 'sealed receipts' for readable capability phrasing. */
function humaniseCapability(capability: string): string {
  return capability.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** First mapping that may be referenced (DEMONSTRATED preferred). */
function firstFittedMapping(
  mappings: readonly CapabilityMapping[]
): CapabilityMapping | undefined {
  return (
    mappings.find((m: CapabilityMapping) => m.level === 'DEMONSTRATED') ??
    mappings.find((m: CapabilityMapping) => m.level === 'PARTIAL')
  );
}

/** First URL-backed public fact (facts-only grounding source). */
function firstGroundedFact(publicFacts: readonly PublicFact[]): PublicFact | undefined {
  return publicFacts.find(
    (f: PublicFact) => f.fact.trim().length > 0 && f.sourceUrl.trim().length > 0
  );
}

/** True when the text contains any blocked claim phrase (case-insensitive). */
export function containsUnsupportedClaim(text: string): boolean {
  return blockedPhraseIn(text) !== null;
}

function blockedPhraseIn(text: string): string | null {
  const hay: string = text.toLowerCase();
  for (const phrase of UNSUPPORTED_CLAIM_PHRASES) {
    if (hay.includes(phrase.toLowerCase())) return phrase;
  }
  return null;
}

/** Lowercase alphanumeric tokens; punctuation becomes a separator. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t: string) => t.length > 0);
}

function bigramSet(tokens: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    set.add(tokens[i] + ' ' + tokens[i + 1]);
  }
  return set;
}

/**
 * Word-bigram Jaccard similarity in [0, 1]. Lowercase, punctuation
 * stripped. Identical texts → 1; both empty → 1; one empty → 0.
 */
export function jaccardSimilarity(a: string, b: string): number {
  const setA: Set<string> = bigramSet(tokenize(a));
  const setB: Set<string> = bigramSet(tokenize(b));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection += 1;
  }
  const union: number = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/** Deterministic 8-hex template hash of the normalised body. */
export function hashTemplate(text: string): string {
  const norm: string = text.toLowerCase().replace(/\s+/g, ' ').trim();
  let hash = 5381;
  for (let i = 0; i < norm.length; i += 1) {
    hash = ((hash << 5) + hash + norm.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Compare a draft against prior outreach bodies (and optional prior
 * template hashes). An exact hash match forces maxSim to 1.
 */
export function checkSimilarity(
  draft: OutreachDraft,
  priorTexts: readonly string[],
  priorHashes: readonly string[] = []
): SimilarityCheck {
  let maxSim = 0;
  for (const prior of priorTexts) {
    const sim: number = jaccardSimilarity(draft.body, prior);
    if (sim > maxSim) maxSim = sim;
  }
  if (priorHashes.includes(draft.templateHash)) {
    maxSim = Math.max(maxSim, 1);
  }
  return { maxSim, tooSimilar: maxSim >= SIMILARITY_THRESHOLD };
}

/** Explicit priceNote on a commercial stage (absent by default). */
function stagePriceNote(stage: CommercialStage): string | null {
  if ('priceNote' in stage) {
    const value: unknown = (stage as { priceNote?: unknown }).priceNote;
    if (typeof value === 'string' && value.trim().length > 0) {
      return sanitizeInline(value);
    }
  }
  return null;
}

function explicitPriceNote(commercial: readonly CommercialStage[]): string | null {
  for (const stage of commercial) {
    const note: string | null = stagePriceNote(stage);
    if (note !== null) return note;
  }
  return null;
}

interface DraftSentences {
  signal: string;
  fact: string;
  hypothesis: string;
  qcore: string;
  controls: string;
}

function buildSentences(
  opp: QualifiedOpportunity,
  mapping: CapabilityMapping
): DraftSentences {
  const whyNow = opp.whyNow;
  const eventFragment: string = whyNow !== null ? unfragment(whyNow.event) : '';
  const publishedDate: string = whyNow !== null ? whyNow.publishedDate.trim() : '';
  const groundedFact: PublicFact | undefined = firstGroundedFact(opp.publicFacts);
  const factFragment: string = groundedFact !== undefined ? unfragment(groundedFact.fact) : '';
  const workflow: string = sanitizeInline(opp.workflow);
  const problemFragment: string = decapitalize(unfragment(opp.problemHypothesis));
  const capability: string = humaniseCapability(mapping.capability);
  const testName: string = sanitizeInline(mapping.evidenceRef.testName);
  return {
    signal: `We noticed ${opp.company} ${eventFragment}, published on ${publishedDate}.`,
    fact: `Publicly, ${factFragment}.`,
    hypothesis:
      `${HYPOTHESIS_MARKER} that this creates extra review work for your ` +
      `${workflow} workflow, where ${problemFragment}.`,
    qcore:
      `Q-Core includes a ${capability} capability, demonstrated by test ` +
      `'${testName}' in our sealed suite.`,
    controls:
      `Of course, ${CONTROLS_ACK}, and we do not assume otherwise.`,
  };
}

function orderContent(sentences: DraftSentences, order: SentenceOrder): string[] {
  if (order === 'reordered') {
    return [sentences.fact, sentences.hypothesis, sentences.signal, sentences.qcore, sentences.controls];
  }
  return [sentences.signal, sentences.fact, sentences.hypothesis, sentences.qcore, sentences.controls];
}

/** Final invariant gate shared by the standard and regenerated builds. */
function verifyBody(body: string): string | null {
  const words: number = countWords(body);
  if (words < BODY_MIN_WORDS || words > BODY_MAX_WORDS) {
    return `Body is ${words} words, outside the ${BODY_MIN_WORDS}-${BODY_MAX_WORDS} budget.`;
  }
  if (countChar(body, '?') !== 1) {
    return 'Body must contain exactly one question (the verbatim CTA).';
  }
  if (!body.includes(OUTREACH_CTA)) {
    return 'Body must close with the verbatim CTA.';
  }
  if (!body.includes(CONTROLS_ACK)) {
    return 'Body must acknowledge existing controls may suffice.';
  }
  if (!body.toLowerCase().includes(HYPOTHESIS_MARKER)) {
    return 'Body must label inference with "we hypothesize".';
  }
  const blocked: string | null = blockedPhraseIn(body);
  if (blocked !== null) {
    return `Unsupported claim blocked: '${blocked}'.`;
  }
  return null;
}

/**
 * Fit content sentences into the word budget. Drops the optional fact
 * sentence first, then truncates the closing on a word boundary while
 * preserving the verbatim CTA. Returns null when required slots cannot
 * fit (never pads an under-budget draft).
 */
function fitBody(
  content: string[],
  fact: string,
  priceSentence: string | null,
  priceRequired: boolean
): { body: string } | { error: string } {
  const ctaWords: number = countWords(OUTREACH_CTA);
  const candidates: string[][] = [];
  if (priceSentence !== null) {
    candidates.push([...content, priceSentence, OUTREACH_CTA]);
  } else {
    candidates.push([...content, OUTREACH_CTA]);
  }
  // Trim path 1: drop the optional corroborating-fact sentence.
  candidates.push(candidates[0].filter((s: string) => s !== fact));
  for (const parts of candidates) {
    const body: string = parts.join(' ');
    const words: number = countWords(body);
    if (words >= BODY_MIN_WORDS && words <= BODY_MAX_WORDS) {
      const problem: string | null = verifyBody(body);
      if (problem === null) return { body };
    }
  }
  // Trim path 2: word-boundary truncation preserving the verbatim CTA.
  const nonCta: string[] = candidates[1].filter((s: string) => s !== OUTREACH_CTA);
  if (priceRequired && priceSentence !== null && !nonCta.includes(priceSentence)) {
    nonCta.push(priceSentence);
  }
  const keep: number = BODY_MAX_WORDS - ctaWords;
  const truncatedWords: string[] = nonCta.join(' ').split(/\s+/).filter((w: string) => w.length > 0).slice(0, keep);
  let truncated: string = truncatedWords.join(' ');
  if (!/[.!?]$/.test(truncated)) truncated += '.';
  const body: string = truncated + ' ' + OUTREACH_CTA;
  const problem: string | null = verifyBody(body);
  if (problem === null) return { body };
  return { error: `Cannot fit required slots within ${BODY_MAX_WORDS} words: ${problem}` };
}

function isFitError(value: { body: string } | { error: string }): value is { error: string } {
  return 'error' in value;
}

/**
 * Draft outreach for a qualified opportunity, with machine-readable
 * reasons. Pure and deterministic. priorTexts enables the template-reuse
 * path: too similar → one reordered regeneration → still similar → null.
 */
export function draftOutreachWithReason(
  opp: QualifiedOpportunity,
  priorTexts: readonly string[] = [],
  priorHashes: readonly string[] = []
): DraftResult {
  if (opp.verdict !== 'GO') {
    return {
      draft: null,
      reason: `Brief-without-email: verdict is ${opp.verdict}; outreach drafts require GO.`,
    };
  }
  const whyNow = opp.whyNow;
  if (
    whyNow === null ||
    whyNow.event.trim().length === 0 ||
    whyNow.sourceUrl.trim().length === 0 ||
    whyNow.publishedDate.trim().length === 0
  ) {
    return {
      draft: null,
      reason: 'Brief-without-email: GO draft requires a dated, sourced WHY_NOW (event, sourceUrl, publishedDate).',
    };
  }
  const grounded: boolean = opp.publicFacts.some(
    (f) => f.fact.trim().length > 0 && f.sourceUrl.trim().length > 0
  );
  if (!grounded) {
    return {
      draft: null,
      reason: 'Brief-without-email: GO draft requires at least one URL-backed public fact.',
    };
  }
  const mapping: CapabilityMapping | undefined = firstFittedMapping(opp.capabilityMappings);
  if (mapping === undefined) {
    return {
      draft: null,
      reason: 'Brief-without-email: GO draft requires a DEMONSTRATED or PARTIAL capability mapping.',
    };
  }
  if (opp.buyerRole.function.trim().length === 0) {
    return {
      draft: null,
      reason: 'Brief-without-email: GO draft requires an identified buyer function.',
    };
  }

  const subject: string = `Idea for ${sanitizeInline(opp.workflow)} at ${opp.company}`;
  const subjectBlocked: string | null = blockedPhraseIn(subject);
  if (subjectBlocked !== null) {
    return { draft: null, reason: `Unsupported claim blocked: '${subjectBlocked}'.` };
  }

  const sentences: DraftSentences = buildSentences(opp, mapping);
  const priceNote: string | null = explicitPriceNote(opp.commercial);
  const priceSentence: string | null =
    priceNote !== null ? `Commercially, ${priceNote}.` : null;

  const build = (order: SentenceOrder): { body: string } | { error: string } =>
    fitBody(orderContent(sentences, order), sentences.fact, priceSentence, priceNote !== null);

  const assemble = (body: string): OutreachDraft => ({
    company: opp.company,
    buyerFunction: opp.buyerRole.function,
    subject,
    body,
    wordCount: countWords(body),
    signalUrl: whyNow.sourceUrl,
    signalDate: whyNow.publishedDate,
    workflowHypothesis: sentences.hypothesis,
    qcoreSentence: sentences.qcore,
    question: OUTREACH_CTA,
    cta: OUTREACH_CTA,
    templateHash: hashTemplate(body),
  });

  const first: { body: string } | { error: string } = build('standard');
  if (isFitError(first)) {
    return { draft: null, reason: `${first.error} Refusing to pad an under-budget draft.` };
  }
  let draft: OutreachDraft = assemble(first.body);
  let check: SimilarityCheck = checkSimilarity(draft, priorTexts, priorHashes);
  if (!check.tooSimilar) return { draft, reason: null };

  // Regenerate once with reordered sentences, then re-check.
  const second: { body: string } | { error: string } = build('reordered');
  if (isFitError(second)) {
    return { draft: null, reason: `${second.error} Refusing to pad an under-budget draft.` };
  }
  draft = assemble(second.body);
  check = checkSimilarity(draft, priorTexts, priorHashes);
  if (!check.tooSimilar) return { draft, reason: null };
  return {
    draft: null,
    reason:
      `Template reuse blocked: draft too similar to prior outreach ` +
      `(maxSim ${check.maxSim.toFixed(3)} >= ${SIMILARITY_THRESHOLD}) after one regeneration.`,
  };
}

/**
 * Draft outreach for a qualified opportunity. Returns the draft, or null
 * (brief-without-email) when the opportunity is not draftable. Use
 * draftOutreachWithReason for the machine-readable blocking reason.
 */
export function draftOutreach(
  opp: QualifiedOpportunity,
  priorTexts: readonly string[] = [],
  priorHashes: readonly string[] = []
): OutreachDraft | null {
  return draftOutreachWithReason(opp, priorTexts, priorHashes).draft;
}
