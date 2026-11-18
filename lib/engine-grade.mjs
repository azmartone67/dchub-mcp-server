// engine-grade.mjs -- the rubric for the daily MCP self-improvement engine (scripts/engine-bench.mjs).
//
// WHY. On 2026-11-17 an outside head-to-head lost DC Hub the cross-domain set on answer writing, not on data:
// a 50 MW / 24-month US question routed to the queue class and led with a step count, and a Northern Virginia
// answer said "no figure" for PJM while facts[] held a PJM figure. Nothing in this repo graded the lead an
// agent actually reads. This file does, from the caller's seat, one check per thing that head-to-head scored.
//
// Rules it keeps (the same four as dchub-backend tools/qa_superuser/finding.py):
//   - BLIND is not RED: a walled, errored or unparseable answer is unobserved and never scores.
//   - Every check states the condition that makes it RED (red_when), and the tests prove each one can fire.
//   - A check that does not apply to a question is NA, never a free PASS.
//   - Evidence quotes what came back on the wire (the lead, structuredContent.facts[]), not what the code says.
// Pure: no network, no clock. Exported for test/engine-grade.test.mjs.

export const PASS = 'PASS';
export const RED = 'RED';
export const NA = 'NA';
export const BLIND = 'BLIND';

export const CHECKS = {
  routing: 'intent_class is outside the question\'s classes, or inside its not_classes',
  names_place: 'a place group has no hit in the lead, or fewer than open_places_min distinct US places are named',
  figure_as_of: 'the lead carries no figure (beyond dates, years and numbers copied from the question) or no as-of date',
  dc_side: 'no lead sentence pairs a data-center word (facilities, colocation, operators, vacancy...) with a figure',
  energy_side: 'no lead sentence pairs an energy metric (cents/kWh, price, demand, queue, headroom...) with a figure',
  no_lookup_lead: 'the lead opens with a step count ("DC Hub ran N lookups") instead of an answer',
  grounded: 'a figure in the lead (10 or more, not a date, year or question number) is in no structuredContent.facts[] text',
  no_contradiction: 'the lead says "no figure / no data" for a place or grid that has a numeric fact in facts[]',
};

const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// US places the open "where" questions may name: ISOs, states and data-center metros. Kept to names an answer
// would print; a place missing here only under-counts (open_places_min goes RED), it never passes a bad lead.
export const US_PLACES = [
  'PJM', 'ERCOT', 'MISO', 'CAISO', 'SPP', 'NYISO', 'ISO-NE', 'TVA', 'BPA',
  'Alabama', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Georgia', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska',
  'Nevada', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
  'Pennsylvania', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming',
  'Northern Virginia', 'Ashburn', 'Loudoun', 'Dallas', 'Fort Worth', 'Houston', 'San Antonio', 'Austin', 'Abilene',
  'Phoenix', 'Atlanta', 'Chicago', 'Columbus', 'New Albany', 'Silicon Valley', 'Santa Clara', 'San Jose',
  'Hillsboro', 'Portland', 'Quincy', 'Reno', 'Las Vegas', 'Salt Lake City', 'Denver', 'Omaha', 'Council Bluffs',
  'Des Moines', 'Kansas City', 'Minneapolis', 'Charlotte', 'Richmond', 'Memphis', 'Nashville', 'New Jersey',
  'Los Angeles', 'Seattle', 'Boston', 'Miami', 'Pittsburgh', 'Cheyenne',
];

const DC_WORDS = /\b(data[- ]cent(?:er|re)s?|facilit(?:y|ies)|colocation|colo|operators?|providers?|campus(?:es)?|vacancy|absorption|PeeringDB|networks?|carriers?|kW|DCPI|hyperscale|listings?|leasing|white space)\b/i;
// Energy side needs a metric word, not just a grid name: "412 data centers, all on PJM" is not an energy figure.
// Grid and utility names count toward names_place instead.
const ENERGY_WORDS = /(cents?\/kWh|¢\/kWh|\/MWh|\bMWh\b|\bGW\b|\b(?:electricity|power prices?|prices?|retail rates?|rates?|tariffs?|demand|load|queue|interconnection|headroom|gas|Henry Hub|fuel mix|substations?|transmission|generation|reserve margin|time[- ]to[- ]power)\b)/i;
const LOOKUP_LEAD = /(\bran \d+ (?:DC Hub )?lookups?\b|^\s*DC Hub ran\b)/i;
const DATE = /\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g;
const AS_OF = /(\b\d{4}-\d{2}-\d{2}\b|\bas of (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b)/i;
// A number after "/" is a scale ("DCPI 42/100"), not a figure.
const NUM = /(?<![\w./])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.,/])\d+(?:\.\d+)?/g;
// Words a "no figure for X" phrase can capture that are not places.
const NOT_ENTITY = new Set(['DC', 'Hub', 'The', 'This', 'That', 'No', 'It', 'Your', 'Some', 'A', 'An', 'Source', 'Full']);

