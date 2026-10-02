import { IntelligenceEngine } from '../src/server/IntelligenceEngine';
import * as fs from 'fs';
import * as path from 'path';

const targets = [
  { company: "Discord", url: "https://discord.com/blog/how-discord-indexes-trillions-of-messages" },
  { company: "Intercom", url: "https://www.intercom.com/blog/evolving-intercoms-database-infrastructure/" },
  { company: "Intercom", url: "https://www.intercom.com/blog/evolving-intercoms-database-infrastructure-lessons-and-progress/" },
  { company: "Supabase", url: "https://supabase.com/blog/categories/engineering" },
  { company: "Linear", url: "https://linear.app/now" },
  { company: "Linear", url: "https://linear.app/now/how-we-built-multi-region-support-for-linear" },
  { company: "Vercel", url: "https://vercel.com/blog/agentic-infrastructure" },
  { company: "Vercel", url: "https://vercel.com/blog/vercel-sandbox-is-now-generally-available" },
  { company: "OpenAI", url: "https://openai.com/index/scaling-postgresql/" },
  { company: "GitHub", url: "https://github.blog/engineering/architecture-optimization/" }
];

async function runBatch() {
  const results = [];
  
  for (const target of targets) {
    console.log(`Processing ${target.company} - ${target.url}`);
    try {
      const result = await IntelligenceEngine.run(target.company, target.url);
      results.push(result);
    } catch (e) {
      console.error(`Error processing ${target.company}:`, e);
      results.push({ company: target.company, error: String(e) });
    }
  }

  // Formatting output as Markdown
  let markdown = "# Vardhan Intelligence Batch Run (10 Cases)\n\n";
  
  results.forEach((r, i) => {
    if (r.error) {
      markdown += `## ${i + 1}. ${r.company} (ERROR)\n**Error:** ${r.error}\n\n---\n\n`;
      return;
    }
    
    markdown += `## ${i + 1}. ${r.company}\n`;
    markdown += `**Source URL:** ${targets[i].url}\n\n`;
    
    markdown += `### Evidence Extracted\n`;
    if (r.evidence && r.evidence.length > 0) {
      r.evidence.forEach(e => {
         markdown += `- **Confidence:** ${e.confidence}\n`;
         markdown += `- **Context:** ${e.context}\n`;
         markdown += `- **Raw Excerpt:** "${e.evidence_text}"\n`;
      });
    } else {
      markdown += `*No valid technical evidence extracted.*\n`;
    }
    markdown += `\n`;

    markdown += `### Intelligence Case\n`;
    markdown += `- **Hypotheses:** ${r.hypotheses ? r.hypotheses.join(' | ') : 'None'}\n`;
    markdown += `- **Contradictions:** ${r.contradictions ? r.contradictions.join(' | ') : 'None'}\n`;
    markdown += `- **Decision Gate:** **${r.prospect_decision}**\n`;
    markdown += `- **Angle:** ${r.conversation_angle || 'None'}\n`;
    markdown += `- **QA Status:** ${r.claim_validation || 'N/A'}\n\n`;

    markdown += `### Generated Email (If GO)\n`;
    if (r.prospect_decision === 'GO') {
      markdown += `**Subject:** ${r.subject}\n\n`;
      markdown += `**Body:**\n> ${r.body}\n`;
    } else {
      markdown += `*Email blocked by Gate constraints.*\n`;
    }
    markdown += `\n---\n\n`;
  });

  const outPath = path.join(process.cwd(), 'batch_results.md');
  fs.writeFileSync(outPath, markdown);
  console.log(`\nBatch complete. Output written to ${outPath}`);
}

runBatch();
