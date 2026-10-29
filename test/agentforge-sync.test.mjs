// agentforge-sync: the predicates that decide whether the AgentForge listing is
// current and what to write. No network. Each block carries its False branch.
import { describe, it, expect } from 'vitest';
import {
  buildListing, listingDrift, pickOurs, planWrite, unwrap, CATEGORY, LISTING_NAME,
} from '../scripts/agentforge-sync.mjs';
import { loadListingCopy, copyRuleViolations, MCP_URL } from '../scripts/listing-copy.mjs';

const COPY = { short: 'DC Hub short copy.', long: 'DC Hub long copy.' };
const TOOLS = [
  { name: 'get_grid_data', description: 'grid', inputSchema: { type: 'object', properties: { iso: { type: 'string' } } } },
  { name: 'search_facilities', description: 'facilities' },
];
const want = buildListing(COPY, TOOLS);
const remoteOf = (over = {}) => ({
  id: 'u1', slug: 'dc-hub', endpoint_url: MCP_URL, description: COPY.short, long_description: COPY.long,
  tools: [{ name: 'get_grid_data' }, { name: 'search_facilities' }], ...over,
});

describe('buildListing', () => {
  it('takes copy from listing-copy.json and every live tool with its schema', () => {
    expect(want).toMatchObject({ name: LISTING_NAME, description: COPY.short, long_description: COPY.long, category: CATEGORY, endpoint_url: MCP_URL });
    expect(want.tools.map((t) => t.name)).toEqual(['get_grid_data', 'search_facilities']);
    expect(want.tools[0].input_schema.properties.iso).toBeTruthy();
    expect(want.tools[1].input_schema).toEqual({ type: 'object', properties: {} });
  });

  it('refuses to build from no copy or no tools', () => {
    expect(() => buildListing(null, TOOLS)).toThrow(/short\/long/);
    expect(() => buildListing(COPY, [])).toThrow(/no tools/);
  });

  it('the real listing copy passes the copy rules it is published under', () => {
    const copy = loadListingCopy();
    expect(copyRuleViolations(copy.short)).toEqual([]);
    expect(copyRuleViolations(copy.long)).toEqual([]);
  });
});

describe('listingDrift', () => {
  it('a listing equal to what we serve has no drift', () => {
    expect(listingDrift(remoteOf(), want)).toEqual([]);
  });

  it('whitespace differences are not drift', () => {
    expect(listingDrift(remoteOf({ description: `  ${COPY.short.replace(' ', '\n')} ` }), want)).toEqual([]);
  });

  it('no listing at all is drift', () => {
    expect(listingDrift(null, want)).toEqual(['not listed']);
  });

  it('a new live tool, a retired one, old copy and a moved endpoint are each named', () => {
    const d = listingDrift(remoteOf({
      endpoint_url: 'https://old.example/mcp',
      description: 'old copy',
      tools: [{ name: 'get_grid_data' }, { name: 'retired_tool' }],
    }), want);
    expect(d.join(' | ')).toMatch(/endpoint https:\/\/old\.example\/mcp/);
    expect(d.join(' | ')).toMatch(/short description differs/);
    expect(d.join(' | ')).toMatch(/tools: 2 listed, 2 live; missing search_facilities; retired retired_tool/);
  });

  it('a tag-only difference is drift; order and case do not matter; no tags field means no comparison', () => {
    expect(listingDrift(remoteOf({ tags: [...want.tags].reverse().map((g) => g.toUpperCase()) }), want)).toEqual([]);
    expect(listingDrift(remoteOf({ tags: want.tags.slice(0, 8) }), want)).toEqual(['tags differ from TAGS in agentforge-sync.mjs']);
    expect(listingDrift(remoteOf({ tags: [] }), want)).toEqual(['tags differ from TAGS in agentforge-sync.mjs']);
    expect(listingDrift(remoteOf(), want)).toEqual([]);
  });

  it('with no tool list it falls back to total_tools, and an empty listing is drift', () => {
    expect(listingDrift(remoteOf({ tools: [], total_tools: 2 }), want)).toEqual([]);
    expect(listingDrift(remoteOf({ tools: [], total_tools: 1 }), want)).toEqual(['total_tools 1 (live 2)']);
    expect(listingDrift(remoteOf({ tools: undefined, total_tools: undefined }), want)).toEqual(['lists no tools']);
  });
});

describe('pickOurs', () => {
  it('matches on our endpoint, trailing slash or not', () => {
    expect(pickOurs([{ id: 'x', endpoint_url: 'https://other/mcp' }, { id: 'y', endpoint_url: `${MCP_URL}/` }])?.id).toBe('y');
  });
  it('never on a name: a look-alike "DC Hub" elsewhere is not ours', () => {
    expect(pickOurs([{ id: 'z', name: 'DC Hub', endpoint_url: '' }])).toBeNull();
    expect(pickOurs(null)).toBeNull();
  });
});

describe('planWrite', () => {
  it('does nothing when in sync, key or not', () => {
    expect(planWrite({ remote: remoteOf(), drift: [], hasKey: true }).action).toBe('none');
    expect(planWrite({ remote: null, drift: [], hasKey: false }).action).toBe('none');
  });
  it('without a key it only says what it would do', () => {
    expect(planWrite({ remote: null, drift: ['not listed'], hasKey: false })).toMatchObject({ action: 'dry-run' });
    expect(planWrite({ remote: null, drift: ['not listed'], hasKey: false }).why).toMatch(/would POST/);
  });
  it('POSTs a missing listing and PUTs one that drifted', () => {
    expect(planWrite({ remote: null, drift: ['not listed'], hasKey: true }).action).toBe('post');
    expect(planWrite({ remote: remoteOf(), drift: ['x'], hasKey: true }).action).toBe('put');
  });
});

describe('unwrap', () => {
  it('reads the {success, data} envelope and a bare body alike', () => {
    expect(unwrap({ success: true, data: { servers: [] }, error: null })).toEqual({ servers: [] });
    expect(unwrap({ servers: [1] })).toEqual({ servers: [1] });
  });
});
