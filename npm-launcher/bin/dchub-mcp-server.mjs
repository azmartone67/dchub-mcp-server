#!/usr/bin/env node
// DC Hub MCP launcher: bridges a stdio MCP client to the hosted server.
// Free tier works with no key. Set DCHUB_API_KEY (or X_API_KEY) for full data.
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

const child = spawn(process.execPath, args, { stdio: "inherit", env });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
