/**
 * VARDHAN — CONTACTABILITY FINDER (additive)
 * ─────────────────────────────────────────────────────────────────────────────
 * Captures ONLY professional contact information from two provenance-trusted
 * channels:
 *
 *   1. Growjo licensed lead data — PROFESSIONAL_EMAIL / LINKEDIN / PHONE / PROFILE
 *      channels are extracted from the operator-supplied GrowjoCompany record
 *      via GrowjoProvider.extractContacts. Only fields explicitly present in
 *      the licensed record are captured.
 *   2. Public company surface — mailto: addresses, tel: links, public
 *      profile links (LinkedIn/Twitter/GitHub), and contact/press pages
 *      discovered on the company's own domain.
 *
 * Channel types produced:
 *   OWNER_VERIFIED_EMAIL   — email explicitly linked to a specific person
 *   COMPANY_BUSINESS_EMAIL — role account (sales@, oauth@, info@, …)
 *   PROFESSIONAL_EMAIL    — person-specific email not yet linked to a person
 *   PUBLIC_PROFESSIONAL_CONTACT — public profile link (LinkedIn/Twitter/GitHub)
 *   PHONE, CONTACT_PAGE, PRESS_CONTACT, PROFILE, PROFESSIONAL_PROFILE
 *
 * It NEVER guesses, constructs, or derives an email address. A contact value
 * must be explicitly published (mailto:/tel: on a page) or explicitly licensed
 * (Growjo). Role accounts (info@, sales@, …) are classified as
 * COMPANY_BUSINESS_EMAIL — never as a person's email.
 */

import type { DeepContact, ContactConfidence, GrowjoCompany, DeepOwner } from './DeepTypes';
import type { DiscoveredPage } from './IntelligenceCase';
import { GrowjoProvider } from './GrowjoProvider';