/** The answer part of content[0].text: everything before the source/JSON boilerplate. */
export function leadOf(msg) {
  const r = (msg && msg.result) || {};
  const t = (r.content && r.content[0] && r.content[0].text) || '';
  const cut = t.search(/\bSource: DC Hub\b|\bFull answer:/);
  return (cut >= 0 ? t.slice(0, cut) : t).trim();
}

/** Figures in a text as numbers: dates removed, years 1990-2039 dropped. */
export function figuresIn(text) {
  const s = String(text || '').replace(DATE, ' ');
  const out = [];
  for (const m of s.matchAll(NUM)) {
    const raw = m[0];
    const v = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(v)) continue;
    if (!raw.includes('.') && !raw.includes(',') && v >= 1990 && v <= 2039) continue;
    out.push({ raw, v });
  }
  return out;
}

function sentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+|\n+|;\s+/).map((x) => x.trim()).filter(Boolean);
}

function hasWord(text, word) {
  return new RegExp(`(?<![\\w-])${ESC(word)}(?![\\w-])`, 'i').test(text);
}

function factTexts(sc) {
  return (Array.isArray(sc.facts) ? sc.facts : []).map((f) => `${f.text || ''} ${f.entity || ''}`.trim());
}

/** Why an answer cannot be graded, or null when it can. */
export function blindReason(msg) {
  if (!msg) return 'no JSON-RPC body';
  if (msg.error) return `rpc error ${msg.error.code ?? ''} ${String(msg.error.message || '').slice(0, 80)}`.trim();
  const sc = (msg.result && msg.result.structuredContent) || {};
  if (sc.error === 'anon_hard_wall' || sc.binding_limit === 'anon_ip_daily_hard') return 'walled: anonymous daily limit on this IP';
  if (sc._entity !== 'plan_execution') return `not a plan_execution (${sc._entity || sc.error || 'no _entity'})`;
  if (!leadOf(msg)) return 'empty lead';
  return null;
}

