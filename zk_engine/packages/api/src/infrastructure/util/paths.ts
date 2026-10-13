/**
 * Path utilities — resolve the monorepo root so the API can consume the
 * compiled ABI artifact from contracts/out without re-declaring interfaces.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedRoot: string | null = null;

export function findRepoRoot(fromUrl: string | URL): string {
  if (cachedRoot) return cachedRoot;
  let dir = dirname(fileURLToPath(fromUrl));
  for (;;) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { workspaces?: string[] };
    } catch {
      pkg = null;
    }
    if (pkg && Array.isArray(pkg.workspaces)) {
      cachedRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('cannot locate monorepo root (package.json with workspaces)');
    dir = parent;
  }
}

export function registryAbiPath(repoRoot: string): string {
  return join(repoRoot, 'contracts', 'out', 'ZKVerifierRegistry.sol', 'ZKVerifierRegistry.json');
}

export function contractsDir(repoRoot: string): string {
  return join(repoRoot, 'contracts');
}