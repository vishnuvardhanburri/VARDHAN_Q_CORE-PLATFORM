/**
 * API-key secret store — loads clientId:secret:roles from ZK_API_KEYS
 * (ADR-0005). Secrets are validated at boot by config.ts and never logged.
 */

import type { ClientSecret, Role } from '../../domain/entities.js';
import type { SecretStorePort } from '../../domain/ports.js';
import { parseApiKeys } from '../../config.js';

const VALID_ROLES: readonly Role[] = ['read', 'submit', 'write', 'audit'];

export class EnvSecretStore implements SecretStorePort {
  private readonly byClientId = new Map<string, ClientSecret>();

  constructor(apiKeysRaw: string) {
    for (const entry of parseApiKeys(apiKeysRaw)) {
      const roles = new Set<Role>();
      for (const role of entry.roles) {
        if (!(VALID_ROLES as readonly string[]).includes(role)) {
          throw new Error(`invalid role "${role}" for client "${entry.clientId}"`);
        }
        roles.add(role as Role);
      }
      if (this.byClientId.has(entry.clientId)) {
        throw new Error(`duplicate clientId "${entry.clientId}" in ZK_API_KEYS`);
      }
      this.byClientId.set(entry.clientId, {
        clientId: entry.clientId,
        secret: entry.secret,
        roles,
        tenantId: entry.tenantId,
      });
    }
  }

  async lookup(clientId: string): Promise<ClientSecret | null> {
    return this.byClientId.get(clientId) ?? null;
  }
}