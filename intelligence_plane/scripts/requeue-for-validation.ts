import * as fs from 'fs';
import * as path from 'path';

const queuePath = path.join(process.cwd(), 'artifacts', 'intelligence', 'queue.jsonl');
const lines = fs.readFileSync(queuePath, 'utf8').split('\n').filter(l => l.trim());

const updatedLines = lines.map(line => {
  const company = JSON.parse(line);
  if (!company.company.toLowerCase().includes('testcorp') && company.state === 'RESEARCH_MORE') {
    // We only want to requeue 10
    return line;
  }
  return line;
});

// This isn't a great way to limit to 10. Let's just find the first 10 and change them.
const finalLines = [...lines];
let count = 0;
for (let i = 0; i < finalLines.length; i++) {
  const company = JSON.parse(finalLines[i]);
  if (!company.company.toLowerCase().includes('testcorp') && company.state === 'RESEARCH_MORE') {
    company.state = 'QUEUED';
    finalLines[i] = JSON.stringify(company);
    count++;
    if (count === 10) break;
  }
}

fs.writeFileSync(queuePath, finalLines.join('\n') + '\n');
console.log(`Requeued ${count} real companies to QUEUED state.`);
