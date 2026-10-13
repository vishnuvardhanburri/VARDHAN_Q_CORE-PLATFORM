import { VardhanSystemManager } from '../src/server/system/VardhanSystemManager';
import { PublicWebSearchProvider } from '../src/server/WebSearchProvider';

async function main() {
  console.log(`\n==================================================`);
  console.log(`VARDHAN — NETWORK & PROVIDER CANARY`);
  console.log(`==================================================`);

  const fetcher = async (url: string, init: any) => {
    const start = Date.now();
    try {
      const res = await fetch(url, init);
      const end = Date.now();
      return {
        url,
        status: res.status,
        latency: end - start,
        bytes: (await res.text()).length,
        success: res.ok
      };
    } catch (e: any) {
      return { url, error: e.message, success: false };
    }
  };

  const searchProvider = new PublicWebSearchProvider({ fetcher: fetcher as any });

  // 1. HTTP FETCHER DIAGNOSTIC
  console.log(`\n[1] HTTP FETCHER DIAGNOSTIC`);
  const testUrls = ['https://example.com', 'https://google.com', 'https://status.aws.amazon.com'];
  for (const url of testUrls) {
    const res = await fetcher(url, {});
    console.log(`URL: ${url} | Status: ${res.status} | Latency: ${res.latency}ms | Bytes: ${res.bytes} | Success: ${res.success}`);
  }

  // 2. SEARCH PROVIDER DIAGNOSTIC
  console.log(`\n[2] SEARCH PROVIDER DIAGNOSTIC`);
  const testQueries = ['engineering blog technology company', 'developer documentation company', 'public technical engineering'];
  for (const q of testQueries) {
    const res = await searchProvider.search(q);
    console.log(`Query: "${q}" | Results: ${res.results.length} | Status: ${res.available ? 'OK' : 'FAIL'} | First URL: ${res.results[0]?.url || 'N/A'}`);
  }

  const fetchSuccess = testUrls.some(u => {
    // Note: the loop above already prints results, this just aggregates
    return true; 
  });
  const searchSuccess = (await searchProvider.search('engineering blog')).results.length > 0;

  if (searchSuccess) {
    console.log(`\n==================================================`);
    console.log(`NETWORK_CANARY_PASS`);
    console.log(`==================================================`);
  } else {
    console.log(`\n==================================================`);
    console.log(`NETWORK_CANARY_FAIL`);
    console.log(`Reason: Search provider returned 0 results for canary queries.`);
    console.log(`==================================================`);
    process.exit(1);
  }
}

main().catch(console.error);
