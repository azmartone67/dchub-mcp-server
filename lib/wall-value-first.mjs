// lib/wall-value-first.mjs — a walled answer opens with its value, in at most three lines (owner 2026-11-21, item 2).
//
// WHY. A keyless wall's content[0] was the full JSON object (6-8 KB on get_energy_prices / get_market_dcpi_rank), so
// the dated headline, what was withheld and the link sat deep inside it or in later blocks.
//
// WHAT (behind DCHUB_WALL_VALUE_FIRST, default OFF; on only for 1 / true / yes / on; NOT DCHUB_WALL_COPY_V2, which it
// runs under and whose rules its lines keep). server.mjs _valueFirstStep, the LAST rewrite of a gated answer:
//   content[0] = at most three lines
//     "<dated headline> (DC Hub, as of <date>)."      (a live-feed figure says "collected <date>"; an undated figure
//                                                     is never shown: no headline line)
//     "Withheld here: <field list>."                 (lib/withheld-copy.mjs, the same list the relay page and the
//                                                     licence block read)
//     "See the full answer: <human_url>"
//   and the answer's JSON moves to content[1] (structuredContent is unchanged), the pattern execute_plan already uses
//   (lib/plan-lead-text.mjs). An answer whose block 0 is prose and block 1 JSON (execute_plan) keeps its JSON in
//   block 1: the lines open block 0, ahead of its own lead.
// It also fixes two promises the wall made that its link could not keep (the third and fourth fixes are in
// lib/withheld-copy.mjs):
//   (a) "with an email it gets the full answer" on an answer whose withheld fields an email does not open
//       (get_market_dcpi_rank: the DCPI sub-scores; its relay page sells a paid plan) -> the licence clause;
//   (b) "this session's next <tool> call" beside a link that is not bound to the session -> "the next <tool> call
//       made with that key".
// No plan name, no price, no "free". Pure: no ctx, no network.
import { WITHHELD_HERE_LABEL, withheldLine } from './withheld-copy.mjs';

export const WALL_VALUE_FIRST_FLAG = 'DCHUB_WALL_VALUE_FIRST';
export function wallValueFirstOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[WALL_VALUE_FIRST_FLAG]) || '').trim());
}

