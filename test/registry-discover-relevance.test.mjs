// registry-discover: which crawled repos are worth a human's look (2026-10-23).
// Every case is a repo the widened crawl actually returned on 2026-10-23.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { relevance, directoryRepos } from '../scripts/registry-discover.mjs';

describe('relevance', () => {
  it('keeps curated MCP lists and on-domain lists', () => {
    expect(relevance('tolkonepiu/best-of-mcp-servers A ranked list of MCP servers. Updated weekly.', '').keep).toBe(true);
    expect(relevance('composio-community/awesome-claude-plugins A curated list of Plugins ... MCP servers', '').keep).toBe(true);
    expect(relevance('sacridini/Awesome-Geospatial Long list of geospatial tools and resources', '')).toEqual({ keep: true, why: 'domain match (name/desc)' });
    expect(relevance('kartoza/awesome-gis curated GIS resources', '').keep).toBe(true);
  });

  it('drops single servers and tools that only mention MCP', () => {
    expect(relevance('YosefHayim/ebay-mcp Local MCP server that connects AI assistants to eBay seller APIs', '').keep).toBe(false);
    expect(relevance('ngwg/ceasta disassembler, decompiler and debugger in one, with a built-in mcp server', '').keep).toBe(false);
    expect(relevance('lirantal/ls-mcp List MCP Server configurations in your system', '').keep).toBe(false);
  });

  it('drops lists about something else entirely', () => {
    expect(relevance('matchai/awesome-pinned-gists A collection of awesome dynamic pinned gists for GitHub', '').keep).toBe(false);
    expect(relevance('hproxy-com/free-proxy-list Free proxy list, verified around the clock', '').keep).toBe(false);
  });

  it('drops single-vendor and paper/job lists', () => {
    expect(relevance('marianfoo/sap-ai-mcp-servers A complete list of SAP MCP Servers', '').keep).toBe(false);
    expect(relevance('Untru/1c-mcp Curated list of MCP servers for 1C:Enterprise ecosystem', '').keep).toBe(false);
    expect(relevance('someone/awesome-mcp-papers A curated list of papers on MCP', '').keep).toBe(false);
  });

  it('a domain match outranks a niche word: a person vets those', () => {
    // Domain is tested first on purpose (an energy list is where we belong even
    // if it also says "papers"); the weekly issue is the human filter.
    expect(relevance('hfangcat/Awesome-Geospatial-Embeddings A curated list of papers', '').keep).toBe(true);
  });
});

describe('directoryRepos', () => {
  it('collects every GitHub repo a row records, lower-cased, skipping github.com/mcp', () => {
    const repos = directoryRepos({ directories: [
      { listing_url: 'https://github.com/Sagargupta16/awesome-mcp-servers#data--databases' },
      { listing_url: null, tracking_url: 'https://github.com/sshuair/awesome-gis/pull/300' },
      { listing_url: 'https://github.com/mcp/cloud.dchub/mcp-server' },
      { listing_url: 'https://mcp-hunter.com/server/dc-hub', update_request_url: 'https://github.com/o/r/issues/1' },
    ] });
    expect([...repos].sort()).toEqual(['o/r', 'sagargupta16/awesome-mcp-servers', 'sshuair/awesome-gis']);
    expect(directoryRepos(null).size).toBe(0);
  });

  it('the real file yields the lists we are already on', () => {
    const file = JSON.parse(readFileSync(new URL('../canonical/directories.json', import.meta.url), 'utf8'));
    const repos = directoryRepos(file);
    expect(repos.has('punkpeye/awesome-mcp-servers')).toBe(true);
    expect(repos.size).toBeGreaterThan(20);
  });
});
