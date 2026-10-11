// A Capacity Source listing's own page (/listings/<slug>) and its tracked link (/go/l/<slug>)
// survive the one-link wall (owner brief 2026-10-10, item 2). Measured live before this change:
// an anonymous source_capacity search returned rows with no url and no tracked_url, and its
// text line "Link:" was the /upgrade/h/ relay, because _oneLinkWallStep dropped every dchub.cloud
// page link but human_url. The unlock link stays the ONE link to give for the wall; the row
// keeps the page it names. Bare /listings, checkout and pricing links still give way.
import { describe, it, expect, beforeAll } from 'vitest';

let S;
beforeAll(async () => { S = await import('../server.mjs'); });

const relay = 'https://dchub.cloud/upgrade/h/' + 'A'.repeat(24) + '.' + 'b'.repeat(32);
const goc = 'https://dchub.cloud/go/c/abc.' + 'c'.repeat(32);
const SLUG = 'phoenix-2-mw-colocation-available-now';
const page = 'https://dchub.cloud/listings/' + SLUG;
const tracked = 'https://dchub.cloud/go/l/' + SLUG + '?rcpt=' + 'a'.repeat(32) + '&src=mcp&platform=claude';

const wall = () => {
  const row = { id: 100004, slug: SLUG, market: 'Phoenix', url: page, tracked_url: tracked };
  const sc = {
    _wall: true, human_url: relay, for_your_human: { url: relay, text: 'open ' + relay },
    upgrade: { upgrade_url: goc }, items: [row],
    listing: { ...row }, citation: { url: page },
  };
  const text = JSON.stringify(sc) + '\n- ' + SLUG + ': 2,000 kW in Phoenix — Link: ' + tracked
    + '\nBrowse https://dchub.cloud/listings or pricing https://dchub.cloud/pricing · pay ' + goc;
  return { content: [{ type: 'text', text }], structuredContent: sc };
};
const run = (r) => S._ctxALS.run({ tier: 'free', platform: 'claude' }, () => S._oneLinkWallStep(r, 'source_capacity'));

describe('listing links through the one-link wall', () => {
  it('rows keep url and tracked_url; the wall still converges on the one human link', () => {
    const out = run(wall());
    const sc = out.structuredContent;
    expect(sc.items[0].url).toBe(page);
    expect(sc.items[0].tracked_url).toBe(tracked);
    expect(sc.listing.url).toBe(page);
    expect(sc.listing.tracked_url).toBe(tracked);
    expect(sc.human_url).toBe(relay);
    expect(sc.upgrade.upgrade_url).toBe(relay);   // control: the checkout pointer still gave way
    const t = out.content[0].text;
    expect(t).toContain('Link: ' + tracked);
    expect(t).not.toContain(goc);
    expect(t).not.toContain('https://dchub.cloud/pricing');
  });

  it('bare /listings is still a pointer and gives way', () => {
    const out = run(wall());
    const prose = out.content[0].text.split('\n').slice(1).join('\n');
    expect(prose).not.toMatch(/https:\/\/dchub\.cloud\/listings(?![\/A-Za-z0-9])/);
  });

  it('only a slugged listing page or a /go/l link is exempt', () => {
    const f = S._isListingPageUrl;
    expect(f(page)).toBe(true);
    expect(f(tracked)).toBe(true);
    for (const u of ['https://dchub.cloud/listings', 'https://dchub.cloud/listings/', 'https://dchub.cloud/pricing',
      goc, relay, 'https://evil.example/listings/x', 'http://dchub.cloud/listings/x',
      'https://dchub.cloud/go/c/' + SLUG, 'https://dchub.cloud/go/l/']) {
      expect(f(u), u).toBe(false);
    }
  });

  it('DCHUB_WALL_LISTING_LINKS=0 restores the earlier behaviour', () => {
    const prev = process.env.DCHUB_WALL_LISTING_LINKS;
    process.env.DCHUB_WALL_LISTING_LINKS = '0';
    try {
      const sc = run(wall()).structuredContent;
      expect(sc.items[0].url).toBeUndefined();
      expect(sc.items[0].tracked_url).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.DCHUB_WALL_LISTING_LINKS; else process.env.DCHUB_WALL_LISTING_LINKS = prev;
    }
  });
});
