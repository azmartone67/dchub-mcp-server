// key-tool-name.mjs -- the key tool is listed as get_api_key (owner-approved 2026-11-17).
//
// WHY. "claim_free_key" put an allowance word in the one tool name every agent and directory reads. The listed name
// is now get_api_key; the old name keeps working for every agent, saved prompt and doc that already carries it.
//
// HOW (one handler, two names, one listed):
//   - server.mjs still REGISTERS the handler as claim_free_key. That name is what telemetry records (mcp_call_log,
//     /api/v1/mcp/track) and what the backend funnels count, and what every gating set in server.mjs keys on
//     (_OWN_TELL_TOOLS, ANON_WALL_EXEMPT, _TIER_BIND_SKIP, ...). Renaming the registration would have moved all of
//     them at once.
//   - tools/list on the canonical /mcp surfaces (bare /mcp, ?catalog=full, /mcp/oauth, /mcp/registry, the packs)
//     shows that entry as get_api_key with the title "Get API Key" (listKeyToolAs below). claim_free_key is no longer
//     listed there, so the listed count is unchanged (97).
//   - tools/call get_api_key resolves to claim_free_key through server.mjs TOOL_ALIASES, the same call-time path
//     every alias takes, so arguments, schema and result are the handler's own. tools/call claim_free_key keeps
//     working: it is the registered name, now unlisted.
//   - The directory profiles (/mcp/chatgpt, /mcp/claude) and /mcp/core project from the canonical (unrenamed) list
//     and keep their own allowlists; neither lists either name.
//
// Kill switch DCHUB_GET_API_KEY_LISTED=0: tools/list shows claim_free_key again (calls to either name still work).

export const KEY_TOOL_LISTED = 'get_api_key';
export const KEY_TOOL_REGISTERED = 'claim_free_key';
export const KEY_TOOL_TITLE = 'Get API Key';
export const KEY_TOOL_LISTED_FLAG = 'DCHUB_GET_API_KEY_LISTED';

export function keyToolListedOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env[KEY_TOOL_LISTED_FLAG]) || '').trim());
}

// The name an agent should be told to call.
export function keyToolName(env = process.env) {
  return keyToolListedOn(env) ? KEY_TOOL_LISTED : KEY_TOOL_REGISTERED;
}

// One tools/list entry, renamed (a new object; the input is not mutated).
export function asListedKeyTool(t) {
  if (!t || typeof t !== 'object' || t.name !== KEY_TOOL_REGISTERED) return t;
  const out = { ...t, name: KEY_TOOL_LISTED };
  if ('title' in t) out.title = KEY_TOOL_TITLE;
  if (t.annotations && typeof t.annotations === 'object') out.annotations = { ...t.annotations, title: KEY_TOOL_TITLE };
  return out;
}

// A served tools array: the registered key tool shows under its listed name, in the same position.
export function listKeyToolAs(tools, env = process.env) {
  if (!Array.isArray(tools) || !keyToolListedOn(env)) return tools;
  return listToolsPointerText(tools, env);
}

// A finished ListToolsResult ({tools, _meta?}): same shape, key tool renamed.
export function listResultKeyToolAs(result, env = process.env) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.tools)) return result;
  const tools = listKeyToolAs(result.tools, env);
  return tools === result.tools ? result : { ...result, tools };
}

// ── Pointers (2026-11-17) ───────────────────────────────────────────────────────────────────────────────────────
// Every agent-facing pointer at the key tool on the canonical surfaces names get_api_key: next_tool / tool /
// unlock_tool / next_call values, "call `claim_free_key`" prose, the initialize instructions and the instructions
// resource, and other tools' descriptions in tools/list. Dozens of writers in server.mjs and lib/ build those
// strings; this one projection at the edge of each surface sees all of them, so the writers keep their source text
// (and the registered handler keeps its name). Only a whole token is replaced, and never one inside a URL or a query
// value (preceded by = / & ? . or -) or a longer identifier (claim_free_key_tool stays). Object KEYS are not touched.
const POINTER_RE = /(?<![=/&?.\-A-Za-z0-9_])claim_free_key(?![A-Za-z0-9_])/g;

export function keyToolPointerText(s, env = process.env) {
  if (typeof s !== 'string' || !s || !keyToolListedOn(env) || !s.includes(KEY_TOOL_REGISTERED)) return s;
  return s.replace(POINTER_RE, KEY_TOOL_LISTED);
}

function _walk(v, env, depth = 0) {
  if (depth > 60 || v == null) return v;
  if (typeof v === 'string') return keyToolPointerText(v, env);
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((x) => { const y = _walk(x, env, depth + 1); if (y !== x) changed = true; return y; });
    return changed ? out : v;
  }
  if (typeof v !== 'object') return v;
  let changed = false;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    const y = _walk(x, env, depth + 1);
    if (y !== x) changed = true;
    out[k] = y;
  }
  return changed ? out : v;
}

// A tools/call result: every text block and every string value in structuredContent. `skip`: a directory or core
// profile (each scrubs the key tool out on its own), an execute_plan loopback step (its parent result is rewritten).
export function keyToolPointerStep(result, { skip = false, env = process.env } = {}) {
  try {
    if (skip || !keyToolListedOn(env) || !result || typeof result !== 'object') return result;
    let changed = false;
    let content = result.content;
    if (Array.isArray(content)) {
      const c2 = content.map((b) => {
        if (!b || b.type !== 'text' || typeof b.text !== 'string') return b;
        const t = keyToolPointerText(b.text, env);
        if (t === b.text) return b;
        changed = true;
        return { ...b, text: t };
      });
      if (changed) content = c2;
    }
    let sc = result.structuredContent;
    if (sc && typeof sc === 'object') {
      const s2 = _walk(sc, env);
      if (s2 !== sc) { sc = s2; changed = true; }
    }
    return changed ? { ...result, content, ...(result.structuredContent !== undefined ? { structuredContent: sc } : {}) } : result;
  } catch (_) { return result; }
}

// tools/list: the key tool renamed (listKeyToolAs) and every other tool's description and input-schema text
// pointing at the listed name.
export function listToolsPointerText(tools, env = process.env) {
  if (!Array.isArray(tools) || !keyToolListedOn(env)) return tools;
  return tools.map((t) => {
    const r = asListedKeyTool(t);
    if (!r || typeof r !== 'object') return r;
    const d = keyToolPointerText(r.description, env);
    const sch = r.inputSchema ? _walk(r.inputSchema, env) : r.inputSchema;
    return (d === r.description && sch === r.inputSchema) ? r : { ...r, description: d, inputSchema: sch };
  });
}
