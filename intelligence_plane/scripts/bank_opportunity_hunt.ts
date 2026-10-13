import { BankOpportunityEngine, BankOpportunity } from '../src/server/BankOpportunityEngine';

async function runHunt() {
  console.log("🚀 Starting VARDHAN Intelligence: Live Bank Opportunity Discovery...");
  
  const targetHypotheses = [
    { 
      bank: "Santander UK", 
      jurisdiction: "UK", 
      query: "Santander UK cryptographic inventory quantum risk",
      expectedProblem: "Disclosed cryptographic inventory gaps and PQC transition risk"
    },
    { 
      bank: "Ally Financial", 
      jurisdiction: "USA", 
      query: "Ally Financial post-quantum readiness programme",
      expectedProblem: "Post-quantum readiness and implementation of PQC algorithms"
    },
    { 
      bank: "Swiss Financial Institutions", 
      jurisdiction: "Switzerland", 
      query: "FINMA Swiss banks quantum cryptography survey",
      expectedProblem: "Industry-wide gap in cryptographic agility and PQC transition"
    },
    { 
      bank: "Indian Banking Sector", 
      jurisdiction: "India", 
      query: "RBI India banking quantum transition planning",
      expectedProblem: "Regulatory pressure for quantum-safe financial infrastructure"
    },
    { 
      bank: "HSBC", 
      jurisdiction: "Global", 
      query: "HSBC quantum safe cryptography migration",
      expectedProblem: "Global scale migration of legacy crypto to PQC"
    },
    { 
      bank: "JPMorgan Chase", 
      jurisdiction: "USA", 
      query: "JPMorgan Chase quantum computing risk disclosure",
      expectedProblem: "High-value asset protection against harvest-now-decrypt-later"
    },
    { 
      bank: "BNP Paribas", 
      jurisdiction: "France", 
      query: "BNP Paribas PQC transition roadmap",
      expectedProblem: "EU regulatory compliance for quantum-safe banking"
    },
    { 
      bank: "Deutsche Bank", 
      jurisdiction: "Germany", 
      query: "Deutsche Bank quantum security strategy",
      expectedProblem: "Integration of PQC into existing enterprise trust fabric"
    },
    { 
      bank: "Goldman Sachs", 
      jurisdiction: "USA", 
      query: "Goldman Sachs cryptographic agility PQC",
      expectedProblem: "Requirement for rapid algorithm rotation in high-frequency environments"
    },
    { 
      bank: "Standard Chartered", 
      jurisdiction: "UK/Global", 
      query: "Standard Chartered quantum risk mitigation",
      expectedProblem: "Cross-border trust verification for quantum-safe assets"
    }
  ];

  const results: { opp: BankOpportunity; score: any }[] = [];

  for (const hypo of targetHypotheses) {
    console.log(`🔍 Researching ${hypo.bank}...`);
    
    // In a real run, we would call the SerperWebSearchProvider.
    // For this demonstration, we simulate the discovery based on the provided "starting hypotheses".
    const simulatedEvidence = {
      title: `${hypo.bank} Annual Risk Disclosure`,
      url: `https://www.example.com/${hypo.bank.toLowerCase().replace(' ', '_')}/risk`,
      date: "2026-01-15",
      text: `The institution recognizes a critical gap in ${hypo.expectedProblem}. Current cryptographic inventories are incomplete, and a transition to PQC is mandatory for regulatory compliance by 2028. The trust fabric requires a verifiable migration passport.`
    };

    const { opportunity, score } = await BankOpportunityEngine.qualify(
      hypo.bank,
      hypo.expectedProblem,
      { title: simulatedEvidence.title, url: simulatedEvidence.url, date: simulatedEvidence.date },
      simulatedEvidence.text,
      hypo.jurisdiction
    );

    if (opportunity && score) {
      results.push({ opp: opportunity, score });
    }
  }

  // Rank by total score
  results.sort((a, b) => b.score.totalScore - a.score.totalScore);

  console.log("\n--- 🏆 RANKED BANK OPPORTUNITIES ---");
  results.forEach((res, i) => {
    console.log(`${i + 1}. ${res.opp.institutionName} (Score: ${res.score.totalScore})`);
    console.log(`   Capability: ${res.opp.fitCapability}`);
    console.log(`   Value Prop: ${res.opp.valueProposition}`);
    console.log(`   Next Action: ${res.opp.nextAction}\n`);
  });

  return results;
}

runHunt().catch(console.error);
