// list-slim.mjs - R1 (Grok MCP platform ranking plan, 2026-10-18): shrink what tools/list
// ADVERTISES on the wire without changing what the server VALIDATES or RETURNS.
//
// Measured on live /mcp 2026-10-18: 485,513 bytes = outputSchema 202,533 + inputSchema 74,153 +
// descriptions 101,634 (+ names, annotations, _meta). Glama scored conciseness 2/5.
//
// What changes, per tool (a copy is returned; the registered schemas the SDK validates against are
// never touched, so no real payload can start failing):
//   outputSchema  -> top-level keys with their primitive `type` only (nested shape, descriptions and
//                    union arms dropped). Still `type: object`, still loose, still 2020-12 clean. The seven
//                    envelope keys every tool shares (WIRE_ENVELOPE_KEYS) are omitted from this copy.
//   description   -> dated change-log sentences removed (the sentence that starts a withdrawn/restored/
//                    contract-added note), then cut at a sentence end to SLIM_DESC_MAX.
//   _meta         -> the `cloud.dchub/access` mirror dropped (byte-for-byte the same four keys already in
//                    annotations; the comment at its writer says annotations are the surface UIs read).
//   annotations   -> `free_answer` dropped (one of three fixed sentences repeated on every tool; the
//                    initialize instructions and claim flow already state the free allowance).
//   annotations   -> `upgrade_relay` dropped (P1-6: the same 205-character sentence on all 28 gated tools; the
//                    gated result carries the caller's link in its Tell the user / For your human line and
//                    the initialize instructions say so). pricing_url and connect_url stay: UIs read them.
//   annotations.title (== top-level title) and execution {taskSupport:'forbidden'} (the default) dropped.
//   inputSchema   -> property descriptions cut to SLIM_PARAM_DESC_MAX at a sentence/word boundary.
//                    Names, types, enums, required and defaults are untouched.
// Not applied to: the directory profiles (their own projections), /mcp/grok (own profile).

export const SLIM_DESC_MAX = 1300;
export const SLIM_PARAM_DESC_MAX = 240;

// P1-6 (2026-10-18): tools whose slimmed description ends in a pointer to the full text, served as the
// resource dchub://tool-guides/<tool> (read live from the registered description, so it cannot drift).
// Add a name here only after checking its profile pins; the pointer counts against SLIM_DESC_MAX.
export const TOOL_GUIDE_TOOLS = new Set(['plan_query', 'get_grid_scoreboard']);
export const toolGuideUri = (name) => `dchub://tool-guides/${name}`;
export const toolGuidePointer = (name) => ` Full guide: read resource ${toolGuideUri(name)}`;

const DATE = /\b20\d\d-\d\d-\d\d\b/;
const CHANGELOG = /\b(WITHDRAWN|RESTORED|CHANGELOG|r-[a-z]+(?:-[a-z]+)+|CANDIDATE CONTRACT|SCORING MECHANICS)\b/;

function cut(text, max) {
  const d = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (d.length <= max) return d;
  const head = d.slice(0, max);
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.) '));
  if (stop >= max * 0.5) return head.slice(0, stop + 1);
  const sp = head.lastIndexOf(' ', max - 1);
  return (sp > 0 ? head.slice(0, sp) : head.slice(0, max - 1)) + '…';
}

// Shorten a protected sentence from its marker onward: begin at `Try: ` / `Answers "` so the example survives.
function cutKeeping(part, max) {
  const m = part.search(PROTECTED);
  const from = m > 0 ? part.slice(m) : part;
  return cut(from, max);
}

