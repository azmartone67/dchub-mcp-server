# Official MCP Registry — `registry.modelcontextprotocol.io`

**Artifact:** repo-root [`../server.json`](../server.json) — validated against the
current official schema (`2025-12-11`), remote (Streamable HTTP), 38-tool count,
version `2.1.24`.

The official registry hosts **metadata only** and reads `server.json` from the
repo root. Publishing is done with the `mcp-publisher` CLI (already wired into
`.github/workflows/registry-refresh.yml`, best-effort weekly + on push).

## Namespace authentication — the one-time blocker

The namespace is `cloud.dchub/mcp-server`. The official registry requires the
publisher to **prove ownership of `dchub.cloud`** (DNS namespace auth). GitHub-OIDC
auth only covers `io.github.*` namespaces, so for `cloud.dchub` the maintainer
must do DNS verification **once**:

```bash
# 1. Download the publisher CLI
curl -sL https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_linux_amd64.tar.gz | tar xz mcp-publisher

# 2. Start DNS login for the dchub.cloud namespace — it prints a TXT record
./mcp-publisher login dns --domain dchub.cloud

# 3. Add the printed TXT record to dchub.cloud DNS, wait for propagation, re-run step 2

# 4. Publish (reads ./server.json)
./mcp-publisher publish
```

Once the TXT record is in place, the weekly `registry-refresh.yml` `publish` job
re-publishes automatically on each `server.json` version bump.

## Maintainer checklist
- [ ] Run `mcp-publisher login dns --domain dchub.cloud` and add the TXT record.
- [ ] Confirm `server.json` `version` is **greater** than the currently published
      version (registry rejects re-publish of an existing version). Bump if needed.
- [ ] `./mcp-publisher publish` → confirm listing at
      `https://registry.modelcontextprotocol.io/v0/servers?search=dchub`.
- [ ] (Optional) keep the schema URL current; it's `2025-12-11` as of this PR.

> Many downstream directories (Glama, some mirrors) pull from the official
> registry, so a successful publish here propagates broadly.
