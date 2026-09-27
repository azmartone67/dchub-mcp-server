import test from 'node:test';
import assert from 'node:assert/strict';
import { createDCHubTools, withDCHubTools, DCHUB_MCP_URL } from '../index.mjs';

function fakeClient({ tools = { a: { id: 'a' }, b: { id: 'b' } }, failTools = false } = {}) {
  const calls = { config: null, closed: 0 };
  const create = async (config) => {
    calls.config = config;
    return {
      tools: async () => { if (failTools) throw new Error('boom'); return tools; },
      close: async () => { calls.closed += 1; },
    };
  };
  return { create, calls };
}

test('keyless by default: no X-API-Key header when no key is given', async () => {
  const saved = process.env.DCHUB_API_KEY;
  delete process.env.DCHUB_API_KEY;
  try {
    const { create, calls } = fakeClient();
    const { tools } = await createDCHubTools({}, create);
    assert.deepEqual(calls.config.transport, { type: 'http', url: DCHUB_MCP_URL });
    assert.deepEqual(Object.keys(tools), ['a', 'b']);
  } finally {
    if (saved !== undefined) process.env.DCHUB_API_KEY = saved;
  }
});

test('apiKey option is sent as X-API-Key', async () => {
  const { create, calls } = fakeClient();
  await createDCHubTools({ apiKey: 'dch_live_TEST' }, create);
  assert.deepEqual(calls.config.transport.headers, { 'X-API-Key': 'dch_live_TEST' });
});

test('DCHUB_API_KEY env is the default key', async () => {
  const saved = process.env.DCHUB_API_KEY;
  process.env.DCHUB_API_KEY = 'dch_live_ENV';
  try {
    const { create, calls } = fakeClient();
    await createDCHubTools({}, create);
    assert.deepEqual(calls.config.transport.headers, { 'X-API-Key': 'dch_live_ENV' });
  } finally {
    if (saved === undefined) delete process.env.DCHUB_API_KEY; else process.env.DCHUB_API_KEY = saved;
  }
});

test('url option overrides the endpoint', async () => {
  const { create, calls } = fakeClient();
  await createDCHubTools({ url: 'https://example.test/mcp' }, create);
  assert.equal(calls.config.transport.url, 'https://example.test/mcp');
});

test('only keeps the named tools', async () => {
  const { create } = fakeClient();
  const { tools } = await createDCHubTools({ only: ['b'] }, create);
  assert.deepEqual(Object.keys(tools), ['b']);
});

test('only with an unknown tool throws and closes the client', async () => {
  const { create, calls } = fakeClient();
  await assert.rejects(createDCHubTools({ only: ['nope'] }, create), /unknown tool\(s\): nope/);
  assert.equal(calls.closed, 1);
});

test('a tools() failure closes the client', async () => {
  const { create, calls } = fakeClient({ failTools: true });
  await assert.rejects(createDCHubTools({}, create), /boom/);
  assert.equal(calls.closed, 1);
});

test('withDCHubTools closes after success and after a throw', async () => {
  const ok = fakeClient();
  assert.equal(await withDCHubTools({}, async ({ tools }) => Object.keys(tools).length, ok.create), 2);
  assert.equal(ok.calls.closed, 1);
  const bad = fakeClient();
  await assert.rejects(withDCHubTools({}, async () => { throw new Error('fn failed'); }, bad.create), /fn failed/);
  assert.equal(bad.calls.closed, 1);
});

test('live: keyless tools load and one tool executes', { skip: process.env.DCHUB_LIVE !== '1' }, async () => {
  const count = await withDCHubTools({ apiKey: '' }, async ({ tools }) => {
    const out = await tools.get_grid_scoreboard.execute({}, { toolCallId: 'live', messages: [] });
    assert.ok(JSON.stringify(out).includes('"ok":true'));
    return Object.keys(tools).length;
  });
  assert.ok(count > 0);
});
