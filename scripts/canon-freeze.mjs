// ============================================================================
// canon-freeze.mjs (2026-09-29) — owner-approved FROZEN canon keys.
//
// frz-canon-facility-floor (owner decision 2026-09-29): canon `facilities` is
// held at 24,900+ until the corroborated "r3" count lands. The live
// tracked-record count is inflated by ~8.9k scraped Cloudscene rows pending
// corroboration and kept rising (24,900+ -> 25,000+ on 2026-09-28).
//
// canonical/canon_frozen.json is the list. It is OWNER-EDITED, never written by
// a script, and nothing lifts a freeze automatically. The registry of record is
// dchub-backend data/agent_brief.json frozen[] (served at /api/v1/ops/brief).
//
// Rules, one place:
//   * refresh-canon-phrases.mjs holds a frozen key at its `value` and keeps
//     refreshing every other key;
//   * a frozen key is INTENTIONAL: canon floor checks report it and never fail
//     on it (ecosystem-sync's repoDrift skips it, so it does not dispatch a heal
//     every day for a difference that is on purpose);
//   * a malformed freeze file is LOUD (the refresh exits non-zero): silently
//     ignoring a freeze would un-freeze the key, the one direction that is
//     never acceptable.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FROZEN_FILE = path.join(ROOT, 'canonical', 'canon_frozen.json');

const isPhrase = (s) => typeof s === 'string' && /^\d[\d,]*\+$/.test(s);
const phraseInt = (s) => Number(String(s).replace(/[,+]/g, ''));
const REQUIRED_FIELDS = ['id', 'value', 'reason', 'since', 'lifts_when'];

/** Validate a parsed freeze document. PURE. Returns {frozen, bad}. */
export function parseFrozen(doc) {
  const bad = [];
  const frozen = {};
  if (doc == null) return { frozen, bad };
  const list = doc.frozen;
  if (list == null) return { frozen, bad };
  if (typeof list !== 'object' || Array.isArray(list)) return { frozen, bad: ['`frozen` is not an object'] };
  for (const [k, e] of Object.entries(list)) {
    const miss = REQUIRED_FIELDS.filter((f) => typeof e?.[f] !== 'string' || !e[f].trim());
    if (miss.length) { bad.push(`${k}: missing ${miss.join(', ')}`); continue; }
    if (!isPhrase(e.value)) { bad.push(`${k}: value ${JSON.stringify(e.value)} is not a floor phrase`); continue; }
    frozen[k] = { ...e };
  }
  return { frozen, bad };
}

/** Read canonical/canon_frozen.json. A MISSING file is "nothing frozen"; an
 *  unreadable or malformed one is reported in `bad`. */
export function readFrozen(file = FROZEN_FILE) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e?.code === 'ENOENT') return { frozen: {}, bad: [] };
    return { frozen: {}, bad: [`cannot read ${path.basename(file)}: ${e.message}`] };
  }
  try { return parseFrozen(JSON.parse(text)); } catch (e) {
    return { frozen: {}, bad: [`${path.basename(file)} is not JSON: ${e.message}`] };
  }
}

/** Hold every frozen key in a canon body. PURE.
 *  Returns {body, held}: `body` is a copy with each frozen key set to its
 *  value; `held` reports each one against what live said, for the log. */
export function applyFreeze(body, frozen) {
  const out = { ...(body || {}) };
  const held = [];
  for (const [k, e] of Object.entries(frozen || {})) {
    const live = body?.[k];
    out[k] = e.value;
    held.push({
      key: k, id: e.id, value: e.value, live: live ?? null,
      // live BELOW the frozen floor: the freeze now states more than live does.
      // Reported loudly, never failed — lifting or re-freezing is the owner's call.
      aboveLive: isPhrase(live) && phraseInt(e.value) > phraseInt(live),
    });
  }
  return { body: out, held };
}

/** One log line per held key; a ::warning:: when the freeze is above live. */
export function describeHeld(h, lifts) {
  const base = `FROZEN ${h.key} held at ${h.value} (live ${h.live ?? 'n/a'}) — ${h.id}`
    + (lifts ? `, lifts when ${lifts}` : '');
  return h.aboveLive
    ? `::warning::${base}. The frozen floor is ABOVE live: the owner should lift or re-freeze it.`
    : base;
}