// Sentences that only narrate when something changed (a date stamp next to a change-log word).
export function stripChangelog(desc) {
  const s = String(desc == null ? '' : desc).replace(/\s+/g, ' ').trim();
  const parts = s.split(/(?<=[.!?])\s+(?=[A-Z★(])/);
  if (parts.length < 2) return s;
  const kept = parts.filter((p, i) => i === 0 || !(DATE.test(p) && CHANGELOG.test(p)));
  return kept.join(' ');
}

// The two sentences an agent selects and copies from survive the cut: `Answers "..."` (WHEN to pick the
// tool, graded by the relay-closure shell) and `Try: ...` (a worked call). The body is shortened to make
// room for them rather than them being the part that falls off the end.
const SPLIT = /(?<=[.!?])\s+(?=[A-Z★(])/;
const PROTECTED = /Answers "|\bTry: /;
export function slimDescription(desc, max = SLIM_DESC_MAX) {
  const d = stripChangelog(desc);
  if (d.length <= max) return d;
  const parts = d.split(SPLIT);
  const keep = new Set();
  const PROT_MAX = 320;
  let room = max;
  for (let i = 0; i < parts.length; i++) {
    if (PROTECTED.test(parts[i])) {
      if (parts[i].length > PROT_MAX) parts[i] = cutKeeping(parts[i], PROT_MAX);
      keep.add(i); room -= parts[i].length + 1;
    }
  }
  if (!keep.size || room < max * 0.4) return cut(d, max);
  let used = 0;
  for (let i = 0; i < parts.length; i++) {
    if (keep.has(i)) continue;
    if (used + parts[i].length + 1 > room) break;
    keep.add(i); used += parts[i].length + 1;
  }
  return [...keep].sort((x, y) => x - y).map((i) => parts[i]).join(' ');
}

// The DC Hub envelope keys. Every tool's registered outputSchema declares all seven (server.mjs
// _ENVELOPE_SHAPE), so the wire list repeated seven bare-type stubs (`"provenance":{"type":"object"}`) on all
// 94 tools: 18.8 KB, 8% of tools/list, saying nothing a client can use beyond the key names. The registered
// schema the SDK validates against still has them, and the payloads still carry them; only this advertised
// copy omits them. They are described once in the initialize instructions and in every response. The
// tool-specific data keys stay, since those are what an outputSchema is for. Empty this list to put them back.
export const WIRE_ENVELOPE_KEYS = Object.freeze(['_entity', 'provenance', 'quota', 'citation',
  'site_evaluation_handoff', '_return_loop', '_front_door']);
const ENVELOPE = new Set(WIRE_ENVELOPE_KEYS);

export function slimOutputSchema(schema) {
  const out = { type: 'object', additionalProperties: true };
  const props = schema && typeof schema === 'object' && schema.properties;
  if (props && typeof props === 'object') {
    out.properties = {};
    for (const [k, v] of Object.entries(props)) {
      if (ENVELOPE.has(k)) continue;
      const t = v && typeof v === 'object' && typeof v.type === 'string' ? v.type : null;
      out.properties[k] = t ? { type: t } : {};
    }
  }
  return out;
}

function slimParams(schema) {
  if (!schema || typeof schema !== 'object' || !schema.properties) return schema;
  const properties = {};
  for (const [k, v] of Object.entries(schema.properties)) {
    properties[k] = v && typeof v === 'object' && typeof v.description === 'string'
      ? { ...v, description: cut(v.description, SLIM_PARAM_DESC_MAX) } : v;
  }
  return { ...schema, properties };
}

export function slimTool(t) {
  const guide = TOOL_GUIDE_TOOLS.has(t.name);
  const ptr = guide ? toolGuidePointer(t.name) : '';
  const out = { ...t, description: guide ? slimDescription(t.description, SLIM_DESC_MAX - ptr.length) + ptr : slimDescription(t.description), inputSchema: slimParams(t.inputSchema) };
  if (t._meta && 'cloud.dchub/access' in t._meta) {
    const { 'cloud.dchub/access': _a, ...rest } = t._meta;
    if (Object.keys(rest).length) out._meta = rest; else delete out._meta;
  }
  if (t.annotations && ('free_answer' in t.annotations || 'upgrade_relay' in t.annotations || t.annotations.title === t.title)) {
    const { free_answer: _f, upgrade_relay: _u, ...rest } = t.annotations;
    if (rest.title === t.title) delete rest.title;   // the top-level title says it already
    out.annotations = rest;
  }
  // taskSupport "forbidden" is the spec default; restating it on every tool is dead weight.
  if (t.execution && Object.keys(t.execution).length === 1 && t.execution.taskSupport === 'forbidden') delete out.execution;
  if (t.outputSchema) out.outputSchema = slimOutputSchema(t.outputSchema);
  return out;
}

export function slimToolsList(result) {
  if (!result || !Array.isArray(result.tools)) return result;
  return { ...result, tools: result.tools.map(slimTool) };
}
