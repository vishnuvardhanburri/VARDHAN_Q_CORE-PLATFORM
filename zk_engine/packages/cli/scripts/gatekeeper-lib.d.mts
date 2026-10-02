export type GateCheck = { name: string; ok: boolean; detail: string };

export interface GateReport {
  schemaVersion: number;
  circuitId: string | null;
  vkHash: string | null;
  artifactHash: string | null;
  publicInputHash: string | null;
  keyId: string | null;
  onChain: unknown;
  checks: GateCheck[];
  verified: boolean;
  reasons: string[];
}

export interface GateOptions {
  envelopeFile: string;
  trustedPublicKey?: string;
  requireSigned?: boolean;
  circuit?: string;
  vkAllowlist?: string;
  artifactDir?: string;
  requireArtifactHash?: boolean;
  registry?: { rpcUrl: string; proxy: string; maxAge?: number };
}

export interface GateDeps {
  readFile?: (path: string, encoding: 'utf8') => Promise<string>;
  readDirArtifacts?: (circuitId: string, dir: string) => Promise<unknown>;
  chainCheck?: (circuitId: string, envelope: unknown, registry: unknown, report: unknown) => Promise<GateCheck[]>;
  engineVerify?: (circuit: unknown, publicInputs: unknown, proof: unknown) => Promise<{ valid: boolean }>;
  loadCircuit?: (...args: unknown[]) => unknown;
  loadManifest?: (...args: unknown[]) => unknown;
}

export declare function runGate(
  opts: GateOptions,
  deps?: GateDeps,
): Promise<{ verified: boolean; reasons: string[]; report: GateReport }>;

export declare function artifactHashFromManifest(manifest: unknown): string;
export declare function canonicalArtifactBundle(r1cs: string, wasm: string, zkey: string, vkSha256: string, vkHash: string): string;
export declare function sha256Hex(input: string): string;
export declare function checkChain(
  circuitId: string,
  envelope: unknown,
  registry: { rpcUrl: string; proxy: string; maxAge?: number },
  report: unknown,
): Promise<GateCheck[]>;