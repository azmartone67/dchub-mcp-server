// plan-permit-check.mjs — the local-restriction check a siting plan carries (Grok head-to-head 2026-11-25, L2).
//
// "land for 100 MW in Ohio with any local restrictions" ran find_sites, headroom, the queue, feeders and the pipeline,
// and no permitting read: "restrictions" alone is not the permitting class's wording (lib/permitting-answer.mjs reads
// "restrictions on data centers"), and only a site hunt with a moratorium word added the read (5.61).
//
//   * permitCheckStep: a plan whose text names a restriction, moratorium, zoning or a permit, or that runs find_sites,
//     reads get_permitting_intel {state} for the plan's state, once (never beside a permitting read it already has,
//     never on the permitting or air-permit classes, which read their own records). get_permitting_intel takes no
//     county, so a county the question names is not passed. A find_sites plan with no US state adds nothing (a
//     nationwide record list says nothing about the areas found); a plan whose text asked adds the US-wide read.
//   * permitCheckLine: the line the answer carries from that read: the records on file for the state (up to three,
//     each with its stage and source date), or "No <ST> permitting record on file in DC Hub ...".
// Pure; nothing here throws. No plan name, no price.

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim()) ? v.trim().slice(0, 10) : null);

export const PERMIT_WORD_RE = /\brestrict(?:ion|ions|ed|ive)?\b|\bmoratori(?:um|ums|a)\b|\bzon(?:ing|ed)\b|\bpermit(?:s|ting|ted)?\b/i;
const SKIP_CLASSES = new Set(['permitting', 'air_permits']);
export const PERMIT_SHOWN = 3;

/** The get_permitting_intel step to append, or null. seq: the plan's steps so far; state: the plan's US state. */
export function permitCheckStep(text, seq, clsId, state) {
  try {
    const steps = Array.isArray(seq) ? seq : [];
    if (SKIP_CLASSES.has(clsId)) return null;
    if (steps.some((s) => s && s.tool === 'get_permitting_intel')) return null;
    const asked = PERMIT_WORD_RE.test(String(text || '').slice(0, 2000));
    const land = steps.some((s) => s && s.tool === 'find_sites');
    if (!asked && !land) return null;
    const st = typeof state === 'string' && /^[A-Z]{2}$/.test(state) ? state : null;
    if (!st && !asked) return null;
    return { tool: 'get_permitting_intel', depends_on: [], estimated_calls: 1, permit_check: true,
      why: `Local restrictions on data centers${st ? ` in ${st}` : ' across the US'}: published moratorium, zoning and other`
        + ' permitting records (jurisdiction, stage, source date). Only an enacted local one bars a site. Independent; runs in parallel.',
      args_hint: st ? { state: st } : {} };
  } catch (_e) { return null; }
}

function parsed(v) {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}
function rowText(r) {
  const j = one(r.jurisdiction) || one(r.title) || 'an unnamed jurisdiction';
  const st = one(r.state);
  const sd = one(r.as_of_basis).toLowerCase() === 'unknown' ? null : day(r.as_of);
  const inner = [one(r.class) || one(r.type), one(r.stage), sd ? `source date ${sd}` : 'no source date'].filter(Boolean).join(', ');
  return `${j}${st && !j.endsWith(`, ${st}`) ? `, ${st}` : ''} (${inner})`;
}

/** { line, as_of, step } from the plan's permit-check read, or null when it did not run. */
export function permitCheckLine(executed, fullByEntry) {
  try {
    const e = (Array.isArray(executed) ? executed : []).find((x) => x && x.tool === 'get_permitting_intel'
      && (x.status === 'executed' || x.status === 'gated_preview') && !(isObj(x.args) && x.args.class));
    if (!e) return null;
    const p = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    if (!p) return null;
    const st = one(isObj(e.args) ? e.args.state : '').toUpperCase();
    const rows = (Array.isArray(p.records) ? p.records : []).filter(isObj);
    const count = num(p.count) ?? rows.length;
    const asOf = day(p.as_of);
    let line;
    if (!count) {
      line = `No ${st || 'US'} permitting record on file in DC Hub (get_permitting_intel: published moratorium, zoning and other`
        + ` local restriction records${asOf ? `, as of ${asOf}` : ''}); that is DC Hub's record set, not a local permit check.`;
    } else {
      const top = rows.slice(0, PERMIT_SHOWN);
      line = `${count.toLocaleString('en-US')} ${st || 'US'} permitting record${count === 1 ? '' : 's'} on file in DC Hub (get_permitting_intel)`
        + (top.length ? `: ${top.map(rowText).join('; ')}${count > top.length ? ` (and ${(count - top.length).toLocaleString('en-US')} more)` : ''}` : '')
        + '. Only an enacted local moratorium bars a site.';
    }
    return { line, as_of: asOf, step: e.step };
  } catch (_e) { return null; }
}

/** The answer with the permit line after its headline and in its evidence. A new minimal answer when there was none. */
export function withPermitLine(answer, pl) {
  try {
    if (!pl || !pl.line) return answer;
    if (!isObj(answer)) {
      return { kind: 'permit_check', headline: pl.line, verdict: null, evidence: [pl.line], not_established: [],
        as_of: pl.as_of || null, permit_check: pl.line, source: 'Source: DC Hub (dchub.cloud) permitting intel.' };
    }
    const head = one(answer.headline);
    if (head.includes(pl.line)) return answer;
    const ev = Array.isArray(answer.evidence) ? answer.evidence : [];
    return { ...answer, headline: head ? `${head} ${pl.line}` : pl.line,
      evidence: ev.includes(pl.line) ? ev : [...ev, pl.line], permit_check: pl.line };
  } catch (_e) { return answer; }
}