const PROFILE_HANDLE_RE = /href=["'](?:https?:)?\/\/(?:www\.)?(?:linkedin\.com\/in|twitter\.com|x\.com)\/([A-Za-z0-9._-]+)\/??[^"']*["']/i;
const MAIlTO_RE = /href=["']mailto:([^"']+)["']/i;
const TEL_RE = /^tel:(.+)/i;
const CONTACT_PAGE_RE = /\/(?:contact|press|media|contact-us)(?:[\/?#"'-]|$)/i;

/**
 * Role-account patterns — these are company/system mailboxes, NOT personal
 * emails. Including oauth@, no-reply@, webmaster@, etc.
 */
const ROLE_ACCOUNT_RE = /^(info|sales|support|hello|team|oauth|press|jobs|careers|legal|security|webmaster|admin|contact|accounts|noc|ops|devops|root|abuse|privacy|compliance|billing|events|community|resume|partners|bug.?bounty|noreply|no.?reply|notification|notifications|marketing|growth|outreach|success|account.?manager|hiring.?ops|infra|platform|engineering|api|dev|ci|build|monitor|status|it|office|hr|recruiting|talent|alumni|media|social|web.?app)@/;

/**
 * Heuristic: skip obviously non-personal / role account mailboxes.
 * Used to filter which emails get captured at all (role accounts are
 * reclassified, not dropped — they become COMPANY_BUSINESS_EMAIL).
 */
function isRoleAccount(email: string): boolean {
  const local = email.split('@')[0].toLowerCase();
  return ROLE_ACCOUNT_RE.test(email.toLowerCase());
}

function confidenceFor(type: DeepContact['type'], value: string): ContactConfidence {
  if (type === 'OWNER_VERIFIED_EMAIL') return 'HIGH';
  if (type === 'COMPANY_BUSINESS_EMAIL') return 'MEDIUM';
  if (type === 'PROFESSIONAL_EMAIL') return 'HIGH';
  if (type === 'PUBLIC_PROFESSIONAL_CONTACT' || type === 'PROFESSIONAL_PROFILE' || type === 'PROFILE') {
    return /@|linkedin\.com\/in\//i.test(value) ? 'HIGH' : 'MEDIUM';
  }
  if (type === 'LINKEDIN') return 'HIGH';
  if (type === 'PHONE') return 'HIGH';
  if (type === 'PRESS_CONTACT') return 'MEDIUM';
  return 'LOW';
}

/** Extract href="…" values from HTML. */
function extractHrefs(html: string): string[] {
  const out: string[] = [];
  const re = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/** Strip HTML tags and return plain text for proximity scanning. */
function textOf(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if a person's name plausibly matches an email local part.
 * e.g. "Ronan O'Dulaing" matches "ronan@..." or "ronan.odulaing@..." or "ro@..."
 * Uses first name and last initial matching, or full local-part substring.
 */
function nameMatchesEmail(name: string, email: string): boolean {
  const local = email.split('@')[0].toLowerCase().replace(/[._\-]+/g, '');
  const nameParts = name.toLowerCase().replace(/['']/g, '').split(/\s+/).filter(Boolean);
  if (nameParts.length === 0) return false;

  // Direct substring match (first name, or first.last concatenated)
  if (local.includes(nameParts[0])) return true;

  // First initial + last name (e.g. "jdoe" for "John Doe")
  if (local === nameParts[0][0] + (nameParts[1] || '').slice(0, 8)) return true;

  return false;
}

/**
 * Check if a mailto: link appears in proximity to a person's name on a
 * team/profile page. Looks for the person's name within a bounded text window
 * around the email address in the HTML.
 */
function emailNearPersonOnPage(html: string, personName: string, email: string): boolean {
  const pageText = textOf(html).toLowerCase();
  const nameLower = personName.toLowerCase().replace(/['']/g, '');
  const nameTokens = nameLower.split(/\s+/).filter(t => t.length > 1);
  if (nameTokens.length === 0) return false;

  const local = email.split('@')[0].toLowerCase();

  // Search for the local part in the page text
  if (!pageText.includes(local)) return false;

  // Find the position of the local part in the page text
  const idx = pageText.indexOf(local);
  if (idx < 0) return false;

  // Extract a window around the email (±200 chars) and check for person's name
  const window = pageText.slice(Math.max(0, idx - 200), idx + 200);
  return nameTokens.some(t => window.includes(t));
}

/**
 * Attempt to reclassify a PROFESSIONAL_EMAIL contact as OWNER_VERIFIED_EMAIL
 * by checking if there's explicit evidence connecting the email to the owner:
 *
 *   - The email local part matches the owner's name (e.g. ronan@ for Ronan)
 *   - The email appears near the owner's name on a page in the owner's sources
 *   - A Growjo licensed email that matches the owner's name
 *
 * Returns the owner's name if linkage is confirmed, null otherwise.
 */
export function linkOwnerEmail(
  contacts: DeepContact[],
  owner: DeepOwner | null,
  htmlByUrl: Map<string, string>
): string | null {
  if (!owner || !owner.name || contacts.length === 0) return null;

  const ownerName = owner.name;

  for (const c of contacts) {
    if (c.type !== 'PROFESSIONAL_EMAIL') continue;

    // Check 1: Email local part matches the owner's name
    if (nameMatchesEmail(ownerName, c.value)) {
      // Verify on the source page — the mailto should be near the owner's name
      const sourcePage = c.source_url;
      const html = htmlByUrl.get(sourcePage);
      if (html) {
        if (emailNearPersonOnPage(html, ownerName, c.value)) {
          return ownerName;
        }
      }
      // If no HTML to verify proximity but name matches and it's a Growjo
      // licensed email explicitly associated with a person, still link it
      if (c.note?.includes('Growjo licensed')) {
        return ownerName;
      }
      // No proximity verification possible — keep as PROFESSIONAL_EMAIL (not verified)
      continue;
    }

    // Check 2: Email appears near owner's name on the owner's source pages
    if (owner.source_urls && c.type === 'PROFESSIONAL_EMAIL') {
      for (const srcUrl of owner.source_urls) {
        const html = htmlByUrl.get(srcUrl);
        if (html) {
          if (emailNearPersonOnPage(html, ownerName, c.value)) {
            return ownerName;
          }
        }
      }
    }
  }

  return null;
}

export class ContactabilityFinder {
  static find(
    pages: DiscoveredPage[],
    htmlByUrl: Map<string, string>,
    onProgress?: (stage: string, message: string) => void,
    growjoData?: GrowjoCompany | null
  ): DeepContact[] {
    const contacts: DeepContact[] = [];
    const seen = new Set<string>();

    const add = (c: DeepContact) => {
      const key = `${c.type}:${c.value}`;
      if (seen.has(key)) return;
      seen.add(key);
      contacts.push(c);
    };

    // ── Growjo-licensed contact channels (never guessed — only licensed data) ──
    if (growjoData) {
      const growjoContact = GrowjoProvider.extractContacts(growjoData);
      const gSrc = resolveGrowjoSource(growjoData);
      for (const channel of growjoContact.channels) {
        if (channel.type === 'PROFESSIONAL_EMAIL') {
          if (looksProfessional(channel.value)) {
            if (isRoleAccount(channel.value)) {
              // Growjo licensed role account — classified as company/business email
              add({ type: 'COMPANY_BUSINESS_EMAIL', value: channel.value, source_url: gSrc, confidence: 'MEDIUM', note: `Growjo licensed role-account email (${channel.confidence_source}).` });
            } else {
              // Growjo licensed email for a specific person — owner linkage
              // is confirmed via linkOwnerEmail() which checks name matching.
              add({ type: 'PROFESSIONAL_EMAIL', value: channel.value, source_url: gSrc, confidence: 'HIGH', note: `Growjo licensed email (${channel.confidence_source}).` });
            }
          }
        } else {
          add({ type: channel.type, value: channel.value, source_url: gSrc, confidence: 'HIGH', note: `Growjo licensed contact (${channel.confidence_source}).` });
        }
      }
    }

    for (const page of pages) {
      const html = htmlByUrl.get(page.url);
      if (!html) continue;
      const hrefs = extractHrefs(html);

      for (const href of hrefs) {
        // Mailto links — they are not URLs and must NOT be skipped by the
        // URL normalisation step (which returns '' for the mailto scheme).
        const mailto = MAIlTO_RE.exec(`href="${href}"`);
        if (mailto && mailto[1]) {
          const addr = mailto[1].split('?')[0];
          if (looksProfessional(addr)) {
            if (isRoleAccount(addr)) {
              // Role accounts (oauth@, sales@, info@, …) are company/business
              // mailboxes, NOT the owner's personal email.
              add({ type: 'COMPANY_BUSINESS_EMAIL', value: addr, source_url: page.url, confidence: 'MEDIUM', note: 'Role-account mailto on company page.' });
            } else {
              // Person-specific email on a company page — not yet linked to
              // a specific owner (that requires proximity/name matching via
              // linkOwnerEmail).
              add({ type: 'PROFESSIONAL_EMAIL', value: addr, source_url: page.url, confidence: 'HIGH', note: 'Public mailto: link on company page.' });
            }
          }
          continue;
        }

        // tel: links — public phone numbers published on the company page.
        const telMatch = TEL_RE.exec(href);
        if (telMatch && telMatch[1]) {
          const phone = telMatch[1].trim();
          if (/\d/.test(phone)) {
            add({ type: 'PHONE', value: phone, source_url: page.url, confidence: confidenceFor('PHONE', phone), note: 'Public phone number link (tel:) on company page.' });
          }
          continue;
        }

        const abs = normalizeHref(href, page.url);
        if (!abs) continue;

        // Named public profile links (real handles, not share/buttons).
        const profile = PROFILE_HANDLE_RE.exec(`href="${href}"`);
        if (profile) {
          add({ type: 'PUBLIC_PROFESSIONAL_CONTACT', value: abs, source_url: page.url, confidence: confidenceFor('PUBLIC_PROFESSIONAL_CONTACT', abs), note: 'Public professional profile link.' });
          continue;
        }

        // Generic press / media contact page.
        if (CONTACT_PAGE_RE.test(href)) {
          add({ type: 'CONTACT_PAGE', value: abs, source_url: page.url, confidence: 'MEDIUM', note: 'Public contact/press page link.' });
          continue;
        }
      }
    }

    onProgress?.('contactability', `Captured ${contacts.length} public professional contact channel(s).`);
    return contacts;
  }

  /** A usable professional contact path exists. */
  static hasUsableChannel(contacts: DeepContact[]): boolean {
    return contacts.some(c =>
      c.type === 'PROFESSIONAL_EMAIL' ||
      c.type === 'OWNER_VERIFIED_EMAIL' ||
      c.type === 'COMPANY_BUSINESS_EMAIL' ||
      c.type === 'PUBLIC_PROFESSIONAL_CONTACT' ||
      c.type === 'PROFESSIONAL_PROFILE' ||
      c.type === 'PROFILE' ||
      c.type === 'LINKEDIN' ||
      c.type === 'PHONE'
    );
  }

  /**
   * Returns true if there is a contact explicitly linked to the owner
   * (OWNER_VERIFIED_EMAIL). This is the strict outreach gate — a company
   * business email or profile link does NOT satisfy verified contactability.
   */
  static hasOwnerVerifiedEmail(contacts: DeepContact[]): boolean {
    return contacts.some(c => c.type === 'OWNER_VERIFIED_EMAIL');
  }

  /**
   * Returns true if ANY professional email is available (owner-verified or
   * company business), even if not linked to the specific owner.
   */
  static hasAnyProfessionalEmail(contacts: DeepContact[]): boolean {
    return contacts.some(c =>
      c.type === 'OWNER_VERIFIED_EMAIL' ||
      c.type === 'PROFESSIONAL_EMAIL' ||
      c.type === 'COMPANY_BUSINESS_EMAIL'
    );
  }

  /**
   * Classify contacts and attempt to link emails to the selected owner.
   * Re-classifies PROFESSIONAL_EMAIL → OWNER_VERIFIED_EMAIL when explicit
   * evidence connects the email to the owner.
   */
  static classifyAndLink(
    contacts: DeepContact[],
    owner: DeepOwner | null,
    htmlByUrl: Map<string, string>
  ): DeepContact[] {
    const linkedName = linkOwnerEmail(contacts, owner, htmlByUrl);

    if (!linkedName) return contacts;

    return contacts.map(c => {
      if (c.type === 'PROFESSIONAL_EMAIL' && nameMatchesEmail(linkedName, c.value)) {
        // Verify proximity on the source page
        const html = htmlByUrl.get(c.source_url);
        if (html && emailNearPersonOnPage(html, linkedName, c.value)) {
          return { ...c, type: 'OWNER_VERIFIED_EMAIL', owner_name: linkedName, note: `Email matches owner "${linkedName}" and appears near their name on ${c.source_url}.` };
        }
        // Growjo licensed email with name match
        if (c.note?.includes('Growjo licensed')) {
          return { ...c, type: 'OWNER_VERIFIED_EMAIL', owner_name: linkedName, note: `Email matches owner "${linkedName}" from Growjo licensed data.` };
        }
      }
      return c;
    });
  }
}

function normalizeHref(href: string, baseUrl: string): string {
  try {
    if (href.startsWith('mailto:')) return '';
    return new URL(href, baseUrl).href;
  } catch {
    return '';
  }
}

function looksProfessional(email: string): boolean {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email);
}

/** Resolve the attributable public source URL for a Growjo lead record. */
function resolveGrowjoSource(company: GrowjoCompany): string {
  return company.source_url || company.growjo_url || company.website || '';
}
