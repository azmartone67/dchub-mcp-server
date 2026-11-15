// /mcp/directories — "Find DC Hub in your MCP directory" (lib/directories-page.mjs).
// canonical/directories.json is the source of truth; Grok's hourly presence
// routine edits it. These tests pin what any edit must keep true.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MCP_PATHS } from '../server.mjs';
import {
  DIRECTORIES_PATH, DIRECTORIES_JSON_PATH, DIRECTORIES_CSP,
  loadDirectories, liveDirectories, directoriesJson, renderDirectoriesPage,
  viewUrl, REGISTRY_HUMAN_URL,
} from '../lib/directories-page.mjs';

const DATA = loadDirectories();
const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
// Pictographic emoji, plus the variation selector and keycap combiner.
const EMOJI = /[\p{Extended_Pictographic}️⃣]/u;

describe('canonical/directories.json', () => {
  it('has well-formed rows with unique ids', () => {
    const rows = DATA.directories;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    const ids = rows.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of rows) {
      expect(d.id, JSON.stringify(d)).toMatch(/^[a-z0-9-]+$/);
      expect(typeof d.name).toBe('string');
      expect(['live', 'pending', 'unverified', 'offline']).toContain(d.status);
    }
  });

  // 2026-11-14 (owner item F3): status_text is the short public line /mcp-standing shows
  // beside a non-live row (note stays internal). A live row's state comes from the scan.
  it('status_text, when present, is a short public line on a non-live row', () => {
    const withText = DATA.directories.filter((d) => 'status_text' in d);
    expect(withText.length).toBeGreaterThan(0);
    for (const d of withText) {
      expect(d.status, d.id).not.toBe('live');
      expect(typeof d.status_text, d.id).toBe('string');
      expect(d.status_text.length, d.id).toBeGreaterThan(0);
      expect(d.status_text.length, d.id).toBeLessThanOrEqual(80);
    }
  });

  it('F3 rows: Cursor Marketplace reads as deferred, MCP World (Baidu) is offline', () => {
    const by = Object.fromEntries(DATA.directories.map((d) => [d.id, d]));
    expect(by['cursor-marketplace'].status_text).toBe('Submitted; Cursor deferred 2026-10-28');
    expect(by['mcp-world'].status).toBe('offline');
  });

  it('every live row has an https listing URL (a live row without one would silently vanish)', () => {
    for (const d of DATA.directories.filter((r) => r.status === 'live')) {
      expect(d.listing_url, d.id).toMatch(/^https:\/\//);
    }
    expect(liveDirectories(DATA).length).toBe(DATA.directories.filter((r) => r.status === 'live').length);
  });

  it('a scan:manual row is live with a dated human check (the backend tracker shows Live on verified_at)', () => {
    for (const d of DATA.directories.filter((r) => 'scan' in r)) {
      expect(d.scan, d.id).toBe('manual');
      expect(d.status, d.id).toBe('live');
      expect(d.verified_at, d.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('renderDirectoriesPage', () => {
  const html = renderDirectoriesPage(DATA, { tools: 94 });

  it('carries the brief copy and the live tool count', () => {
    expect(html).toContain('<h1>Find DC Hub in your MCP directory</h1>');
    expect(html).toContain('One server, listed wherever agents look. Same 94 tools everywhere.');
  });

  it('renders every live directory and no pending one', () => {
    for (const d of DATA.directories) {
      const shown = html.includes(`data-id="${d.id}"`);
      expect(shown, `${d.id} (${d.status})`).toBe(d.status === 'live');
    }
  });

  it('sends a reader to the registry search page, never to its raw JSON API', () => {
    const out = renderDirectoriesPage({ directories: [
      { id: 'official-registry', name: 'Official MCP Registry', status: 'live',
        listing_url: 'https://registry.modelcontextprotocol.io/v0/servers?search=cloud.dchub/mcp-server&version=latest' },
      { id: 'other', name: 'Other Dir', status: 'live', listing_url: 'https://example.com/other?x=1' },
    ] }, { tools: 1 });
    expect(out).toContain(`href="${REGISTRY_HUMAN_URL}"`);
    expect(out).not.toContain('registry.modelcontextprotocol.io/v0');
    expect(out).toContain('href="https://example.com/other?x=1"');
    expect(html).not.toContain('registry.modelcontextprotocol.io/v0');
    // the data file keeps the API URL: the scanner reads version and tools from it
    const row = DATA.directories.find((r) => r.id === 'official-registry');
    expect(row.listing_url).toMatch(/^https:\/\/registry\.modelcontextprotocol\.io\/v0\//);
    expect(viewUrl(row.listing_url)).toBe(REGISTRY_HUMAN_URL);
    expect(viewUrl(null)).toBe(null);
  });

  it('offline rows are hidden even when they carry a listing URL', () => {
    const out = renderDirectoriesPage({ directories: [
      { id: 'y', name: 'Offline Dir', status: 'offline', listing_url: 'https://example.com/y' },
    ] }, { tools: 1 });
    expect(out).not.toContain('Offline Dir');
  });

  it('pending rows are hidden even when they carry a listing URL', () => {
    const out = renderDirectoriesPage({ directories: [
      { id: 'x', name: 'Pending Dir', status: 'pending', listing_url: 'https://example.com/x' },
    ] }, { tools: 1 });
    expect(out).not.toContain('Pending Dir');
  });

  it('has no prices, no facility count and no emoji', () => {
    expect(html).not.toMatch(/\$\s?\d/);
    expect(html).not.toMatch(/\/mo\b|per month|pricing/i);
    expect(html).not.toMatch(/facilit/i);
    expect(EMOJI.test(html)).toBe(false);
  });

  it('is one column at phone width and widens only behind min-width queries', () => {
    expect(html).toContain('grid-template-columns:1fr}');
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1">/);
    const multi = [...html.matchAll(/@media \(min-width:\d+px\)\{ul\.grid\{grid-template-columns:repeat/g)];
    expect(multi.length).toBe(2);
  });

  it('escapes file values and refuses non-https URLs', () => {
    const out = renderDirectoriesPage({ directories: [
      { id: 'a', name: '<script>alert(1)</script>', status: 'live', listing_url: 'https://example.com/a',
        badge_url: 'javascript:alert(1)', logo_url: 'http://insecure.example/logo.png' },
      { id: 'b', name: 'Bad link', status: 'live', listing_url: 'javascript:alert(1)' },
    ] }, { tools: 1 });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toMatch(/javascript:/);
    expect(out).not.toContain('http://insecure.example');
    expect(out).not.toContain('Bad link');
  });
});

describe('directoriesJson', () => {
  it('lists live rows only', () => {
    const j = directoriesJson(DATA, { tools: 94 });
    expect(j.tools).toBe(94);
    expect(j.directories.map((d) => d.id))
      .toEqual(DATA.directories.filter((d) => d.status === 'live').map((d) => d.id));
  });
});

describe('routes', () => {
  it('serves the page and the JSON twin at the brief paths', () => {
    expect(DIRECTORIES_PATH).toBe('/mcp/directories');
    expect(DIRECTORIES_JSON_PATH).toBe('/mcp/directories.json');
    expect(SRC).toMatch(/app\.get\(\[DIRECTORIES_PATH, DIRECTORIES_PATH \+ '\/'\]/);
    expect(SRC).toMatch(/app\.get\(DIRECTORIES_JSON_PATH,/);
  });

  it('is a page, not an MCP endpoint', () => {
    expect(MCP_PATHS).not.toContain(DIRECTORIES_PATH);
    expect(MCP_PATHS).not.toContain(DIRECTORIES_JSON_PATH);
  });

  it('page CSP allows inline style, https images and only the same-origin site nav script', () => {
    expect(DIRECTORIES_CSP).toContain("style-src 'self' 'unsafe-inline'");
    expect(DIRECTORIES_CSP).toContain('img-src https:');
    const scriptSrc = DIRECTORIES_CSP.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBe("script-src 'self' https://static.cloudflareinsights.com");
    expect(DIRECTORIES_CSP).toContain("default-src 'none'");
  });
});