/** Grade one execute_plan answer against its question. */
export function gradeAnswer(q, msg) {
  const row = { id: q.id, set: q.set, verdict: 'graded', checks: {} };
  const why = blindReason(msg);
  if (why) return { ...row, verdict: BLIND, blind_reason: why, points: 0, possible: 0 };
  const sc = msg.result.structuredContent;
  const lead = leadOf(msg);
  const facts = factTexts(sc);
  const executed = Array.isArray(sc.executed) ? sc.executed : [];
  Object.assign(row, {
    intent_class: sc.intent_class || null,
    planner_version: sc.planner_version || null,
    lead: lead.slice(0, 600),
    steps: { planned: executed.length, executed: executed.filter((e) => e.status === 'executed').length,
      not_executed: executed.filter((e) => e.status !== 'executed').map((e) => `${e.tool}:${e.status}`) },
    facts_count: facts.length,
  });
  const set = (k, status, evidence) => { row.checks[k] = evidence === undefined ? { status } : { status, evidence }; };

  // routing
  if ((q.classes && q.classes.length) || (q.not_classes && q.not_classes.length)) {
    const c = sc.intent_class || '';
    const bad = (q.classes && q.classes.length && !q.classes.includes(c)) || (q.not_classes || []).includes(c);
    set('routing', bad ? RED : PASS, `intent_class=${c || 'none'}`);
  } else set('routing', NA);

  // names_place
  const groups = q.place_groups || [];
  if (groups.length || q.open_places_min) {
    const missing = groups.filter((g) => !g.some((p) => hasWord(lead, p))).map((g) => g.join('|'));
    const named = [...new Set(US_PLACES.filter((p) => hasWord(lead, p)))];
    const short = q.open_places_min && named.length < q.open_places_min;
    const ev = [missing.length ? `missing: ${missing.join('; ')}` : null,
      q.open_places_min ? `named ${named.length}/${q.open_places_min}: ${named.slice(0, 8).join(', ') || 'none'}` : null]
      .filter(Boolean).join(' | ');
    set('names_place', missing.length || short ? RED : PASS, ev || 'all groups hit');
  } else set('names_place', NA);

  // figure_as_of
  const qNums = new Set(figuresIn(q.intent).map((f) => f.v));
  const leadFigs = figuresIn(lead).filter((f) => !qNums.has(f.v));
  if (q.require_figure === false) set('figure_as_of', NA);
  else {
    const asOf = AS_OF.test(lead);
    set('figure_as_of', leadFigs.length && asOf ? PASS : RED,
      `figures=${leadFigs.slice(0, 6).map((f) => f.raw).join(',') || 'none'} as_of=${asOf ? 'yes' : 'no'}`);
  }

  // dc_side / energy_side: a sentence with that side's words AND a figure
  const sents = sentences(lead);
  for (const [k, side, re] of [['dc_side', 'dc', DC_WORDS], ['energy_side', 'energy', ENERGY_WORDS]]) {
    if (!(q.sides || []).includes(side)) { set(k, NA); continue; }
    const hit = sents.find((s) => re.test(s) && figuresIn(s).some((f) => !qNums.has(f.v)));
    set(k, hit ? PASS : RED, hit ? hit.slice(0, 160) : 'no sentence pairs this side with a figure');
  }

  // no_lookup_lead
  const opening = lead.slice(0, 240);
  const lm = opening.match(LOOKUP_LEAD);
  set('no_lookup_lead', lm ? RED : PASS, lm ? opening.slice(0, 120) : undefined);

  // grounded: every lead figure of 10 or more is in some facts[] text
  const factNums = new Set(facts.flatMap((t) => figuresIn(t).map((f) => f.v)));
  const checkable = leadFigs.filter((f) => f.v >= 10 || f.raw.includes('.'));
  if (!checkable.length) set('grounded', NA);
  else {
    const loose = checkable.filter((f) => !factNums.has(f.v));
    const elsewhere = JSON.stringify(sc);
    set('grounded', loose.length ? RED : PASS, loose.length
      ? `not in facts[]: ${loose.map((f) => `${f.raw}${elsewhere.includes(f.raw.replace(/,/g, '')) ? ' (elsewhere in JSON)' : ''}`).join(', ')}`
      : `${checkable.length} figures found in facts[]`);
  }

  // no_contradiction: "no figure for X" while facts[] has a number about X
  const claims = [];
  for (const m of lead.matchAll(/\b[Nn]o (?:[\w-]+ ){0,3}?(?:figures?|data|numbers?|prices?|readings?|values?)\b[^.;]{0,40}?\b(?:for|in|on|from)\s+([A-Z][\w-]+(?:\s[A-Z][\w-]+)?)/g)) claims.push([m[0], m[1]]);
  for (const m of lead.matchAll(/\b([A-Z][A-Za-z-]{1,24})(?:'s)?\b[^.;]{0,30}?\b(?:no figure|no data|not available|unavailable|no reading)\b/g)) claims.push([m[0], m[1]]);
  const contra = [];
  for (const [phrase, ent] of claims) {
    const words = ent.split(/\s+/).filter((w) => !NOT_ENTITY.has(w));
    if (!words.length) continue;
    const name = words.join(' ');
    const f = facts.find((t) => hasWord(t, name) && figuresIn(t).length);
    if (f) contra.push(`"${phrase.slice(0, 80)}" vs fact "${f.slice(0, 100)}"`);
  }
  set('no_contradiction', contra.length ? RED : PASS, contra.length ? contra.join(' | ') : undefined);

  const st = Object.values(row.checks).map((c) => c.status);
  row.points = st.filter((s) => s === PASS).length;
  row.possible = st.filter((s) => s === PASS || s === RED).length;
  return row;
}

/** Grade a run: rows plus totals per set. answers is { [id]: JSON-RPC message | null }. */
export function gradeRun(questions, answers) {
  const rows = questions.map((q) => gradeAnswer(q, answers[q.id] ?? null));
  const totals = {};
  for (const r of rows) {
    const t = (totals[r.set] ||= { points: 0, possible: 0, graded: 0, blind: 0 });
    t.points += r.points; t.possible += r.possible;
    if (r.verdict === BLIND) t.blind += 1; else t.graded += 1;
  }
  const all = { points: 0, possible: 0, graded: 0, blind: 0 };
  for (const t of Object.values(totals)) for (const k of Object.keys(all)) all[k] += t[k];
  totals.all = all;
  const red_by_check = {};
  for (const r of rows) for (const [k, c] of Object.entries(r.checks || {})) if (c.status === RED) red_by_check[k] = (red_by_check[k] || 0) + 1;
  return { rows, totals, red_by_check };
}

/**
 * Day-over-day diff of two gradeRun results, per question and check.
 * regressed = PASS before, RED now (the engine's trigger for a brief or a draft PR);
 * recovered = RED before, PASS now; still_red = RED both days; new_red = RED now, unobserved before
 * (BLIND, NA or a new question), kept apart so a first sighting is never called a regression.
 */
export function diffRuns(prev, cur) {
  const index = (run) => new Map((run && run.rows ? run.rows : []).map((r) => [r.id, r]));
  const p = index(prev);
  const out = { regressed: [], recovered: [], still_red: [], new_red: [] };
  for (const r of cur.rows || []) {
    const before = p.get(r.id);
    for (const [k, c] of Object.entries(r.checks || {})) {
      const was = before && before.checks && before.checks[k] ? before.checks[k].status : null;
      const key = `${r.id}:${k}`;
      if (c.status === RED && was === PASS) out.regressed.push({ key, evidence: c.evidence });
      else if (c.status === RED && was === RED) out.still_red.push({ key, evidence: c.evidence });
      else if (c.status === RED) out.new_red.push({ key, evidence: c.evidence });
      else if (c.status === PASS && was === RED) out.recovered.push({ key });
    }
  }
  // Points over the questions both runs graded, so a --only run is not compared with a whole baseline.
  const both = (cur.rows || []).filter((r) => r.verdict !== BLIND && p.has(r.id) && p.get(r.id).verdict !== BLIND);
  const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  out.points = { compared: both.length, before: sum(both.map((r) => p.get(r.id)), 'points'),
    now: sum(both, 'points'), possible_now: sum(both, 'possible') };
  return out;
}
