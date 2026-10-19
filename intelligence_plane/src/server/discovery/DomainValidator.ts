export class DomainValidator {
  static validate(domain: string): { valid: boolean; reason?: string } {
    if (!domain) return { valid: false, reason: 'MISSING_DOMAIN' };
    
    const trimmed = domain.trim().toLowerCase();
    
    // Check for malformed patterns
    if (trimmed.startsWith('http')) return { valid: false, reason: 'URL_INSTEAD_OF_DOMAIN' };
    if (/^\d+$/.test(trimmed)) return { valid: false, reason: 'NUMERIC_DOMAIN' };
    if (!trimmed.includes('.')) return { valid: false, reason: 'NO_TLD' };
    if (trimmed.startsWith('.') || trimmed.endsWith('.')) return { valid: false, reason: 'MALFORMED_HOSTNAME' };
    
    return { valid: true };
  }

  static normalize(domain: string): string {
    return domain.trim().toLowerCase().replace(/^www\./, '');
  }
}