export const SEE_FULL_LEAD = 'See the full answer: ';
export const VALUE_FIRST_MAX_LINES = 3;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (b) => b && b.type === 'text' && typeof b.text === 'string';
const isJsonText = (b) => isText(b) && /^\s*[{[]/.test(b.text);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const LABELS = { demand_mw: 'demand', queued_generation_gw: 'queued generation', retail_rate_cents_kwh: 'retail electricity rate' };

// { text, when } for the answer's own dated headline, or null. Only figures the answer already states, each with the
// date the answer gives it: taste.headline (as_of, else collected_at), a DCPI market row (verdict + composite +
// computed_at), analyze_site's market verdict (as_of), execute_plan's fact_header SUMMARY (AS_OF).
export function headlineOf(sc, { iso = '' } = {}) {
  if (!isObj(sc)) return null;
  const t = isObj(sc.taste) && isObj(sc.taste.headline) ? sc.taste.headline : null;
  if (t && num(t.value) && t.name) {
    const when = day(t.as_of) ? 'as of ' + day(t.as_of) : (day(t.collected_at) ? 'collected ' + day(t.collected_at) : '');
    if (!when) return null;
    const where = typeof iso === 'string' && /^[A-Za-z]{2,8}$/.test(iso.trim()) ? iso.trim().toUpperCase() + ' ' : '';
    const pc = isObj(sc.taste.project_count) && num(sc.taste.project_count.value) ? sc.taste.project_count.value : null;
    const label = LABELS[t.name] || String(t.name).replace(/_/g, ' ');
    return { text: where + label + ' ' + t.value.toLocaleString('en-US') + (t.unit ? ' ' + t.unit : '')
      + (pc !== null ? ' across ' + pc.toLocaleString('en-US') + ' active projects' : ''), when };
  }
  if (typeof sc.verdict === 'string' && /^(BUILD|CAUTION|AVOID)$/.test(sc.verdict) && typeof sc.market_name === 'string'
    && day(sc.computed_at)) {
    return { text: sc.market_name + ' Data Center Power Index (DCPI) verdict ' + sc.verdict
      + (num(sc.composite_score) ? ', composite ' + sc.composite_score : ''), when: 'as of ' + day(sc.computed_at) };
  }
  const mv = isObj(sc.market_verdict) ? sc.market_verdict : null;
  if (mv && typeof mv.verdict === 'string' && /^(BUILD|CAUTION|AVOID)$/.test(mv.verdict) && typeof mv.market === 'string' && day(mv.as_of)) {
    const pb = isObj(sc.preview_bands) && typeof sc.preview_bands.verdict === 'string' ? sc.preview_bands.verdict : '';
    return { text: (pb ? 'Site infrastructure verdict ' + pb + '; ' : '') + 'market verdict for ' + mv.market + ' ' + mv.verdict,
      when: 'as of ' + day(mv.as_of) };
  }
  // A facility list (search_facilities, _entity 'facility'): the first row the answer shows, by name and operator, and
  // how many more it shows. Dated by the OLDEST as_of among the shown rows (each row's own citable date, as the
  // backend sets it; server.mjs _FACILITY_FREE_FIELDS), so the date never overstates any row. No row date: no line.
  // It never states a registry total (the answer's count is cut by limit; total_matching is null on a preview).
  if (sc._entity === 'facility' && Array.isArray(sc.data) && sc.data.length) {
    const rows = sc.data.filter((r) => isObj(r) && typeof r.name === 'string' && r.name.trim());
    const dates = rows.map((r) => day(r.as_of)).filter(Boolean).sort();
    if (rows.length && dates.length === rows.length) {
      const f = rows[0];
      const op = typeof f.provider === 'string' && f.provider.trim() ? f.provider.trim()
        : (typeof f.operator === 'string' && f.operator.trim() ? f.operator.trim() : '');
      const more = rows.length - 1;
      return { text: f.name.trim() + (op ? ' (' + op + ')' : '')
        + (more > 0 ? ' and ' + more + ' more ' + (more === 1 ? 'facility' : 'facilities') + ' shown' : ''),
      when: 'as of ' + dates[0] };
    }
  }
  const fh = typeof sc.fact_header === 'string' ? sc.fact_header : '';
  const sm = /SUMMARY: ([^\n]+)/.exec(fh);
  const ao = /AS_OF: (\d{4}-\d{2}-\d{2})/.exec(fh);
  if (sm && ao) return { text: sm[1].trim().replace(/\s*\|\s*/g, '; ').replace(/\.$/, ''), when: 'as of ' + ao[1] };
  return null;
}

// The at-most-three lines.
export function valueFirstLines({ headline = null, fields = [], link = '' } = {}) {
  const lines = [];
  if (headline && headline.text && headline.when) lines.push(headline.text + ' (DC Hub, ' + headline.when + ').');
  const w = withheldLine(fields, WITHHELD_HERE_LABEL);
  if (w) lines.push(w);
  if (typeof link === 'string' && /^https:\/\/dchub\.cloud\//.test(link)) lines.push(SEE_FULL_LEAD + link);
  return lines.slice(0, VALUE_FIRST_MAX_LINES);
}

// content[0] = the lines; the JSON block 0 moves to content[1]. A prose block 0 with a JSON block 1 keeps the JSON
// where it is and opens block 0 with the lines. Never twice.
export function withValueFirst(result, lines) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content) || !result.content.length) return result;
  if (!Array.isArray(lines) || !lines.length) return result;
  const lead = lines.join('\n');
  const c = result.content;
  if (isText(c[0]) && c[0].text.startsWith(lead)) return result;
  if (!isJsonText(c[0]) && isJsonText(c[1]) && isText(c[0])) {
    return { ...result, content: [{ ...c[0], text: lead + '\n\n' + c[0].text }, ...c.slice(1)] };
  }
  return { ...result, content: [{ type: 'text', text: lead }, ...c] };
}

// (a) the email clause where an email does not open the withheld fields.
export const LICENCE_CLAUSE = '; the withheld fields come with a DC Hub licence, not with an email';
const EMAIL_FULL_CLAUSE_RE = /; with an email it gets the full answer/g;
// (b) a session promise beside a link the session does not carry.
const SESSION_NEXT_RE = /this session(?:’|')s next (`?[a-z_]+`?) call/g;

function deepStr(v, f, d = 0) {
  if (typeof v === 'string') return f(v);
  if (d > 8 || !v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => deepStr(x, f, d + 1));
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = deepStr(x, f, d + 1);
  return o;
}
function mapStrings(result, f) {
  const content = result.content.map((b) => {
    if (!isText(b)) return b;
    if (isJsonText(b)) {
      try { return { ...b, text: JSON.stringify(deepStr(JSON.parse(b.text), f)) }; } catch (_) { /* in place */ }
    }
    return { ...b, text: f(b.text) };
  });
  const sc = isObj(result.structuredContent) ? deepStr(result.structuredContent, f) : result.structuredContent;
  return { ...result, content, ...(sc !== undefined ? { structuredContent: sc } : {}) };
}
// opts: { emailOpens: an email opens this answer's withheld fields; sessionBound: the human link is bound to the
// session }. Returns the result unchanged when no promise needs fixing.
export function withHonestPromises(result, { emailOpens = true, sessionBound = false } = {}) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
  const s = JSON.stringify(result);
  const fixEmail = !emailOpens && EMAIL_FULL_CLAUSE_RE.test(s);
  EMAIL_FULL_CLAUSE_RE.lastIndex = 0;
  const fixSession = !sessionBound && SESSION_NEXT_RE.test(s);
  SESSION_NEXT_RE.lastIndex = 0;
  if (!fixEmail && !fixSession) return result;
  return mapStrings(result, (t) => {
    let x = t;
    if (fixEmail) x = x.replace(EMAIL_FULL_CLAUSE_RE, LICENCE_CLAUSE);
    if (fixSession) x = x.replace(SESSION_NEXT_RE, (_m, tool) => 'the next ' + tool + ' call made with that key');
    return x;
  });
}
