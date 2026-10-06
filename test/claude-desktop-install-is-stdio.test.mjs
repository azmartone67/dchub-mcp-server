// claude-desktop-install-is-stdio.test.mjs — Grok audit 2026-10-06, item 4.
// claude_desktop_config.json runs stdio servers only. A {"url": …, "transport": "http"} entry there is
// dropped (public reports say it can wipe mcpServers). Every Claude Desktop install this repo ships must
// be the launcher: {"mcpServers":{"dchub":{"command":"npx","args":["-y","dchub-mcp-server"],"env":{"DCHUB_API_KEY":…}}}}.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// every ```json fence (or inline { "mcpServers" … } line) within 12 lines below a mention of claude_desktop_config.json
function desktopBlocks(md) {
  const lines = md.split('\n'); const out = [];
  lines.forEach((l, i) => {
    if (!/claude_desktop_config\.json/.test(l)) return;
    const win = lines.slice(i, i + 14).join('\n');
    const st = win.indexOf('{ "mcpServers"') >= 0 ? win.indexOf('{ "mcpServers"') : win.indexOf('{\n  "mcpServers"');
    if (st < 0) return;
    let d = 0;
    for (let n = st; n < win.length; n++) {
      if (win[n] === '{') d++;
      else if (win[n] === '}' && --d === 0) { out.push(win.slice(st, n + 1)); break; }
    }
  });
  return out;
}

describe('Claude Desktop installs are stdio', () => {
  for (const f of ['README.md', 'llms-install.md', 'docs/one-click-install.md']) {
    it(f + ': at least one Claude Desktop block, every one the npx launcher, none a url entry', () => {
      const blocks = desktopBlocks(read(f));
      expect(blocks.length, 'no Claude Desktop block found (a vacuous pass)').toBeGreaterThan(0);
      for (const b of blocks) {
        const j = JSON.parse(b);
        expect(j.mcpServers.dchub.command).toBe('npx');
        expect(j.mcpServers.dchub.args).toEqual(['-y', 'dchub-mcp-server']);
        expect(j.mcpServers.dchub.url).toBeUndefined();
        expect(j.mcpServers.dchub.transport).toBeUndefined();
      }
    });
  }
  it('README has a Quickstart (stdio) and points the URL route at Settings → Connectors', () => {
    const r = read('README.md');
    expect(r).toContain('Quickstart (stdio)');
    expect(r).toContain('Settings → Connectors');
  });
  it('claim_free_key persist_config.clients.claude_desktop is the launcher with the key in env, plus the connector pointer', () => {
    const src = read('server.mjs');
    const i = src.indexOf('claude_desktop: {', src.indexOf('const _persistConfig ='));
    const blk = src.slice(i, src.indexOf('claude_code: {', i));
    expect(blk).toContain("command: 'npx'");
    expect(blk).toContain("args: ['-y', 'dchub-mcp-server']");
    expect(blk).toContain('env: { DCHUB_API_KEY: key }');
    expect(blk).not.toMatch(/transport:\s*'http'/);
    expect(blk).toContain('connector_url');
    expect(blk).toContain('Settings → Connectors');
  });
});
