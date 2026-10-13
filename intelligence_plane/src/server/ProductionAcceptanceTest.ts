import { IntelligenceCase } from './IntelligenceCase';
import { AutonomousLoopManager } from './AutonomousLoopManager';
import { DomainResolver } from './DomainResolver';
import { IcpQualificationEngine } from './IcpQualificationEngine';
import { PersonDiscoveryEngine } from './PersonDiscoveryEngine';
import { DeepOwnerResolver } from './DeepOwnerResolver';
import { ContactabilityFinder } from './ContactabilityFinder';
import { BehavioralXRayAnalyzer } from './BehavioralXRayAnalyzer';
import { DependencyGraphReconstructor } from './DependencyGraphReconstructor';
import { ThesisEngine } from './ThesisEngine';

export interface ProductionTestCompany {
  name: string;
  domain?: string;
  country?: string;
}

export class ProductionAcceptanceTest {
  private loopManager: AutonomousLoopManager;
  private domainResolver: DomainResolver;
  private icpEngine: IcpQualificationEngine;

  constructor() {
    this.loopManager = new AutonomousLoopManager();
    this.domainResolver = new DomainResolver();
    this.icpEngine = new IcpQualificationEngine();
  }

  public async runFullAcceptanceTest(dataset: ProductionTestCompany[]) {
    console.log(`\n\n================================================================================`);
    console.log(`VARDHAN PRODUCTION INTELLIGENCE ACCEPTANCE TEST`);
    console.log(`================================================================================`);

    // PHASE 1: AUTONOMOUS SELECTION
    console.log(`\n[PHASE 1] Autonomous Company Selection...`);
    const deduplicated = this.deduplicate(dataset);
    const resolved = await this.resolveIdentities(deduplicated);
    const qualified = this.applyIcp(resolved);

    console.log(`\n--- SELECTION FUNNEL ---`);
    console.log(`DATASET_TOTAL: ${dataset.length}`);
    console.log(`DEDUPLICATED: ${deduplicated.length}`);
    console.log(`DOMAIN_RESOLVED: ${resolved.length}`);
    console.log(`ICP_QUALIFIED: ${qualified.length}`);

    const researchQueue = qualified.slice(0, 5); // Bounded batch for test
    console.log(`RESEARCH_QUEUE: ${researchQueue.length}`);

    const results: any[] = [];

    for (const comp of researchQueue) {
      console.log(`\n\n>>> PROCESSING: ${comp.name} (${comp.domain})`);

      const initialCase: IntelligenceCase = {
        company: comp.name,
        fit_status: 'FIT',
        evidence: [],
        resolved_evidence: [],
        discovery_errors: 0,
        contradictions: [],
        prospect_decision: 'RESEARCH_MORE',
        subject: '',
        body: '',
        claim_validation: '',
        audit_trail: [],
        mode: 'PRODUCTION',
        company_surface: {
          company: comp.name,
          origin: comp.domain || '',
          homepage: comp.domain ? `https://${comp.domain}` : '',
          discovered_pages: [],
          page_categories: {},
        },
        signals: [],
        correlated_groups: [],
      };

      // PHASE 2-11: THE CORE INTELLIGENCE LOOP
      // This executes: Live Intelligence -> Evidence -> Signals -> Correlation -> X-Ray -> Thesis -> Window
      const finalCase = await this.loopManager.executeLoop(initialCase, 5);

      // PHASE 12-13: OWNER & CONTACT
      console.log(`\n[PHASE 12-13] Owner & Contact Discovery...`);
      const owner = await this.resolveOwner(finalCase);
      const contact = await this.resolveContact(finalCase, owner);

      // PHASE 14: CLAIM QA
      console.log(`\n[PHASE 14] Claim QA...`);
      const qaResult = this.performClaimQA(finalCase);

      // PHASE 15: FINAL DECISION
      const decision = this.finalizeDecision(finalCase, qaResult);

      results.push({
        company: comp.name,
        domain: comp.domain,
        finalCase,
        owner,
        contact,
        qaResult,
        decision
      });
    }

    this.printRuntimeReport(results);
  }

  private deduplicate(dataset: ProductionTestCompany[]): ProductionTestCompany[] {
    const seen = new Set();
    return dataset.filter(c => {
      const key = c.name.toLowerCase();
      return seen.has(key) ? false : seen.add(key);
    });
  }

