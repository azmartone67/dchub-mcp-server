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

## How secrets are handled

The server reads its own secrets from environment variables only. None is read from a file, written to disk, or
included in a response.

| Variable | Used for |
|---|---|
| `DCHUB_INTERNAL_KEY` | Authenticates this server to the DC Hub backend, and signs the one-time links it hands to users |
| `DCHUB_EDGE_KEY` | Optional shared secret checked on requests that arrive through the edge |
| `WORKOS_API_KEY` | Optional. Looks up a signed-in user, only when OAuth sign-in is enabled |
| `MPP_SIDECAR_TOKEN` | Optional. Authenticates to the machine-payment sidecar, only when that rail is enabled |
| `WEB_BOT_AUTH_PRIVATE_JWK` | Optional. Signs outbound requests when web bot authentication is enabled |

A caller's own DC Hub API key arrives in the `X-API-Key` or `Authorization: Bearer` header. It is forwarded to the DC Hub
backend to check its tier and is held in process memory for a short cache window (five minutes by default). It is not written to disk.

## What is logged

`server.mjs` writes operational lines to stdout and stderr only. Those lines never contain an API key, a bearer token,
a session id or a client IP:

* a session id or bearer token appears only as `h-` plus 8 hex characters of its SHA-256, so lines about the same
  session still line up and the id cannot be read back;
* an API key appears only as its public prefix (`dch_live_`, `dch_trial_`, `dchub_`), never a secret character;
* request URLs are logged as the path without the query string;
* error messages and stack traces are passed through a scrubber that replaces keys, bearer tokens, JWTs, secret query
  parameters, UUIDs and IPv4 addresses before they are written.

`lib/log-redact.mjs` implements this and `test/log-redaction.test.mjs` fails if a log line prints an id prefix, a key
prefix, a full request URL or a client IP. This covers this repository's own log lines. Request logs kept by the hosting
platform in front of the server are outside this repository.

## Outbound network calls

The server makes HTTP calls to a small, fixed set of places:

* **The DC Hub backend** (`DCHUB_API_BASE`, default the DC Hub production backend that serves dchub.cloud). Every tool
  call, key check, usage count and link request goes here. This is nearly all traffic.
* **WorkOS**, only when OAuth sign-in is enabled (`DCHUB_WORKOS_OAUTH_ENABLED` and `WORKOS_AUTHKIT_DOMAIN`): the
  configured AuthKit domain for signing keys, and `api.workos.com` for the user lookup.
* **The machine-payment sidecar** (`MPP_SIDECAR_URL`), only when `MPP_ENABLED=1`. This is a DC Hub service.

There is no analytics, advertising or other third-party telemetry. The server does not run shell commands or load code
from the network.

## Dependencies

Dependency advisories are checked with `npm audit` and `pip-audit`; patched
floors are recorded in `package.json` and `requirements.txt`.
