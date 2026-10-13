import { IntelligenceEngine } from './src/server/IntelligenceEngine';

async function run() {
  const res = await IntelligenceEngine.run('Vercel', 'https://vercel.com/blog/agentic-infrastructure');
  console.log("DECISION:", res.prospect_decision);
  console.log("EVIDENCE LENGTH:", res.evidence[0]?.evidence_text.length);
  console.log("TEXT:", res.evidence[0]?.evidence_text);
}
run();
