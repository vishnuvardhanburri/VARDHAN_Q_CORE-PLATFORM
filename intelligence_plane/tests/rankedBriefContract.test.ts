/**
 * VARDHAN — ranked.json API-contract test (STAGE 7 contract defect).
 * ─────────────────────────────────────────────────────────────────────────
 * The Rust BriefSummary struct (backend/control_plane_api/src/
 * intelligence_briefs.rs) has NO #[serde(default)], so every ranked.json
 * entry MUST carry the keys signal_url / why_now / buyer_role (null, never
 * missing) or list_briefs fails the whole file with 500 BRIEFS_INVALID.
 *
 * This test loads the REAL .research/briefs/ranked.json artifact and
 * asserts the contract keys are present on every entry, plus the parse
 * shape (company string, verdict in {GO,HOLD,DROP}, score 0-100).
 * It also unit-tests the toRankedBrief mapper on GO-shaped and HOLD-shaped
 * briefs (whyNow present → why_now non-null string; empty facts → nulls
 * with keys present; draft path passes through untouched).
 * Run with:
 *   npx vitest run tests/rankedBriefContract.test.ts
 */
import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  toRankedBrief,
  type RankedBrief,
  type SweepBrief,
} from '../src/server/commercial/SweepBriefing.ts';

/** intelligence_plane root → .research/briefs/ranked.json (real artifact). */
const TEST_DIR: string = path.dirname(fileURLToPath(import.meta.url));
const RANKED_PATH: string = path.join(TEST_DIR, '..', '.research', 'briefs', 'ranked.json');

const VERDICTS: readonly string[] = ['GO', 'HOLD', 'DROP'];

/** GO-shaped fixture: dated trigger present, verified facts, draft allowed. */
function goFixture(): SweepBrief {
  return {
    company: 'TestBank',
    domain: 'testbank.com',
    runId: 'run_fixture_go',
    verdict: 'GO',
    verdictReason: 'Fresh corroborated trigger present.',
    score: 87,
    whyNow: {
      event: 'TestBank announces payments modernisation programme',
      sourceUrl: 'https://testbank.com/news/payments-programme',
      publishedDate: '2026-09-01T00:00:00.000Z',
    },
    publicFacts: [
      {
        fact: 'TestBank payments modernisation programme — verified excerpt',
        sourceUrl: 'https://testbank.com/news/payments-programme',
      },
    ],
    capabilityMappings: [],
    buyerRole: {
      function: 'Payments Operations / Trade Finance Operations',
      why: 'Owns payment review capacity.',
      buyerType: 'CHAMPION',
    },
    draft: { sub: 'TestBank / review load', body: 'Hello world draft body', wordCount: 75 },
    draftBlockedReason: null,
    signals: [],
    limitations: [],
    stats: { sourcesRetrieved: 1, sourcesAttempted: 1, duplicateRate: 0, claimsWithEvidencePct: 100 },
  };
}

/** HOLD-shaped fixture: honest empty, no trigger, no facts, no draft. */
function holdFixture(): SweepBrief {
  return {
    company: 'Ghost Bank',
    domain: 'ghost.example',
    runId: 'run_fixture_hold',
    verdict: 'HOLD',
    verdictReason: 'No WHY_NOW trigger: GO requires a dated, sourced trigger event.',
    score: 60,
    whyNow: null,
    publicFacts: [],
    capabilityMappings: [],
    buyerRole: {
      function: 'Payments Operations / Trade Finance Operations',
      why: 'Owns payment review capacity.',
      buyerType: 'CHAMPION',
    },
    draft: null,
    draftBlockedReason: 'Brief-without-email: verdict is HOLD; outreach drafts require GO.',
    signals: [],
    limitations: ['No fresh corroborated MEDIUM+ trigger found.'],
    stats: { sourcesRetrieved: 0, sourcesAttempted: 0, duplicateRate: 0, claimsWithEvidencePct: 0 },
  };
}

describe('ranked.json API contract (Rust BriefSummary)', () => {
  test('(a) real ranked.json: every entry carries signal_url/why_now/buyer_role + parse shape', () => {
    const raw: string = fs.readFileSync(RANKED_PATH, 'utf8');
    const entries: unknown = JSON.parse(raw);
    expect(Array.isArray(entries)).toBe(true);
    const list: Record<string, unknown>[] = entries as Record<string, unknown>[];
    expect(list.length).toBe(4);
    for (const entry of list) {
      // Contract keys MUST be present (null, never undefined/missing).
      for (const key of ['signal_url', 'why_now', 'buyer_role'] as const) {
        expect(Object.prototype.hasOwnProperty.call(entry, key)).toBe(true);
        const value: unknown = entry[key];
        expect(value === null || typeof value === 'string').toBe(true);
      }
      // Parse shape: company string, verdict enum, score 0-100.
      expect(typeof entry['company']).toBe('string');
      expect((entry['company'] as string).length).toBeGreaterThan(0);
      expect(VERDICTS).toContain(entry['verdict']);
      expect(typeof entry['score']).toBe('number');
      expect(entry['score'] as number).toBeGreaterThanOrEqual(0);
      expect(entry['score'] as number).toBeLessThanOrEqual(100);
    }
  });

  test('(b) mapper on GO-shaped brief: why_now non-null string, draft untouched', () => {
    const brief: SweepBrief = goFixture();
    const ranked: RankedBrief = toRankedBrief(brief);
    // Contract keys present with GO values.
    expect(ranked.signal_url).toBe('https://testbank.com/news/payments-programme');
    expect(ranked.why_now).toBe('TestBank announces payments modernisation programme');
    expect(ranked.buyer_role).toBe('Payments Operations / Trade Finance Operations');
    // Draft path unaffected: draft + blocked-reason pass through.
    expect(ranked.draft).toEqual(brief.draft);
    expect(ranked.draft).not.toBeNull();
    expect(ranked.draftBlockedReason).toBeNull();
    // All existing fields untouched.
    expect(ranked.company).toBe(brief.company);
    expect(ranked.verdict).toBe('GO');
    expect(ranked.score).toBe(brief.score);
    // JSON round-trip still emits the keys (null never undefined).
    const roundTripped: Record<string, unknown> = JSON.parse(JSON.stringify(ranked)) as Record<
      string,
      unknown
    >;
    expect(Object.prototype.hasOwnProperty.call(roundTripped, 'signal_url')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(roundTripped, 'why_now')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(roundTripped, 'buyer_role')).toBe(true);
  });

  test('(c) mapper on HOLD-shaped brief: nulls with keys present', () => {
    const brief: SweepBrief = holdFixture();
    const ranked: RankedBrief = toRankedBrief(brief);
    expect(ranked.signal_url).toBeNull();
    expect(ranked.why_now).toBeNull();
    expect(ranked.buyer_role).toBe('Payments Operations / Trade Finance Operations');
    expect(ranked.draft).toBeNull();
    expect(ranked.draftBlockedReason).not.toBeNull();
    const roundTripped: Record<string, unknown> = JSON.parse(JSON.stringify(ranked)) as Record<
      string,
      unknown
    >;
    expect(Object.prototype.hasOwnProperty.call(roundTripped, 'signal_url')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(roundTripped, 'why_now')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(roundTripped, 'buyer_role')).toBe(true);
  });
});
