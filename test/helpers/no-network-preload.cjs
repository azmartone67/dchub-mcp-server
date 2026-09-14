'use strict';
// ★HARD GATE, NO NETWORK: enforced for the whole step, not file by file.
//
// The hard-gate step in .github/workflows/test.yml starts vitest with
// NODE_OPTIONS="--require test/helpers/no-network-preload.cjs". Vitest's forks inherit
// NODE_OPTIONS, so this runs in every worker before any test file, any static
// import it makes, and any vi.hoisted block. From then on a socket connect to
// anything but loopback is refused (ECONNREFUSED on the next tick, the way a
// down host fails) and appended as one JSON line to $DCHUB_NO_NETWORK_LOG. Each
// process also appends one "loaded" line. After vitest,
// scripts/hard-gate-no-network.mjs fails the step on any attempt, and on a log
// with no vitest worker in it: a preload that never loaded would otherwise read
// as zero attempts.
//
// Why the step: measured per file on 2026-09-14, 9 of the 181 listed files
// reached the production backend or dchub.cloud and still passed, because every
// path they reached fails soft. One was added hours after the per-file recorder
// pattern landed. A rule each file must remember holds until a file forgets it.
//
// Files that install their own recorder keep it. The property below is an
// accessor, so this wrapper stays outermost after a test assigns
// net.Socket.prototype.connect: it logs the attempt, then hands the call to the
// test's function, which records and refuses, or calls the connect it saved as
// "real". What it saved is this wrapper (the getter returned it), so that call
// re-enters here and is refused without being logged twice.
//
// Out of reach: non-node child processes (curl, git) and explicit dns lookups.
const { appendFileSync } = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const LOG = process.env.DCHUB_NO_NETWORK_LOG;
// Loopback, plus 0.0.0.0, which a connect resolves to this host. The same set
// the 2026-09-14 per-file measurement used.
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+|0\.0\.0\.0)$/i;

function write(entry) {
  const line = JSON.stringify({ pid: process.pid, ...entry }) + '\n';
  if (!LOG) {
    if (entry.ev === 'connect') process.stderr.write(`no-network preload refused: ${line}`);
    return;
  }
  try { appendFileSync(LOG, line); } catch { /* a log with no worker line fails the verdict */ }
}

// The test file (and test) running when the attempt was made. Best effort: it
// only names the culprit in the verdict's message.
function where() {
  try {
    const w = globalThis.__vitest_worker__;
    const f = w?.current?.file?.filepath || w?.filepath || w?.ctx?.files?.[0];
    const file = typeof f === 'string' ? f : f?.filepath;
    if (file) return { file: path.relative(process.cwd(), file), test: w?.current?.name };
  } catch { /* fall through to the stack */ }
  const m = /\/(test\/[^/:()\s]+\.test\.[cm]?js)/.exec(new Error().stack || '');
  return { file: m ? m[1] : null };
}

function target(args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];                            // net.connect's normalized form: [options, cb]
  if (typeof o === 'string' && !/^\d+$/.test(o)) return { path: o };
  if (!o || typeof o !== 'object') o = { port: o, host: typeof args[1] === 'string' ? args[1] : undefined };
  if (o.path) return { path: o.path };
  return { host: String(o.host || 'localhost').replace(/^\[|\]$/g, ''), port: o.port };
}

const realConnect = net.Socket.prototype.connect;
const INSIDE = Symbol('no-network-preload.inside');
let installed = null;                                        // a test file's own connect, while one is assigned

function refuse(socket, t) {
  const err = new Error(`hard gate: network refused by test/helpers/no-network-preload.cjs (${t.host}:${t.port})`);
  err.code = 'ECONNREFUSED';
  process.nextTick(() => socket.destroy(err));
  return socket;
}

function connect(...args) {
  const t = target(args);
  const local = t.path !== undefined || LOCAL.test(t.host);
  // Re-entered from a test's own connect calling the one it saved: logged below already.
  if (this[INSIDE]) return local ? realConnect.apply(this, args) : refuse(this, t);
  if (!local) write({ ev: 'connect', host: t.host, port: t.port, ...where() });
  if (!installed) return local ? realConnect.apply(this, args) : refuse(this, t);
  this[INSIDE] = true;
  try { return installed.apply(this, args); } finally { this[INSIDE] = false; }
}

const own = Object.getOwnPropertyDescriptor(net.Socket.prototype, 'connect');
Object.defineProperty(net.Socket.prototype, 'connect', {
  configurable: true,
  enumerable: own.enumerable,
  get() { return connect; },
  set(fn) {
    if (this !== net.Socket.prototype) {                     // an instance or subclass assigning its own: shadow it, as before
      Object.defineProperty(this, 'connect', { value: fn, writable: true, configurable: true, enumerable: true });
      return;
    }
    installed = fn === connect || fn === realConnect ? null : fn;
  },
});

write({ ev: 'loaded', worker: process.env.TINYPOOL_WORKER_ID !== undefined });
