# DC Hub MCP server — minimal Node 20 container for Glama introspection.
#
# Glama needs: container starts → server binds a port → responds to MCP
# initialize + tools/list introspection probes.
#
# Real production hosting is on Railway with the same entrypoint.

FROM node:20-alpine

WORKDIR /app

# Install deps first (cached layer).
# ★2026-08-23: `npm ci`, not `npm install`. The whole 82-tool surface depends
# on how @modelcontextprotocol/sdk emits JSON Schema — that contract is what
# broke on 2026-08-21, when every tool's outputSchema carried a draft-07
# $schema and Claude's bundled client rejected all 82 (#215). package.json
# asks for ^1.28.0, so `npm install` is free to resolve anywhere in 1.x
# (1.30.0 is published) whenever the lockfile is absent or out of step, and
# the lockfile is NOT copied deterministically by `package-lock.json*` — the
# glob silently matches nothing if the file is missing rather than failing.
# `npm ci` installs the locked tree (SDK 1.29.0) or exits non-zero; it also
# REQUIRES the lockfile, so a missing one becomes a red build instead of a
# silent floating resolve.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copy the rest
COPY . .

# Glama probes on a TCP port. server.mjs binds PORT (default 8080).
ENV PORT=8080
ENV NODE_ENV=production

# Health: any GET on / or /health returns 200 (server.mjs handles both)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:${PORT}/health || exit 1

EXPOSE 8080

CMD ["node", "server.mjs"]
