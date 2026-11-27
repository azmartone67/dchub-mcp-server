// get_infrastructure names the nearest assets (owner 2026-11-26: "enable all substations, all new grid,
// gas, fiber additions to the tool"). The backend's /api/v1/infrastructure now returns a `nearest` block
// (substations from HIFLD + OpenStreetMap as stations, gas pipeline segments, EIA plants); the tool passes it
// through unchanged. These pins keep the tool text, the planner notes and the snapshots saying what it returns,
// and keep the ChatGPT directory's reviewed param text held.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { DIRECTORY_HELD_PARAM_TEXT } from '../lib/chatgpt-directory.mjs';

const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const toolspec = JSON.parse(fs.readFileSync(new URL('../toolspec.json', import.meta.url), 'utf8'));
const frozen = JSON.parse(fs.readFileSync(new URL('./fixtures/chatgpt-toolset.frozen.json', import.meta.url), 'utf8'));

const block = () => {
  const i = src.indexOf("trackedTool(srv, 'get_infrastructure'");
  return src.slice(i, src.indexOf('trackedTool(srv,', i + 10));
};

describe('get_infrastructure: the nearest assets, not only counts', () => {
  it('the tool text names the nearest lists and both substation sources, and no longer over-promises', () => {
    const b = block();
    expect(b).toContain('nearest substations');
    expect(b).toContain('HIFLD + OpenStreetMap');
    expect(b).toContain('nearest gas pipeline segments (Developer plan and up)');
    expect(b).toContain('nearest EIA power plants');
    expect(b).not.toContain('Returns distance + capacity for each, joined to HIFLD/EIA');
    expect(b).toContain("callAPI('/api/v1/infrastructure', args)");   // the nearest block arrives in `r`
  });

  it('the planner no longer says the tool names no nearest asset', () => {
    expect(src).not.toContain('it does not name a nearest asset');
    expect(src).not.toContain('planned transmission upgrade lists are not held');
  });

  it('toolspec.json carries the same description', () => {
    const t = (toolspec.tools || toolspec).find((x) => x.name === 'get_infrastructure');
    expect(t.description).toContain('HIFLD + OpenStreetMap');
  });

  it('the ChatGPT directory keeps its reviewed param text', () => {
    const f = (frozen.tools || frozen).find((x) => x.name === 'get_infrastructure');
    const props = (f.inputSchema || f.input_schema).properties;
    expect(DIRECTORY_HELD_PARAM_TEXT.get_infrastructure.layer).toBe(props.layer.description);
    expect(DIRECTORY_HELD_PARAM_TEXT.get_infrastructure.min_voltage_kv).toBe(props.min_voltage_kv.description);
  });
});
