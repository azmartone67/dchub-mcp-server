import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const a = src.indexOf("trackedTool(srv, 'get_grid_scoreboard',");
const b = src.indexOf('const _p_cmp', a);

test('every international snapshot fetch in the scoreboard build carries the feed timeout', () => {
  const calls = src.slice(a, b).match(/callAPI\('\/api\/v1\/iso\/\w+\/snapshot'[^)]*\)/g) || [];
  assert.equal(calls.length, 8);
  for (const c of calls) assert.match(c, /timeout: _SCOREBOARD_FEED_TIMEOUT_MS/);
  assert.match(src, /_SCOREBOARD_FEED_TIMEOUT_MS = 12_000/);
});