  private async resolveIdentities(dataset: ProductionTestCompany[]): Promise<ProductionTestCompany[]> {
    const resolved: ProductionTestCompany[] = [];
    for (const comp of dataset) {
      const domain = comp.domain || await this.domainResolver.resolveDomain(comp.name);
      if (domain) resolved.push({ ...comp, domain });
    }
    return resolved;
  }

  private applyIcp(dataset: ProductionTestCompany[]): ProductionTestCompany[] {
    // Simplified ICP for test: Must have domain and not be a generic 'test' company
    return dataset.filter(c => c.domain && !c.name.toLowerCase().includes('test'));
  }

  private async resolveOwner(currentCase: IntelligenceCase) {
    const candidates = await PersonDiscoveryEngine.discover({
      company: currentCase.company,
      domain: currentCase.company_surface?.origin || '',
      technicalArea: currentCase.pressure_classification || 'INFRASTRUCTURE',
      providerCompanies: [],
      pages: currentCase.company_surface?.discovered_pages || [],
      htmlByUrl: new Map(),
    });
    return DeepOwnerResolver.resolve(candidates, currentCase.pressure_classification || 'INFRASTRUCTURE', currentCase.finding_classification || null, currentCase.evidence);
  }

  private async resolveContact(currentCase: IntelligenceCase, owner: any) {
    if (!owner) return 'NOT_FOUND';
    const contacts = ContactabilityFinder.find(currentCase.company_surface?.discovered_pages || [], new Map(), () => {}, null);
    return contacts.length > 0 ? 'FOUND' : 'NOT_FOUND';
  }

  private performClaimQA(currentCase: IntelligenceCase) {
    const claims = currentCase.evidence.map(e => ({ text: e.evidence_text, id: e.id }));
    const audited = claims.map(c => {
      const isValid = c.text.length > 20 && !c.text.includes('mock');
      return { claim: c.text, id: c.id, status: isValid ? 'PASS' : 'FAIL', reason: isValid ? '' : 'Insufficient depth or synthetic' };
    });
    return { audited, passRate: audited.filter(a => a.status === 'PASS').length / audited.length };
  }

  private finalizeDecision(currentCase: IntelligenceCase, qa: any): string {
    if (qa.passRate < 0.5) return 'INSUFFICIENT_EVIDENCE';
    if (currentCase.prospect_decision === 'GO' || currentCase.prospect_decision === 'OPPORTUNITY') return 'OUTREACH_READY';
    return 'REJECTED';
  }

  private printRuntimeReport(results: any[]) {
    console.log(`\n\n================================================================================`);
    console.log(`FINAL PRODUCTION RUNTIME REPORT`);
    console.log(`================================================================================`);

    results.forEach(r => {
      const evidence = r.finalCase.evidence || [];
      const strengthCounts: Record<string, number> = {
        MICRO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0
      };
      evidence.forEach((e: any) => {
        const s = e.strength || 'UNKNOWN';
        if (strengthCounts[s] !== undefined) strengthCounts[s]++;
      });

      console.log(`\nCOMPANY: ${r.company} | DOMAIN: ${r.domain}`);
      console.log(`- EVIDENCE_COUNT: ${evidence.length}`);
      console.log(`- DISTRIBUTION: MICRO:${strengthCounts.MICRO}, LOW:${strengthCounts.LOW}, MED:${strengthCounts.MEDIUM}, HIGH:${strengthCounts.HIGH}, CRIT:${strengthCounts.CRITICAL}`);
      console.log(`- SIGNALS: ${r.finalCase.signals?.length || 0}`);
      console.log(`- X_RAY: ${r.finalCase.prospect_decision !== 'RESEARCH_MORE' ? 'COMPLETED' : 'SKIPPED'}`);
      console.log(`- THESIS: ${r.finalCase.prospect_decision?.thesis || 'NONE'}`);
      console.log(`- OWNER: ${r.owner ? 'FOUND' : 'NOT_FOUND'}`);
      console.log(`- CONTACT: ${r.contact}`);
      console.log(`- CLAIM_QA: ${(r.qaResult.passRate * 100).toFixed(1)}%`);
      console.log(`- FINAL_DECISION: ${r.decision}`);
    });
  }
}
