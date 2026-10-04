/**
 * F-013: Supply chain security tests — verify SBOM, deny.toml, and audit.toml exist.
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, test, expect } from 'vitest';

describe('F-013: Supply Chain Security', () => {
  const repoRoot = path.resolve(__dirname, '../..');

  test('deny.toml exists at repository root', () => {
    const denyTomlPath = path.join(repoRoot, 'deny.toml');
    expect(fs.existsSync(denyTomlPath)).toBe(true);
  });

  test('bom.json (SBOM) exists at repository root', () => {
    const bomPath = path.join(repoRoot, 'bom.json');
    expect(fs.existsSync(bomPath)).toBe(true);
    if (fs.existsSync(bomPath)) {
      const bom = JSON.parse(fs.readFileSync(bomPath, 'utf-8'));
      expect(bom.bomFormat).toBe('CycloneDX');
      expect(bom.components).toBeDefined();
      expect(Array.isArray(bom.components)).toBe(true);
      expect(bom.components.length).toBeGreaterThan(0);
    }
  });

  test('.cargo/audit.toml exists with F-013 advisories documented', () => {
    const auditTomlPath = path.join(repoRoot, '.cargo', 'audit.toml');
    expect(fs.existsSync(auditTomlPath)).toBe(true);
    if (fs.existsSync(auditTomlPath)) {
      const content = fs.readFileSync(auditTomlPath, 'utf-8');
      expect(content).toContain('F-013');
      expect(content).toContain('RUSTSEC-2021-0127'); // serde_cbor
    }
  });

  test('security.yml CI workflow exists', () => {
    const workflowPath = path.join(repoRoot, '.github', 'workflows', 'security.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);
    if (fs.existsSync(workflowPath)) {
      const content = fs.readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('cargo audit');
      expect(content).toContain('cargo deny');
      expect(content).toContain('cargo sbom');
    }
  });
});
