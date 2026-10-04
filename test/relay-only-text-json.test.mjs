import { describe, it, expect } from 'vitest';
import { _relayOnlyText } from '../server.mjs';

const A = 'https://dchub.cloud/go/c/aaa';
const B = 'https://dchub.cloud/go/c/bbb';

describe('_relayOnlyText keeps the JSON body parseable', () => {
  it('leaves URLs inside the JSON body alone and rewrites only the prose', () => {
    const body = JSON.stringify({ pack_url: A, developer_url: B });
    const t = body + '\n\n---\n\nOpen ' + A + ' or ' + B;
    const out = _relayOnlyText(t);
    const json = out.split('\n\n---\n\n')[0];
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json).developer_url).toBe(B);
    expect(out).toContain('the "For your human" link from earlier in this session');
    expect(out.split('\n\n---\n\n')[1].startsWith('Open ' + A)).toBe(true);
  });
  it('uses a quote-free phrase when there is no separator', () => {
    const out = _relayOnlyText(JSON.stringify({ a: A, b: B }));
    expect(() => JSON.parse(out)).not.toThrow();
  });
});
