#!/usr/bin/env node
/**
 * Merges a gatekeeper probe report into GITHUB_OUTPUT for composite-action
 * outputs. Prints the key=value lines to stdout when GITHUB_OUTPUT is unset
 * (local use).
 */

/* global process */

import { readFile, appendFile } from 'node:fs/promises';

const reportPath = process.argv[2];
if (!reportPath) process.exit(2);
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const lines = [
  ['verified', report.verified ? 'true' : 'false'],
  ['circuit-id', report.circuitId ?? ''],
  ['vk-hash', report.vkHash ?? ''],
  ['key-id', report.keyId ?? ''],
  ['report', JSON.stringify(report)],
];
const output = process.env.GITHUB_OUTPUT;
if (output) {
  for (const [k, v] of lines) await appendFile(output, `${k}=${v}\n`);
} else {
  for (const [k, v] of lines) process.stdout.write(`${k}=${v}\n`);
}