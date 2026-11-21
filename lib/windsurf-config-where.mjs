// windsurf-config-where.mjs (2026-11-20): where Windsurf's MCP config file lives, said once.
//
// Windsurf's docs (docs.windsurf.com/windsurf/cascade/mcp, read 2026-11-20) name the user
// config ~/.config/devin/mcp_config.json (project: .devin/mcp_config.json);
// ~/.codeium/windsurf/mcp_config.json is the older Windsurf path. Every Windsurf surface here
// names both, current first, from these constants:
//   - persist_config.clients.windsurf.file (server.mjs, shown to agents after claim_free_key)
//   - docs/quick-start.md and integrations/mcp-clients/README.md (WINDSURF_WHERE_MD verbatim)
// test/windsurf-path-and-claim-copy.test.mjs fails if any of them drifts.
// The same sentence ships on dchub.cloud from dchub-frontend canonical/connect_clients.json.

export const WINDSURF_CONFIG_PATH = '~/.config/devin/mcp_config.json';
export const WINDSURF_CONFIG_PATH_OLDER = '~/.codeium/windsurf/mcp_config.json';

export const WINDSURF_WHERE =
  `Add to ${WINDSURF_CONFIG_PATH} (current Windsurf), or ${WINDSURF_CONFIG_PATH_OLDER} on older versions.`;

// Markdown form: each path in backticks.
export const WINDSURF_WHERE_MD =
  `Add to \`${WINDSURF_CONFIG_PATH}\` (current Windsurf), or \`${WINDSURF_CONFIG_PATH_OLDER}\` on older versions.`;

// The persist_config `file` field: printed inside one code span after "Paste this into Windsurf".
export const WINDSURF_PERSIST_FILE =
  `${WINDSURF_CONFIG_PATH} (current Windsurf; %AppData%/devin/mcp_config.json on Windows), or ${WINDSURF_CONFIG_PATH_OLDER} on older versions`;
