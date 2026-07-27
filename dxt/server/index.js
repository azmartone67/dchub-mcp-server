#!/usr/bin/env node
/**
 * DC Hub .dxt bridge — stdio ⇄ streamable-HTTP proxy (2026-07-27).
 *
 * Claude Desktop's Desktop Extensions run a LOCAL stdio MCP server; DC Hub
 * is a HOSTED streamable-HTTP server. This is the thinnest possible bridge:
 * newline-delimited JSON-RPC on stdin/stdout ⇄ POST https://dchub.cloud/mcp.
 *
 * Deliberately DEPENDENCY-FREE (Node 18+ global fetch only) so the .dxt
 * bundle is a few KB with no node_modules to package, sign, or patch.
 *
 * Behavior:
 *  · Every request line is POSTed to the remote; the reply (plain JSON or
 *    a single SSE `data:` frame) is written back as one line.
 *  · The remote's Mcp-Session-Id from `initialize` is captured and re-sent
 *    on every subsequent call (DC Hub's session→key restore then keeps a
 *    claimed key working across reconnects server-side).
 *  · DCHUB_API_KEY (from the extension's user_config) is sent as X-API-Key;
 *    keyless works at the free tier.
 *  · Notifications (no id) are forwarded fire-and-forget.
 *  · Any transport error becomes a JSON-RPC error reply for THAT id — the
 *    bridge itself never crashes the host.
 */

'use strict';

const URL_ = process.env.DCHUB_MCP_URL || 'https://dchub.cloud/mcp';
const KEY = (process.env.DCHUB_API_KEY || '').trim();

let sessionId = null;

function headers() {
  const h = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'User-Agent': 'dchub-dxt-bridge/1.0.0',
  };
  if (KEY) h['X-API-Key'] = KEY;
  if (sessionId) h['Mcp-Session-Id'] = sessionId;
  return h;
}

function parseBody(text) {
  // Plain JSON or streamable-HTTP SSE (`event: message` + one data frame).
  const t = (text || '').trim();
  if (!t) return null;
  if (t.startsWith('{') || t.startsWith('[')) return JSON.parse(t);
  for (const line of t.split('\n')) {
    if (line.startsWith('data:')) return JSON.parse(line.slice(5).trim());
  }
  return null;
}

async function forward(msg) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const r = await fetch(URL_, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(msg),
      signal: controller.signal,
    });
    const sid = r.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    if (r.status === 202) return null; // accepted notification — no body
    const body = await r.text();
    return parseBody(body);
  } finally {
    clearTimeout(timer);
  }
}

function write(obj) {
  if (obj == null) return;
  process.stdout.write(JSON.stringify(obj) + '\n');
}

let buf = '';
let pending = 0;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (_e) {
      continue; // not JSON-RPC — ignore, never crash the host
    }
    pending += 1;
    forward(msg)
      .then((reply) => write(reply))
      .finally(() => { pending -= 1; })
      .catch((e) => {
        if (msg && msg.id !== undefined && msg.id !== null) {
          write({
            jsonrpc: '2.0',
            id: msg.id,
            error: {
              code: -32001,
              message: 'DC Hub bridge transport error: '
                + String(e && e.message ? e.message : e).slice(0, 140)
                + ' — check your network; the hosted server is at '
                + URL_,
            },
          });
        }
      });
  }
});
process.stdin.on('end', () => {
  // Drain in-flight forwards before exiting (host closed stdin) — an
  // immediate exit would swallow replies already on the wire.
  const drain = setInterval(() => {
    if (pending === 0) { clearInterval(drain); process.exit(0); }
  }, 50);
  setTimeout(() => process.exit(0), 130000); // hard stop past the fetch timeout
});
