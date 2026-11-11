// plan-wall-sink.mjs — execute_plan's one email ask, and the step wall rows that carry it.
//
// Grok -> Brain 2026-11-10 (item 1), owner 2026-11-11 ("Yes, build it"): the funnel's no-ask walls since
// the 11-10 fixes included ai_capacity_index rows that were execute_plan steps. Every email-ask step
// skips a loopback step by design (the plan answer, not each step, talks to the agent), but the plan
// answer carried no ask either, so a plan whose steps walled asked for nothing and its step rows read
// email_ask none.
//
// Two halves:
//   1) the plan answer carries ONE ask when a step came back walled (server.mjs, the execute_plan
//      branch beside the caller-key _upgrade): a keyless caller is asked for the email through
//      claim_free_key {email} (planAnonEmailUpgrade); a no-email key already gets the bind_email line
//      (lib/siting-email-seat.mjs planCallerKeyUpgrade), which is now marked as the ask it is;
//   2) the steps' wall rows wait in a per-plan sink and leave once the plan's final answer is known,
//      marked with the ask that answer carried (never one it did not carry). A step reaches its plan's
//      sink only through a single-use in-process id (header PLAN_WALL_SINK_HEADER, loopback peer only),
//      so no outside request can park rows in it. A sink nobody drains sends its rows anyway after
//      SINK_FALLBACK_MS: a row is never lost, at worst it carries the step's own ask.
//
// Kill switch DCHUB_PLAN_EMAIL_ASK=0: no plan ask, no sink (step rows leave from the step, as before).
import { randomUUID } from 'node:crypto';
import { SESSIONLESS_EMAIL_ASK_LEAD, EMAIL_ASK, claimHandoffFreekeyText } from './claim-handoff.mjs';

export const PLAN_WALL_SINK_HEADER = 'x-dchub-plan-wall-sink';
export const SINK_FALLBACK_MS = 60000;
const MAX_SINKS = 5000;

export function planEmailAskOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_PLAN_EMAIL_ASK) || '').trim());
}

// The walled steps as the envelope names them: "step 2 (ai_capacity_index)".
function _named(walled) {
  return walled.map((w) => 'step ' + Number(w.step) + ' (' + w.tool + ')').join(', ');
}
function _clean(walledSteps) {
  return (Array.isArray(walledSteps) ? walledSteps : [])
    .filter((w) => w && Number.isFinite(Number(w.step)) && typeof w.tool === 'string');
}

// The ask as a prose paragraph (11-11, after mcp#1356 went live): the lean step (lib/lean-response.mjs)
// shrinks _upgrade to its machine fields, so on /mcp the _upgrade message never reached the agent, and
// the live plan answer carried no ask. Lean keeps a paragraph that carries EMAIL_ASK (the grid / queue
// wall's email ask), so the plan's ask is that paragraph, in its own text block, naming the walled
// steps. keyed: the caller holds a key with no email (bind_email {api_key, email}); otherwise the
// in-chat keyless form (bind_email with no key returns an email-bound key; claim_free_key fallback).
// One line, no blank line inside (lean splits paragraphs on blank lines). No plan name, no price.
export const PLAN_ASK_LEAD = 'Steps that came back as a preview:';
export function planAskParagraph(walledSteps, { keyed = false } = {}) {
  const walled = _clean(walledSteps);
  if (!walled.length) return null;
  const ask = keyed
    ? EMAIL_ASK + ' Only use an address they gave you: `bind_email` {api_key, email} binds it to this key, free.'
    : claimHandoffFreekeyText();
  return (PLAN_ASK_LEAD + ' ' + _named(walled) + '. ' + ask).replace(/\n+/g, ' ');
}

