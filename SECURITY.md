# Security Policy

To report a vulnerability in `dchub-mcp-server` or the hosted DC Hub MCP endpoint,
follow the policy published at
**https://dchub.cloud/.well-known/security.txt** (RFC 9116). It lists the
current contacts, the canonical policy URL and an expiry date, and it is the
source of truth if anything here ever differs.

Please report privately rather than opening a public issue, and include the
affected version (`npm view dchub-mcp-server version` or the `version` in
`server.json`), reproduction steps and the impact you observed.

## Supported versions

Only the latest published release receives fixes.

## Dependencies

Dependency advisories are checked with `npm audit` and `pip-audit`; patched
floors are recorded in `package.json` and `requirements.txt`.
