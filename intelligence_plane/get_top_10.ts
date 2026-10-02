import { ALL_COMPANIES_RESEARCH_DATA } from './src/data/allCompaniesResearch.ts';
import { TargetQualificationEngine } from './src/server/targetQualificationEngine.ts';

const ranked = ALL_COMPANIES_RESEARCH_DATA.map(company => {
  const q = TargetQualificationEngine.qualifyTarget(company);
  return {
    name: company.name,
    contact: company.cto && company.cto !== 'N/A' ? company.cto : (company.ceo && company.ceo !== 'N/A' ? company.ceo : company.vpEngineering),
    role: company.cto && company.cto !== 'N/A' ? 'CTO' : (company.ceo && company.ceo !== 'N/A' ? 'CEO' : 'VP Eng'),
    email: company.email,
    score: q.pilotRankScore,
    priority: q.priority,
    risk: q.signalEntry ? q.signalEntry.businessImplication : company.scalingRisks,
    funding: company.totalRaised
  };
});

ranked.sort((a, b) => b.score - a.score);

console.log(JSON.stringify(ranked.slice(0, 10), null, 2));
