/**
 * Keyless live-web search smoke test (read-only, no secrets).
 * Runs the keyless chain (real fetch) against 3 fixed queries and prints
 * providerName, result count, and top-3 (title | url | snippet-prefix).
 * Exit 0 if >=2/3 queries return >=1 result, else exit 1.
 */
import { buildKeylessChain } from '../src/server/providers/KeylessSearchProvider.ts';

const QUERIES: string[] = [
  'HSBC quantum computing IBM',
  'Swift customer security programme CSCF',
  'LGT private banking crypto SEBA',
];

function snippetPrefix(snippet: string, maxChars = 80): string {
  const normalized = snippet.replace(/\s+/g, ' ').trim();
  return normalized.length > maxChars ? normalized.slice(0, maxChars) : normalized;
}

async function main(): Promise<void> {
  const manager = buildKeylessChain();
  let queriesWithResults = 0;

  for (const query of QUERIES) {
    console.log(`\n=== QUERY: ${query} ===`);
    let providerName = 'None';
    let count = 0;
    try {
      const response = await manager.search(query, { maxResults: 8 });
      providerName = response.providerName;
      count = response.results.length;
      console.log(`provider: ${providerName} | results: ${count}`);
      if (response.error !== undefined) console.log(`error: ${response.error}`);
      if (response.failureReason !== undefined) console.log(`failureReason: ${response.failureReason}`);
      for (const result of response.results.slice(0, 3)) {
        console.log(`- ${result.title} | ${result.url} | ${snippetPrefix(result.snippet)}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.log(`provider: ${providerName} | results: ${count} | exception: ${message}`);
    }
    if (count >= 1) queriesWithResults += 1;
  }

  console.log(`\nSMOKE RESULT: ${queriesWithResults}/3 queries returned >=1 result`);
  process.exit(queriesWithResults >= 2 ? 0 : 1);
}

void main();
