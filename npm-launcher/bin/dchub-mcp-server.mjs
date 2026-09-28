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

const args = [proxy, url, "--transport", "http-only"];
if (key) args.push("--header", `X-API-Key:${key}`);
args.push(...process.argv.slice(2));

const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
