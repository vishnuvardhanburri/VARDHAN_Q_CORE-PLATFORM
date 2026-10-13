import { LivePublicObservationProvider } from './src/server/LivePublicObservationProvider';

async function traceTransport(url: string) {
  console.log(`\n=== TRANSPORT TRACE FOR: ${url} ===`);
  
  const provider = new LivePublicObservationProvider();
  
  // 1. Raw Transport Trace
  console.log('\n[1] RAW TRANSPORT TRACE');
  const start = performance.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(8000),
    });
    const end = performance.now();
    const body = await response.text();
    
    console.log({
      url,
      method: 'GET',
      startTime: new Date().toISOString(),
      status: response.status,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
      bodyLength: body.length,
      duration: `${Math.round(end - start)}ms`,
      excerpt: body.substring(0, 500).replace(/\n/g, ' '),
    });
  } catch (err: any) {
    console.error(`Transport Error: ${err.message}`);
  }

  // 2. Observation Provider Trace
  console.log('\n[2] OBSERVATION PROVIDER TRACE');
  const result = await provider.observePublicSurface(url);
  console.log('Observation Provider Result:', JSON.stringify(result, null, 2));

  if (result.observations && result.observations.length > 0) {
    const evidence = result.observations[0];
    console.log('\n[3] EVIDENCE ANALYSIS');
    console.log({
      status: evidence.status,
      latency: evidence.latency_ms,
      latencySamples: evidence.latency_samples,
      reproductions: evidence.reproductions,
      repeatable: evidence.repeatable,
      behavior: evidence.observed_behavior,
      classification: evidence.provenance.classification,
    });
  } else {
    console.log('\n[3] EVIDENCE ANALYSIS: No evidence produced.');
  }
}

// Use SendGrid as diagnostic target
traceTransport('https://status.sendgrid.com/').catch(console.error);
