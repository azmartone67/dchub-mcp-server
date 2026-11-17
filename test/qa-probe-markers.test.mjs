// qa-probe-markers.test.mjs -- scripts/qa-probe.mjs always sends the markers the server's QA skip recognises.
// The server side is server.mjs _isQaCaller; this test reads it so a renamed marker fails here, not in the counts.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { qaProbeRequest, parseRpcBody, QA_UA_PREFIX } from '../scripts/qa-probe.mjs';

describe('qa-probe: every call is QA-marked', () => {
  it('UA, X-DCHub-QA and the client name all carry the marker, whatever the tag', () => {
    for (const tag of ['h2h', '', 'x y/../evil', undefined]) {
      const r = qaProbeRequest('execute_plan', { intent: 'x' }, tag);
      expect(r.headers['user-agent'].startsWith(`${QA_UA_PREFIX}/`)).toBe(true);
      expect(r.headers['user-agent']).toMatch(/^dchub-qa-readonly\/[a-z0-9._-]+$/i);
      expect(r.headers['x-dchub-qa']).toBe('1');
      expect(r.headers['x-mcp-client']).toBe(QA_UA_PREFIX);
      const body = JSON.parse(r.body);
      expect(body.params).toMatchObject({ name: 'execute_plan', arguments: { intent: 'x' } });
      expect(body.params._meta.clientInfo.name).toBe(QA_UA_PREFIX);
    }
  });
  it('the markers are the ones the server recognises', () => {
    const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).toContain('dchub-qa-readonly');
    expect(src.toLowerCase()).toContain('x-dchub-qa');
  });
  it('reads an SSE or a plain JSON body', () => {
    expect(parseRpcBody('event: message\ndata: {"result":{"ok":1}}\n\n')).toEqual({ result: { ok: 1 } });
    expect(parseRpcBody('{"result":{"ok":2}}')).toEqual({ result: { ok: 2 } });
    expect(parseRpcBody('nope')).toBeNull();
  });
});