// A keyless caller's plan with at least one walled step: one line asking for the human's email, through
// claim_free_key {email} (an email-bound key; the next plan runs every step under it). null when no step
// walled. No plan name, no price.
export function planAnonEmailUpgrade(walledSteps) {
  const walled = _clean(walledSteps);
  if (!walled.length) return null;
  return {
    tier: 'anonymous',
    message: 'Came back as a preview: ' + _named(walled) + '. ' + SESSIONLESS_EMAIL_ASK_LEAD
      + ', and send the key it returns as the X-API-Key header: the next plan runs every step under that key. '
      + 'If they prefer not to give an email, call `claim_free_key` without one.',
    next_tool: 'bind_email',
    walled_steps: walled.map((w) => ({ step: Number(w.step), tool: w.tool })),
  };
}

// Whether the FINAL plan answer still carries the email ask: the plan's ask paragraph in a prose text
// block (what /mcp delivers after the lean step), or, where nothing leaned it, an _upgrade that names
// bind_email or claim_free_key and asks for an email. Read off the result the agent receives, so an ask
// a later step dropped is never credited. A step's own copy inside block 0's JSON does not count.
export function planAnswerAsks(result) {
  try {
    if (!result || typeof result !== 'object') return false;
    const prose = (Array.isArray(result.content) ? result.content : [])
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string' && !/^\s*[{[]/.test(b.text));
    if (prose.some((b) => b.text.includes(PLAN_ASK_LEAD) && b.text.includes(EMAIL_ASK))) return true;
    const ups = [];
    if (result.structuredContent && typeof result.structuredContent === 'object') ups.push(result.structuredContent._upgrade);
    try { const p = JSON.parse(result.content[0].text); if (p && typeof p === 'object') ups.push(p._upgrade); } catch (_) { /* no JSON block */ }
    return ups.some((u) => u && typeof u === 'object' && (u.next_tool === 'bind_email' || u.next_tool === 'claim_free_key')
      && typeof u.message === 'string' && /\bemail\b/.test(u.message));
  } catch (_) { return false; }
}

// ── the sink ─────────────────────────────────────────────────────────────────
// id -> { rows: [{ c, e }], timer, tokens: Set }. `send(c, e)` is the caller's own row sender.
export function createPlanWallSink({ send, fallbackMs = SINK_FALLBACK_MS } = {}) {
  const sinks = new Map();
  const tokens = new Map();   // single-use step token -> sink id

  function _sendAll(id, mark) {
    const s = sinks.get(id);
    if (!s) return 0;
    sinks.delete(id);
    try { if (s.timer) clearTimeout(s.timer); } catch (_) { /* ignore */ }
    for (const t of s.tokens) tokens.delete(t);
    let n = 0;
    for (const r of s.rows) {
      try { if (mark) mark(r.c); } catch (_) { /* a mark never stops a row */ }
      try { send(r.c, r.e); n += 1; } catch (_) { /* telemetry never throws */ }
    }
    return n;
  }

  return {
    open() {
      if (sinks.size > MAX_SINKS) for (const id of [...sinks.keys()].slice(0, 100)) _sendAll(id, null);
      const id = randomUUID();
      const s = { rows: [], tokens: new Set(), timer: null };
      s.timer = setTimeout(() => _sendAll(id, null), fallbackMs);
      if (s.timer && typeof s.timer.unref === 'function') s.timer.unref();
      sinks.set(id, s);
      return id;
    },
    // One token per step call; the step's request turns it back into the sink id once.
    mintStepToken(id) {
      const s = sinks.get(id);
      if (!s) return null;
      const t = randomUUID() + randomUUID();
      tokens.set(t, id);
      s.tokens.add(t);
      return t;
    },
    consumeStepToken(t) {
      if (typeof t !== 'string' || !t) return null;
      const id = tokens.get(t);
      if (id === undefined) return null;
      tokens.delete(t);
      return sinks.has(id) ? id : null;
    },
    // A step's parked row: true when the sink took it (the caller must not send it), false otherwise.
    park(id, c, e) {
      const s = id ? sinks.get(id) : null;
      if (!s) return false;
      s.rows.push({ c, e });
      return true;
    },
    // The plan is done: every row leaves, each marked by `mark(c)` (null: as the step left it).
    drain(id, mark) { return _sendAll(id, mark); },
    size: (id) => (sinks.get(id) ? sinks.get(id).rows.length : -1),
  };
}
