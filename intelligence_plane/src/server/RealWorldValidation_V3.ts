import { AutonomousLoopManager } from './AutonomousLoopManager';
import { IntelligenceCase } from './IntelligenceCase';
import { ClaimAndMetricValidator } from './targetQualificationEngine';
import { LivePublicObservationProvider } from './LivePublicObservationProvider';
import { PersonDiscoveryEngine } from './PersonDiscoveryEngine';
import { DeepOwnerResolver } from './DeepOwnerResolver';
import { ContactabilityFinder } from './ContactabilityFinder';

async function runFullValidation() {
  const companies = [
    { name: 'Cloudflare', domain: 'cloudflare.com', homepage: 'https://www.cloudflare.com' },
    { name: 'Graphite', domain: 'graphite.dev', homepage: 'https://graphite.dev' },
    { name: 'Snyk', domain: 'snyk.io', homepage: 'https://snyk.io' },
  ];

  for (const comp of companies) {
    console.log(`\n\n\n================================================================================`);
    console.log(`VARDHAN LAST-MILE VALIDATION: ${comp.name}`);
    console.log(`================================================================================`);

    const loopManager = new AutonomousLoopManager(comp.name);
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
        origin: comp.domain,
        homepage: comp.homepage,
        discovered_pages: [],
        page_categories: {},
      },
      signals: [],
      correlated_groups: [],
    };

    console.log(`\n[1] EXECUTING ADAPTIVE LOOP...`);
    const finalCase = await loopManager.executeLoop(initialCase, (msg) => {
      console.log(msg);
    });

    console.log(`\n[2] FINALIZING LAST-MILE STAGES...`);

    // --- LIVE VERIFICATION ---
    console.log(`\n--- LIVE VERIFICATION ---`);
    if (finalCase.pressure_classification && finalCase.pressure_classification !== 'UNKNOWN') {
      console.log(`Pressure detected: ${finalCase.pressure_classification}. Triggering verification...`);
      const targetUrl = finalCase.evidence[0]?.public_url || finalCase.company_surface?.homepage;
      if (targetUrl) {
        const observer = new LivePublicObservationProvider();
        const obs = await observer.observePublicSurface(targetUrl);
        console.log(`Result: ${obs.evidence.length > 0 ? 'VERIFIED' : 'VERIFICATION_FAILED'}`);
        console.log(`Evidence IDs: ${obs.evidence.map(e => e.id).join(', ')}`);
      }
    } else {
      console.log(`Result: VERIFICATION_NOT_JUSTIFIED (No strong pressure classification)`);
    }

    // --- OWNER RESOLUTION ---
    console.log(`\n--- OWNER RESOLUTION ---`);
    if (finalCase.pressure_classification && finalCase.pressure_classification !== 'UNKNOWN') {
      const candidates = await PersonDiscoveryEngine.discover({
        company: finalCase.company,
        domain: finalCase.company_surface?.origin || '',
        technicalArea: finalCase.pressure_classification,
        providerCompanies: [],
        pages: finalCase.company_surface?.discovered_pages || [],
        htmlByUrl: new Map(),
      });

      const owner = DeepOwnerResolver.resolve(
        candidates,
        finalCase.pressure_classification,
        finalCase.finding_classification || null,
        finalCase.evidence,
      );

      if (owner) {
        console.log(`Result: OWNER_VERIFIED`);
        console.log(`Name: ${owner.name}, Role: ${owner.role}, Confidence: ${owner.confidence}`);
      } else {
        console.log(`Result: OWNER_UNAVAILABLE`);
      }
    } else {
      console.log(`Result: OWNER_NOT_JUSTIFIED`);
    }

    // --- CONTACT DISCOVERY ---
    console.log(`\n--- CONTACT DISCOVERY ---`);
    if (finalCase.technical_owner) {
      const contacts = ContactabilityFinder.find(
        finalCase.company_surface?.discovered_pages || [],
        new Map(),
        () => {},
        null
      );
      if (contacts.length > 0) {
        console.log(`Result: CONTACT_VERIFIED`);
        console.log(`Found ${contacts.length} channels.`);
      } else {
        console.log(`Result: CONTACT_UNAVAILABLE`);
      }
    } else {
      console.log(`Result: CONTACT_NOT_JUSTIFIED`);
    }

    // --- CLAIM QA ---
    console.log(`\n--- CLAIM QA ---`);
    const claims = finalCase.evidence.map(e => e.evidence_text);
    if (claims.length > 0) {
      claims.forEach((claim, i) => {
        const res = ClaimAndMetricValidator.validate(claim);
        console.log(`Claim [${i}]: ${claim.substring(0, 50)}... -> ${res.isValid ? 'PASS' : 'FAIL'}`);
      });
    } else {
      console.log(`Result: NO_CLAIMS_TO_VALIDATE`);
    }

    console.log(`\n--- FINAL STATE ---`);
    console.log(`Company: ${finalCase.company}`);
    console.log(`Decision: ${finalCase.prospect_decision}`);
    console.log(`Pressure: ${finalCase.pressure_classification}`);
    console.log(`Signals: ${finalCase.signals.length}`);
    console.log(`Correlations: ${finalCase.correlated_groups.length}`);
    console.log(`Owner: ${finalCase.technical_owner?.name || 'None'}`);
    console.log(`Final Decision Basis: ${finalCase.audit_trail.length > 0 ? finalCase.audit_trail[finalCase.audit_trail.length-1] : 'No audit trail'}`);
  }
}

runFullValidation().catch(console.error);
