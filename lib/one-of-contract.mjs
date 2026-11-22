// Root-level schema combinators, 2026-11-22.
//
// #470 (2026-09-20) published each one-of contract as a ROOT-level `anyOf` on
// the tool's inputSchema. Model APIs do not ignore that keyword at the root:
//   - OpenAI (Codex CLI, any GPT model behind Copilot CLI / opencode):
//     400 invalid_function_parameters, "must not have oneOf/anyOf/allOf/enum/
//     const/not at the top level" (openai/codex#27877).
//   - Anthropic: 400 "input_schema does not support oneOf, allOf, or anyOf at
//     the top level" (anthropics/claude-code#58841).
// One offending tool fails tool registration for the whole request, so a
// client that passes MCP schemas through unmodified connects and then never
// calls a tool. The one-of contract is still enforced at runtime
// (ONE_OF_REQUIRED -> missing_identifier; get_grid_intelligence -> its own
// valid_regions error), so dropping the root keyword costs no safety.
//
// ★ /mcp/chatgpt is the exception. Its catalog (names, descriptions, input
//   schemas) is frozen for the OpenAI directory review
//   (test/chatgpt-toolset-frozen.test.mjs), and the reviewed snapshot carries
//   the root anyOf on these two tools. CHATGPT_FROZEN_ROOT_ANYOF re-applies it
//   on that profile only, so its served bytes do not move. Dropping it there
//   needs a new OpenAI submission and the owner's decision.

export const ROOT_COMBINATORS = Object.freeze(['anyOf', 'oneOf', 'allOf', 'not', 'enum', 'const']);

// The root keys of `schema` that model APIs reject at the top level.
export function rootCombinators(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  return ROOT_COMBINATORS.filter((k) => Object.prototype.hasOwnProperty.call(schema, k));
}

// Build `anyOf: [{properties:{k:{}}, required:[k]}, …]` over the keys the
// schema ACTUALLY declares. Each branch re-declares its property so Ajv
// 2020-12 strict does not raise strictRequired. Never clobbers an existing
// anyOf; returns the input unchanged on anything it cannot use.
export function withRootOneOfAnyOf(schema, keys) {
  if (!Array.isArray(keys) || !keys.length) return schema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  if (Array.isArray(schema.anyOf)) return schema;
  const props = schema.properties;
  if (!props || typeof props !== 'object') return schema;
  const declared = keys.filter((k) => Object.prototype.hasOwnProperty.call(props, k));
  if (!declared.length) return schema;
  return { ...schema, anyOf: declared.map((k) => ({ properties: { [k]: {} }, required: [k] })) };
}

// Frozen with the reviewed /mcp/chatgpt catalog (1.0.0 snapshot). Do not edit
// without regenerating test/fixtures/chatgpt-toolset.frozen.json on purpose.
export const CHATGPT_FROZEN_ROOT_ANYOF = Object.freeze({
  get_facility: Object.freeze(['facility_id', 'id', 'slug', 'name']),
  get_grid_intelligence: Object.freeze(['region_id', 'iso', 'region', 'market']),
});
