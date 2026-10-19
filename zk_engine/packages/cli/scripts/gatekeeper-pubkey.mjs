#!/usr/bin/env node
/**
 * Emits `pubkey=<jw kjson>` for GITHUB_OUTPUT from a public-key JWK file.
 */

/* global process */

import { readFileSync } from 'node:fs';

const [path] = process.argv.slice(2);
if (!path) process.exit(2);
const jwk = JSON.parse(readFileSync(path, 'utf8'));
process.stdout.write(`pubkey=${JSON.stringify(jwk)}\n`);
process.exit(0);