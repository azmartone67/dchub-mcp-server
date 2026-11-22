// item 6 (owner 2026-11-22): the licence block's licence_url points at /licence while DCHUB_LICENCE_PAGE_V1 is on
// (the backend serves the page behind the same flag), and at /connect, exactly as before, while it is off.
import { describe, it, expect } from 'vitest';
import { LICENCE_URL, LICENCE_PAGE_URL, LICENCE_PAGE_FLAG, licencePageOn, licenceBaseUrl } from '../lib/wall-relay-everywhere.mjs';
import { licenceUrl, licenceBlock } from '../lib/licence-block.mjs';

const ON = { [LICENCE_PAGE_FLAG]: '1' };

describe('item 6: licence_url follows DCHUB_LICENCE_PAGE_V1', () => {
  it('the flag reads 1/true/yes/on only; anything else (and absent) is off', () => {
    for (const v of ['1', 'true', 'YES', ' on ']) expect(licencePageOn({ [LICENCE_PAGE_FLAG]: v })).toBe(true);
    for (const v of ['', '0', 'off', 'no', '2', 'onn']) expect(licencePageOn({ [LICENCE_PAGE_FLAG]: v })).toBe(false);
    expect(licencePageOn({})).toBe(false);
    expect(LICENCE_PAGE_FLAG).toBe('DCHUB_LICENCE_PAGE_V1');
  });

  it('off: /connect, unchanged; on: /licence', () => {
    expect(LICENCE_URL).toBe('https://dchub.cloud/connect');
    expect(LICENCE_PAGE_URL).toBe('https://dchub.cloud/licence');
    expect(licenceBaseUrl({})).toBe(LICENCE_URL);
    expect(licenceBaseUrl(ON)).toBe(LICENCE_PAGE_URL);
  });

  it('licenceUrl keeps via=mcp and a valid tool name on both', () => {
    expect(licenceUrl('analyze_site', {})).toBe('https://dchub.cloud/connect?via=mcp&tool=analyze_site');
    expect(licenceUrl('analyze_site', ON)).toBe('https://dchub.cloud/licence?via=mcp&tool=analyze_site');
    expect(licenceUrl('Not A Tool', ON)).toBe('https://dchub.cloud/licence?via=mcp');
  });

  it('the block carries the flag-chosen url and nothing else changes', () => {
    const args = { tool: 'compare_sites', sc: { mw_withheld: true }, apiKey: '', tier: '' };
    const off = licenceBlock({ ...args, env: {} });
    const on = licenceBlock({ ...args, env: ON });
    expect(off.licence_url).toBe('https://dchub.cloud/connect?via=mcp&tool=compare_sites');
    expect(on.licence_url).toBe('https://dchub.cloud/licence?via=mcp&tool=compare_sites');
    const { licence_url: a, ...restOn } = on; const { licence_url: b, ...restOff } = off;
    expect(restOn).toEqual(restOff);
  });

  it('read per call from the env, so a flag flip needs no code change', () => {
    const prev = process.env[LICENCE_PAGE_FLAG];
    try {
      delete process.env[LICENCE_PAGE_FLAG];
      expect(licenceUrl('get_grid_data')).toContain('/connect?');
      process.env[LICENCE_PAGE_FLAG] = 'on';
      expect(licenceUrl('get_grid_data')).toContain('/licence?');
      expect(licenceBlock({ tool: 'get_grid_data' }).licence_url).toContain('/licence?');
    } finally {
      if (prev === undefined) delete process.env[LICENCE_PAGE_FLAG]; else process.env[LICENCE_PAGE_FLAG] = prev;
    }
  });
});
