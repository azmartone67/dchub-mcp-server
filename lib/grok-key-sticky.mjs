// grok-key-sticky.mjs: Grok key persistence (Grok funnel spec F1, 2026-11-22). Flag DCHUB_GROK_KEY_STICKY, default OFF.
//
// WHY. Grok rotates its egress IP per request and starts a fresh MCP session per tool call, so a Grok caller that got a
// key and does not carry it looks new on every call (retention 7d to 2026-11-22: 7 of 688 free keys came back). The key
// only persists when it rides the connector: in the grok.com connector URL, or in the xAI API's mcp tool
// (dchub-frontend install/grok.html, tested 2026-10-25: the connector form's API-key field sends nothing on its own).
//
// WHAT, flag on, for a Grok caller only, on a key tool's reply that handed back a durable key (claim_free_key /
// get_api_key minted or returned one, bind_email bound one; server.mjs _withReuseKeyLine):
//   . one extra text block: the keep-attached sentence, the grok.com custom-connector URL and the xAI Remote MCP tool
//     block, each with the key as a PLACEHOLDER the agent fills from the key in the same reply;
//   . structuredContent.grok_keep_key: the same three things as fields.
// The full key is never written by this file (prose, structuredContent or log); the reply's existing key line is
// unchanged. No price, plan name, "free", credit, trial wording or per-day figure. Pure: no ctx, no network.
// F1b (a keyed Grok call never mints a second key) is already the server's behaviour: the inline auto-trial mint is off
// (DCHUB_AUTO_TRIAL_MINT, default 0) and a keyed session skips minting (DCHUB_MINT_SKIP_KEYED / _SESSION_KEY), and the
// key tool returns the presented key; test/grok-key-sticky.test.mjs pins it for Grok on a new IP.

export const GROK_KEY_STICKY_FLAG = 'DCHUB_GROK_KEY_STICKY';
export const KEY_PLACEHOLDER = '<YOUR_DC_HUB_KEY>';
export const KEEP_ATTACHED_LINE = 'Keep this key attached so DC Hub remembers your shortlists and changes.';
export const GROK_CONNECTOR_URL_TEMPLATE = 'https://dchub.cloud/mcp?apiKey=' + KEY_PLACEHOLDER;
export const XAI_MCP_TOOL_TEMPLATE = Object.freeze({
  type: 'mcp', server_url: 'https://dchub.cloud/mcp', server_label: 'dchub', authorization: 'Bearer ' + KEY_PLACEHOLDER,
});

export function grokKeyStickyOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[GROK_KEY_STICKY_FLAG]) || '').trim());
}

export function grokKeepKeyText() {
  return KEEP_ATTACHED_LINE + '\n'
    + 'grok.com (Connectors, New Connector, Custom): paste this as the MCP server URL, with the key above in place of '
    + KEY_PLACEHOLDER + ', and leave any API key field empty:\n'
    + GROK_CONNECTOR_URL_TEMPLATE + '\n'
    + 'xAI API (Remote MCP tool), same replacement:\n'
    + JSON.stringify(XAI_MCP_TOOL_TEMPLATE);
}

export function grokKeepKeyFields() {
  return { line: KEEP_ATTACHED_LINE, placeholder: KEY_PLACEHOLDER, connector_url: GROK_CONNECTOR_URL_TEMPLATE,
    xai_mcp_tool: { ...XAI_MCP_TOOL_TEMPLATE } };
}

// Add the block to a key reply. Unchanged when it already carries it, when it is an error, or it has no content array.
export function withGrokKeepKey(result) {
  try {
    if (!result || typeof result !== 'object' || result.isError === true || !Array.isArray(result.content)) return result;
    if (result.content.some((b) => b && typeof b.text === 'string' && b.text.includes(KEEP_ATTACHED_LINE))) return result;
    const sc = (result.structuredContent && typeof result.structuredContent === 'object' && !Array.isArray(result.structuredContent))
      ? result.structuredContent : {};
    return { ...result, content: [...result.content, { type: 'text', text: grokKeepKeyText() }],
      structuredContent: { ...sc, grok_keep_key: grokKeepKeyFields() } };
  } catch (_) { return result; }
}
