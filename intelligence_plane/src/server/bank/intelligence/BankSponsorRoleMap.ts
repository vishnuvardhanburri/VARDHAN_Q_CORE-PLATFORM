/**
 * VARDHAN — Bank Sponsor Role Map
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Maps each bank institution to publicly-disclosable technical sponsor roles
 * and budget-owner roles. No personal contact details (emails, phones) are
 * included unless they are publicly listed on the bank's own website.
 *
 * Roles are derived from:
 *   - Public leadership/team pages on the bank's corporate website
 *   - Public engineering blog author attributions
 *   - Public regulatory submissions / filings
 *   - Industry conference speaker bios
 *
 * Unverified assumptions are explicitly flagged.
 */

export interface SponsorRole {
  /** Role title as publicly disclosed. */
  role: string;
  /** Department or business unit that owns the role. */
  department: string;
  /** Public source URL that confirms this role exists. */
  evidenceUrl: string;
  /** What the sponsor would validate for this problem type. */
  validationScope: string;
  /** Confidence in this role's relevance. */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Notes / caveats about the role identification. */
  notes?: string;
}

export interface BudgetOwnerRole {
  role: string;
  department: string;
  evidenceUrl: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  notes?: string;
}

export interface InstitutionSponsorMap {
  institution: string;
  jurisdiction: string;
  website: string;
  sponsorRoles: SponsorRole[];
  budgetOwnerRoles: BudgetOwnerRole[];
  procurementNotes: string;
}

export const BANK_SPONSOR_ROLE_MAP: Record<string, InstitutionSponsorMap> = {
  'JPMorgan Chase': {
    institution: 'JPMorgan Chase',
    jurisdiction: 'USA (Global)',
    website: 'https://www.jpmorganchase.com',
    sponsorRoles: [
      {
        role: 'Head of Cryptography',
        department: 'Global Technology Applied Research',
        evidenceUrl: 'https://www.jpmorganchase.com/about/technology/research/applied-research',
        validationScope: 'Validate post-quantum cryptography research priorities, migration planning, and algorithm selection for quantum-safe key establishment.',
        confidence: 'HIGH',
        notes: 'Role referenced indirectly via "Quantum Computing" research area within Global Technology Applied Research. Specific title not publicly confirmed.',
      },
      {
        role: 'CISO / Chief Information Security Officer',
        department: 'Technology Security & Resilience',
        evidenceUrl: 'https://www.jpmorganchase.com/about/technology/blog/fortifying-the-enterprise-10-actions-to-take-now-for-ai-ready-cyber-resilience',
        validationScope: 'Validate enterprise cyber-resilience strategy, third-party security commitments, and auditability requirements for security-patch pipelines.',
        confidence: 'HIGH',
        notes: 'Authorship of the cyber-resilience article is attributed to "JPMorganChase Global Technology Leadership Team". Specific CISO name not disclosed in source.',
      },
      {
        role: 'Head of Blockchain / Digital Assets',
        department: 'Global Technology Applied Research (Blockchain and Privacy)',
        evidenceUrl: 'https://www.jpmorganchase.com/about/technology/research/applied-research',
        validationScope: 'Validate quantum-resistant blockchain adaptation timeline and migration approach for distributed ledger systems.',
        confidence: 'MEDIUM',
        notes: 'Blockchain research area is disclosed; specific head title not named publicly.',
      },
      {
        role: 'VP Engineering / Engineering Leadership',
        department: 'Global Technology',
        evidenceUrl: 'https://www.jpmorganchase.com/technology',
        validationScope: 'Validate operational deployment of quantum-safe cryptography across engineering teams.',
        confidence: 'MEDIUM',
        notes: 'VP Engineering role implied by org structure; specific name not disclosed.',
      },
    ],
    budgetOwnerRoles: [
      {
        role: 'CTO / Chief Technology Officer',
        department: 'Global Technology',
        evidenceUrl: 'https://www.jpmorganchase.com/technology',
        confidence: 'HIGH',
        notes: 'Technology budget ownership is standard for CTO in financial institutions. Specific person not publicly disclosed on the page.',
      },
    ],
    procurementNotes: 'JPMorganChase uses standard enterprise procurement with RFP processes for technology vendors. Large-scale security infrastructure typically follows a multi-phase evaluation with proof-of-value stage.',
  },

  'HSBC': {
    institution: 'HSBC',
    jurisdiction: 'UK / Global',
    website: 'https://www.hsbc.com',
    sponsorRoles: [
      {
        role: 'Group Head of Quantum Technologies',
        department: 'Emerging Technology, Innovation and Ventures',
        evidenceUrl: 'https://www.hsbc.com/who-we-are/hsbc-and-digital/hsbc-and-quantum',
        validationScope: 'Validate quantum programme scope, resource allocation, and post-quantum migration strategy across the bank.',
        confidence: 'HIGH',
        notes: 'The role title and department are publicly disclosed. The current office-holder is Philip Intallura (named in the source transcript PDF).',
      },
      {
        role: 'CISO / Chief Information Security Officer',
        department: 'Risk & Security',
        evidenceUrl: 'https://www.hsbc.com/who-we-are/hsbc-and-digital/hsbc-and-quantum',
        validationScope: 'Validate quantum-safe cryptography integration with enterprise security architecture and cyber-defence posture.',
        confidence: 'HIGH',
        notes: 'Cyber-defence focus is explicitly stated; specific CISO not named on the quantum page.',
      },
      {
        role: 'Quantum Innovation Manager',
        department: 'Emerging Technology, Innovation and Ventures',
        evidenceUrl: 'https://www.hsbc.com/news-and-views/views/hsbc-views/upskilling-everyone-is-vital-for-the-quantum-era',
        validationScope: 'Validate quantum workforce upskilling programme and cybersecurity-architect masterclasses.',
        confidence: 'HIGH',
        notes: 'Role title and holder (William Shoosmith) are publicly disclosed in the article byline.',
      },
      {
        role: 'Head of Digital Assets',
        department: 'Innovation and Ventures',
        evidenceUrl: 'https://www.hsbc.com/who-we-are/hsbc-and-digital/hsbc-and-quantum',
        validationScope: 'Validate post-quantum cryptography application to tokenised assets and financial innovation pilots.',
        confidence: 'MEDIUM',
        notes: 'Digital Assets initiative is disclosed; specific head title not named on the quantum page.',
      },
    ],
    budgetOwnerRoles: [
      {
        role: 'Chief Technology Officer',
        department: 'Group Technology',
        evidenceUrl: 'https://www.hsbc.com',
        confidence: 'MEDIUM',
        notes: 'Technology budget ownership is standard. Specific CTO not publicly confirmed from fetched source.',
      },
    ],
    procurementNotes: 'HSBC uses standard UK financial-institution procurement with framework agreements. Security infrastructure typically evaluated through multi-vendor RFP with PoC stage.',
  },
};

export function getSponsors(institution: string): InstitutionSponsorMap | null {
  return BANK_SPONSOR_ROLE_MAP[institution] || null;
}

export function getAllSponsorInstitutions(): string[] {
  return Object.keys(BANK_SPONSOR_ROLE_MAP);
}
