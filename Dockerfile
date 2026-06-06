# DC Hub MCP server — minimal Node 20 container for Glama introspection.
#
# Glama needs: container starts → server binds a port → responds to MCP
# initialize + tools/list introspection probes.
#
# Real production hosting is on Railway with the same entrypoint.

FROM node:20-alpine

WORKDIR /app

# Install deps first (cached layer)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

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
