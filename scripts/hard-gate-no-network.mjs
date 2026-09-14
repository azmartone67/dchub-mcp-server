#!/usr/bin/env node
// Verdict for the hard-gate step's no-network rule (.github/workflows/test.yml).
//
// Reads the log test/helpers/no-network-preload.cjs appended to during the step's
// vitest run, and exits 1 when:
//   - any process attempted a socket connect off loopback (one ::error per test
//     file, naming the hosts; the preload already refused them), or
//   - no vitest worker loaded the preload (log missing, empty, or only other
//     processes): then zero attempts means nothing was watched, or
//   - a line does not parse: a log this cannot read is not a clean log.
//
// Usage: node scripts/hard-gate-no-network.mjs <log>
import { readFileSync } from 'node:fs';

const logPath = process.argv[2];
if (!logPath) {
  console.error('usage: node scripts/hard-gate-no-network.mjs <log>');
  process.exit(2);
}

// Workflow-command escaping, so a value cannot end the annotation early.
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const errors = [];

let text = '';
try {
  text = readFileSync(logPath, 'utf8');
} catch (e) {
  errors.push(`::error::no-network log ${logPath} is unreadable (${e.code}): the preload never wrote to it.`);
}

const entries = [];
let unparseable = 0;
for (const line of text.split('\n')) {
  if (!line.trim()) continue;
  try { entries.push(JSON.parse(line)); } catch { unparseable += 1; }
}
const loaded = entries.filter((e) => e.ev === 'loaded');
const workers = loaded.filter((e) => e.worker === true).length;
const attempts = entries.filter((e) => e.ev === 'connect');

console.log(`no-network: preload loaded in ${loaded.length} node process(es), ${workers} of them vitest workers; ${attempts.length} connect attempt(s) off loopback, all refused`);

if (unparseable) {
  errors.push(`::error::no-network log has ${unparseable} unparseable line(s); a log this cannot read is not a clean log.`);
}
if (!workers) {
  errors.push('::error::the no-network preload loaded in no vitest worker, so zero attempts proves nothing. The step must pass NODE_OPTIONS=--require test/helpers/no-network-preload.cjs to vitest, and its workers must be forked processes.');
}

const byFile = new Map();
for (const a of attempts) {
  const file = a.file || '';
  if (!byFile.has(file)) byFile.set(file, { hosts: new Set(), n: 0 });
  byFile.get(file).hosts.add(`${a.host}:${a.port}`);
  byFile.get(file).n += 1;
}
for (const [file, { hosts, n }] of byFile) {
  errors.push(`::error${file ? ` file=${file}` : ''}::hard gate: ${esc(file || 'a process running no identifiable test file')} tried to reach ${esc([...hosts].join(', '))} (${n} connect attempt(s), refused). A hard-gate file stays on loopback: a 127.0.0.1 stub, with DCHUB_API_BASE pointed at it until afterAll.`);
}

for (const e of errors) console.log(e);
process.exit(errors.length ? 1 : 0);
