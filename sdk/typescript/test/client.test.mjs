import test from 'node:test';
import assert from 'node:assert/strict';
import { Vardhan, VardhanApiError } from '../dist/index.js';

const makeFetch = (status, body, headers = {}) => async (_url, init) => {
  assert.equal(init.headers.get('accept'), 'application/json');
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
};

test('client sends bearer authentication and parses health', async () => {
  const client = new Vardhan({ baseUrl: 'https://console.example.com', token: 'test-token', fetch: makeFetch(200, { service: 'vardhan-control-plane', status: 'operational', mode: 'enterprise', authentication: 'server_enforced', demo_authentication: false }) });
  const health = await client.health();
  assert.equal(health.status, 'operational');
});

test('client exposes typed API errors', async () => {
  const client = new Vardhan({ baseUrl: 'https://console.example.com', fetch: makeFetch(403, { error: 'Organization access denied.', code: 'FORBIDDEN' }, { 'x-request-id': 'req-1' }) });
  await assert.rejects(() => client.get('/api/v1/organizations/x'), error => {
    assert.ok(error instanceof VardhanApiError);
    assert.equal(error.status, 403);
    assert.equal(error.requestId, 'req-1');
    return true;
  });
});

test('client rejects missing base URL', () => assert.throws(() => new Vardhan({ baseUrl: '' }), /baseUrl is required/));
