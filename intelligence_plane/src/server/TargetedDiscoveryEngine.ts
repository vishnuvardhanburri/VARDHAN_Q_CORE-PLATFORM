/**
 * VARDHAN — TARGETED DISCOVERY ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the "Bypass Fallback Chain" for aggressive owner discovery.
 * Transition: Collect-then-Filter -> Plan-then-Hunt.
 */

import type { OwnerSearchPlan, PersonEvidence, EvidenceLedger } from './DeepTypes';
import { PeopleExtractor } from './PeopleExtractor';
import { LiveWebResearchProvider } from './LiveWebResearchProvider';

export class TargetedDiscoveryEngine {
  constructor(
    private researchProvider: LiveWebResearchProvider,
    private peopleExtractor: PeopleExtractor
  ) {}

  /**
   * Executes the phased hunt based on the search plan.
   */
  async hunt(plan: OwnerSearchPlan): Promise<EvidenceLedger> {
    const ledger: EvidenceLedger = { claims: [] };
    
    // Phase 1: Official Company Surfaces (Team/About)
    await this.executeOfficialPhase(plan, ledger);
    
    // Phase 2: Technical Surfaces (Blogs/Docs)
    await this.executeTechnicalPhase(plan, ledger);
    
    // Phase 3: OSS/GitHub Surfaces
    await this.executeOssPhase(plan, ledger);
    
    // Phase 4: Professional Provider Corroboration (Growjo/CSV)
    // This is typically handled by the Pipeline passing in existing leads,
    // but we can trigger specific targeted lookups here if needed.

    return ledger;
  }

  private async executeOfficialPhase(plan: OwnerSearchPlan, ledger: EvidenceLedger) {
    // Target "About", "Team", "People" pages
    const targetUrls = [
      `https://${plan.opportunity_id}.com/about`,
      `https://${plan.opportunity_id}.com/team`,
      `https://${plan.opportunity_id}.com/people`
    ];

    for (const url of targetUrls) {
      const page = await this.researchProvider.fetchPage(url);
      if (!page) continue;
      
      const people = this.peopleExtractor.extract(page.html);
      for (const person of people) {
        if (this.matchesPersona(person.role, plan.role_personas)) {
          ledger.claims.push(this.createEvidence(person, url, 'OFFICIAL_COMPANY_SOURCE'));
        }
      }
    }
  }

  private async executeTechnicalPhase(plan: OwnerSearchPlan, ledger: EvidenceLedger) {
    // Search for blogs/docs containing keywords and matching personas
    const queries = plan.technical_keywords.map(kw => 
      `site:${plan.opportunity_id}.com ${kw} "engineer" OR "lead" OR "head"`
    );

    for (const query of queries) {
      const results = await this.researchProvider.search(query);
      for (const res of results) {
        const page = await this.researchProvider.fetchPage(res.url);
        if (!page) continue;

        // Use the new targetedExtract to find people associated with keywords
        const people = this.peopleExtractor.targetedExtract(page.html, plan.technical_keywords);
        for (const person of people) {
          ledger.claims.push(this.createEvidence(person, res.url, 'TECHNICAL_SURFACE'));
        }
      }
    }
  }

  private async executeOssPhase(plan: OwnerSearchPlan, ledger: EvidenceLedger) {
    // Hunt on GitHub: Org -> Repos with keywords -> Top contributors
    const org = plan.opportunity_id; // Simplification: assuming ID is the org name
    const repos = await this.researchProvider.getGithubRepos(org, plan.technical_keywords);

    for (const repo of repos) {
      const contributors = await this.researchProvider.getRepoContributors(org, repo.repo);
      for (const contributor of contributors) {
        // Check profile for role match
        const profile = await this.researchProvider.fetchGithubProfile(contributor.login);
        if (profile && this.matchesPersona(profile.bio || '', plan.role_personas)) {
          ledger.claims.push(this.createEvidence({
            name: contributor.name || contributor.login,
            role: profile.bio || 'OSS Contributor',
            company: org
          }, profile.url, 'OSS_GITHUB'));
        }
      }
    }
  }

  private matchesPersona(role: string, personas: string[]): boolean {
    return personas.some(p => role.toLowerCase().includes(p.toLowerCase()));
  }

  private createEvidence(person: any, url: string, type: string): PersonEvidence {
    return {
      claim: `${person.name} is a ${person.role} at ${person.company}`,
      source_url: url,
      source_type: type,
      observed_at: new Date().toISOString(),
      freshness: 'FRESH',
      evidence_id: `ev_person_${Math.random().toString(36).slice(2, 9)}`,
      confidence: 0.8
    };
  }
}
