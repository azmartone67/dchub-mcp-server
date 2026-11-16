#!/usr/bin/env node
// DC Hub MCP launcher: bridges a stdio MCP client to the hosted server.
// No key needed for previews. Set DCHUB_API_KEY (or X_API_KEY) to send a key.
//
// stdout belongs to the MCP protocol (the child's JSON-RPC stream), so this file
// never writes to it. The one start-up hint goes to stderr, which MCP clients
// show as a server log line. No network call happens here: the child connects.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const url = process.env.DCHUB_MCP_URL || "https://dchub.cloud/mcp";
const key = process.env.DCHUB_API_KEY || process.env.X_API_KEY || "";

let proxy;
try {
  const pkgDir = path.dirname(require.resolve("mcp-remote/package.json"));
  proxy = path.join(pkgDir, "dist", "proxy.js");
} catch {
  console.error("[dchub] could not find mcp-remote; reinstall dchub-mcp-server");
  process.exit(1);
}

// The key never goes on the child's command line, where `ps` would show it.
// mcp-remote expands ${VAR} in a --header value from its own environment, so
// argv carries only the placeholder and the key travels in env.
const env = { ...process.env };
const args = [proxy, url, "--transport", "http-only"];
if (key) {
  env.DCHUB_MCP_HEADER_KEY = key;
  args.push("--header", "X-API-Key:${DCHUB_MCP_HEADER_KEY}");
}
args.push(...process.argv.slice(2));

// One line, once, on stderr. DCHUB_QUIET=1 turns it off.
if (!/^(1|true|yes)$/i.test(process.env.DCHUB_QUIET || "")) {
  process.stderr.write(
    `[dchub] Connected to ${url}. No key needed for previews. Start with execute_plan. ` +
      "Save a key from claim_free_key or https://dchub.cloud/connect.\n",
  );
}

const child = spawn(process.execPath, args, { stdio: "inherit", env });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
