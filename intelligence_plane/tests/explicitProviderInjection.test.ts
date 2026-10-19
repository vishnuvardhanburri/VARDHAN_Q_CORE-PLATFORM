/**
 * VARDHAN — EXPLICIT SEARCH-PROVIDER INJECTION GUARD (MISSION I §3, permanent).
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression: an implicit live search provider once let offline tests reach
 * the external service. Rule: every construction of CompanyResearchPipeline
 * outside live entry scripts MUST pass an explicit provider + fetcher.
 *
 * Guard strategy (static, zero network — runs under vitest):
 *   1. The pipeline constructor REQUIRES (searchProvider, fetcher) — check the
 *      source text for a no-arg/default-provider construction pattern. Any
 *      `new CompanyResearchPipeline()` with zero args, or a default import of
 *      KeylessSearchProvider inside CompanyResearchPipeline.ts, fails.
 *   2. KeylessSearchProvider (the only live-network provider) must be
 *      imported ONLY by live entry points (scripts/live-*.ts, smoke, gate
 *      helpers that inject fakes) — never by the pipeline module itself or by
 *      unit tests other than its own keylessSearch.test.ts (which injects
 *      fake/throwing fetchers).
 *   3. Sweep entry scripts are allow-listed as the only production files that
 *      may `new KeylessSearchProvider(`.
 *
 * Run under vitest (picked up by `npm test` automatically).
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from 'vitest';

const HERE: string = path.dirname(fileURLToPath(import.meta.url));
const IP_ROOT: string = path.resolve(HERE, '..');
const SRC = (p: string): string => fs.readFileSync(path.join(IP_ROOT, p), 'utf8');

const PIPELINE = 'src/server/company/CompanyResearchPipeline.ts';
const LIVE_ENTRY_ALLOWLIST: readonly string[] = [
  'scripts/live-opportunity-sweep.ts',
  'scripts/live-company-research.ts',
  'scripts/keyless-search-smoke.ts',
  // Self-construction inside the provider module itself (buildKeylessChain):
  // the factory default is reachable only when a caller passes no fetcher,
  // which the guard below forbids outside the live entries/tests noted.
  'src/server/providers/KeylessSearchProvider.ts',
];
// Unit tests that may construct KeylessSearchProvider ONLY with an injected
// fake/throwing fetcher (never live network): keylessSearch.test.ts injects
// a stub fetcher + politenessMs: 0 in every construction.
const FAKE_FETCHER_TEST_ALLOWLIST: readonly string[] = ['tests/keylessSearch.test.ts'];

function ripgrepFiles(pattern: RegExp, dir: string, exts: readonly string[]): string[] {
  const hits: string[] = [];
  const walk = (d: string): void => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue;
        walk(full);
      } else if (exts.some((e: string): boolean => full.endsWith(e))) {
        const text = fs.readFileSync(full, 'utf8');
        if (pattern.test(text)) hits.push(path.relative(IP_ROOT, full));
      }
    }
  };
  walk(dir);
  return hits;
}

describe('explicit search-provider injection guard (Mission I §3)', () => {
  test('pipeline module never imports the live KeylessSearchProvider', () => {
    const text = SRC(PIPELINE);
    expect(text.includes('KeylessSearchProvider')).toBe(false);
  });

  test('pipeline constructor requires explicit (searchProvider, fetcher)', () => {
    const text = SRC(PIPELINE);
    // Zero-arg construction must not exist anywhere in src.
    const zeroArg = ripgrepFiles(/new\s+CompanyResearchPipeline\s*\(\s*\)/, path.join(IP_ROOT, 'src'), ['.ts']);
    expect(zeroArg).toEqual([]);
    // Constructor signature must declare both parameters.
    expect(/constructor\s*\([^)]*searchProvider[^)]*fetcher[^)]*\)/.test(text)).toBe(true);
  });

  test('KeylessSearchProvider is constructed only in live entry scripts', () => {
    const hits = ripgrepFiles(
      /new\s+KeylessSearchProvider\s*\(/,
      IP_ROOT,
      ['.ts'],
    ).filter((f: string): boolean => !f.startsWith('tests/'));
    for (const h of hits) {
      expect(LIVE_ENTRY_ALLOWLIST).toContain(h);
    }
    expect(hits.length).toBeGreaterThan(0);
  });

  test('unit tests constructing the pipeline inject explicit fakes (never live network)', () => {
    const hits = ripgrepFiles(/new\s+CompanyResearchPipeline\s*\(/, path.join(IP_ROOT, 'tests'), ['.ts']);
    expect(hits.length).toBeGreaterThan(0);
    for (const file of hits) {
      if (file === 'tests/explicitProviderInjection.test.ts') continue;
      const text = SRC(file);
      // Every construction must pass TWO args (provider + fetcher): grab a
      // window after each construction site and require a comma (two-arg
      // call) — zero-arg or single-arg construction fails the guard.
      const sites = [...text.matchAll(/new\s+CompanyResearchPipeline\s*\(/g)];
      expect(sites.length).toBeGreaterThan(0);
      for (const site of sites) {
        const start = (site.index ?? 0) + site[0].length;
        // Find the call's closing paren at depth 1 (args may nest parens).
        let depth = 1;
        let i = start;
        while (i < text.length && depth > 0) {
          if (text[i] === '(') depth += 1;
          else if (text[i] === ')') depth -= 1;
          i += 1;
        }
        const args = text.slice(start, i - 1);
        // Two args at top level = a comma at depth 0.
        let argDepth = 0;
        let hasTopComma = false;
        for (const ch of args) {
          if (ch === '(' || ch === '[' || ch === '{') argDepth += 1;
          else if (ch === ')' || ch === ']' || ch === '}') argDepth -= 1;
          else if (ch === ',' && argDepth === 0) {
            hasTopComma = true;
            break;
          }
        }
        expect(hasTopComma).toBe(true);
      }
      // No live-network provider may be constructed OR imported here —
      // keylessSearch.test.ts (fake-fetcher only) is the sole exception.
      if (!(FAKE_FETCHER_TEST_ALLOWLIST as readonly string[]).includes(file)) {
        expect(/new\s+KeylessSearchProvider\s*\(/.test(text)).toBe(false);
        expect(text.includes("from '../src/server/providers/KeylessSearchProvider")).toBe(false);
      }
    }
  });
});
