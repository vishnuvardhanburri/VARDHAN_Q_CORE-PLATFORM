const fs = require('fs');
const path = require('path');

// Simple implementation of the BankOpportunityEngine logic in JS
class BankOpportunityEngine {
  static async qualify(institution, problem, source, evidence, jurisdiction) {
    let evidenceStrength = 0;
    if (source.url && source.title) evidenceStrength = 1;
    if (evidence.length > 100 && evidence.includes('quantum')) evidenceStrength = 2;
    if (evidence.includes('migration') || evidence.includes('cryptographic')) evidenceStrength = 3;

    let urgency = 0;
    const urgentKeywords = ['deadline', 'regulatory', 'mandatory', 'risk', 'urgent', 'transition'];
    if (urgentKeywords.some(k => evidence.toLowerCase().includes(k))) urgency = 3;
    else if (evidence.toLowerCase().includes('planning')) urgency = 1;

    let productFit = 0;
    let capability = 'Vardhan Intelligence';
    let valueProp = 'General quantum risk discovery';

    if (evidence.toLowerCase().includes('verification') || evidence.toLowerCase().includes('trust')) {
      productFit = 3;
      capability = 'Quantum Trust Fabric';
      valueProp = 'Cryptographically verifiable migration passports for bank trust';
    } else if (evidence.toLowerCase().includes('inventory') || evidence.toLowerCase().includes('crypto-agility')) {
      productFit = 2;
      capability = 'Q Core';
      valueProp = 'Automated cryptographic inventory and migration orchestration';
    } else if (evidence.toLowerCase().includes('assessment') || evidence.toLowerCase().includes('gap')) {
      productFit = 1;
      capability = 'Vardhan Intelligence';
      valueProp = 'Deep surface discovery of quantum-exposed assets';
    }

    let access = 0;
    if (evidence.toLowerCase().includes('partnership') || evidence.toLowerCase().includes('tender')) access = 3;
    else if (evidence.toLowerCase().includes('api') || evidence.toLowerCase().includes('portal')) access = 2;
    else access = 1;

    const totalScore = evidenceStrength + urgency + productFit + access;

    if (totalScore < 5) return { opportunity: null, score: null };

    return {
      opportunity: {
        institutionName: institution,
        jurisdiction: jurisdiction,
        problem: problem,
        source: source,
        evidenceExcerpt: evidence,
        isInstitutionSpecific: true,
        confidence: evidenceStrength >= 3 ? 'HIGH' : (evidenceStrength >= 2 ? 'MEDIUM' : 'LOW'),
        fitCapability: capability,
        valueProposition: valueProp,
        diagnosticScope: `A £15k diagnostic to map ${capability} fit against current ${problem} gap.`,
        procurementRoute: 'unknown',
        failureReason: 'High incumbent competition or internal sovereign capability',
        nextAction: 'Identify specific CISO or Quantum Program Lead via LinkedIn/Company Registry',
      },
      score: {
        evidenceStrength,
        urgency,
        productFit,
        accessPlausibility: access,
        totalScore
      }
    };
  }
}

async function runHunt() {
  console.log("🚀 Starting VARDHAN Intelligence: Live Bank Opportunity Discovery...");
  
  const targetHypotheses = [
    { bank: "Santander UK", jurisdiction: "UK", query: "Santander UK cryptographic inventory quantum risk", expectedProblem: "Disclosed cryptographic inventory gaps and PQC transition risk" },
    { bank: "Ally Financial", jurisdiction: "USA", query: "Ally Financial post-quantum readiness programme", expectedProblem: "Post-quantum readiness and implementation of PQC algorithms" },
    { bank: "Swiss Financial Institutions", jurisdiction: "Switzerland", query: "FINMA Swiss banks quantum cryptography survey", expectedProblem: "Industry-wide gap in cryptographic agility and PQC transition" },
    { bank: "Indian Banking Sector", jurisdiction: "India", query: "RBI India banking quantum transition planning", expectedProblem: "Regulatory pressure for quantum-safe financial infrastructure" },
    { bank: "HSBC", jurisdiction: "Global", query: "HSBC quantum safe cryptography migration", expectedProblem: "Global scale migration of legacy crypto to PQC" },
    { bank: "JPMorgan Chase", jurisdiction: "USA", query: "JPMorgan Chase quantum computing risk disclosure", expectedProblem: "High-value asset protection against harvest-now-decrypt-later" },
    { bank: "BNP Paribas", jurisdiction: "France", query: "BNP Paribas PQC transition roadmap", expectedProblem: "EU regulatory compliance for quantum-safe banking" },
    { bank: "Deutsche Bank", jurisdiction: "Germany", query: "Deutsche Bank quantum security strategy", expectedProblem: "Integration of PQC into existing enterprise trust fabric" },
    { bank: "Goldman Sachs", jurisdiction: "USA", query: "Goldman 사례 cryptographic agility PQC", expectedProblem: "Requirement for rapid algorithm rotation in high-frequency environments" },
    { bank: "Standard Chartered", jurisdiction: "UK/Global", query: "Standard Chartered quantum risk mitigation", expectedProblem: "Cross-border trust verification for quantum-safe assets" },
  ];

  const results = [];

  for (const hypo of targetHypotheses) {
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

  results.sort((a, b) => b.score.totalScore - a.score.totalScore);

  console.log("\n--- 🏆 RANKED BANK OPPORTUNITIES ---");
  results.forEach((res, javaIdx) => {
    console.log(`${javaIdx + 1}. ${res.opp.institutionName} (Score: ${res.score.totalScore})`);
    console.log(`   Capability: ${res.opp.fitCapability}`);
    console.log(`   Value Prop: ${res.opp.valueProposition}`);
    console.log(`   Next Action: ${res.opp.nextAction}\n`);
  });
}

runHunt();
