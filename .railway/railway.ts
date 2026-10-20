// Railway Infrastructure as Code for the dchub-mcp-server service.
//
// Replaces railway.toml (Config as Code), which Railway stops reading on
// 2026-12-01; railway.toml and nixpacks.toml were deleted 2026-09-26 after this
// was applied and verified (test/deterministic-install.test.mjs fails if either
// comes back). Evaluated by the Railway CLI (`railway config plan` / `apply`),
// NOT at deploy time: merging a change here does nothing until it is applied.
//
// ★ partial: this repo owns ONLY this service. Project resourceful-essence also
// holds dchub-backend's services, render-pdf, function-bun and dchub-mpp-sidecar;
// without a named partial an apply from here would delete every one of them.
//
// ★ These values mirror what production RUNS, measured 2026-09-25 on deployment
// 1d6c347c — not what railway.toml says. The toml's `builder = "nixpacks"` +
// `buildCommand = "npm ci"` were inert: Railway auto-detected ./Dockerfile
// (build log: "load build definition from Dockerfile", "npm ci --omit=dev").
// Declaring DOCKERFILE here makes that explicit instead of auto-detected.
//
// ★ env: every variable is preserve() (value stays in Railway, never in git).
// A service() block with no env entry for a variable PLANS TO DELETE IT, and a
// missing `source` plans to disconnect the repo. Add new variables here as
// preserve() when you create them in Railway, or the next apply removes them.
import { defineRailway, github, preserve, project, service } from "railway/iac";

export const partial = "dchub-mcp-server";

export default defineRailway(() => {
  const dchubMcpServer = service("dchub-mcp-server", {
    source: github("azmartone67/dchub-mcp-server", { checkSuites: false }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "node server.mjs",
    healthcheck: "/health",
    replicas: { "us-west2": 1 },
    // 8 GB memory and tracing: owner-approved and applied in Railway 2026-10-20;
    // declared here so the next apply keeps them. memoryBytes is decimal
    // (8 GB = 8e9); cpu 32 is the live value the plan reads back (omitting it
    // plans a change to null).
    deploy: { limitOverride: { containers: { cpu: 32, memoryBytes: 8_000_000_000 } } },
    // Needs railway SDK >= 3.12.0 (.railway/package.json) and CLI >= 5.63.0: an older
    // SDK drops this block and every plan then proposes turning tracing off.
    tracing: { enabled: true, autoInstrumentation: true },
    env: {
      ANTHROPIC_API_KEY: preserve(),
      DCHUB_ADMIN_KEY: preserve(),
      DCHUB_ANON_DAILY_CAP: preserve(),
      DCHUB_API_BASE: preserve(),
      DCHUB_CHALLENGE_AFTER_N: preserve(),
      DCHUB_COOKBOOK_HINT: preserve(),
      DCHUB_EDGE_KEY: preserve(),
      DCHUB_GRID_HEADROOM_TIER: preserve(),
      DCHUB_INCONTEXT_CLAIM: preserve(),
      DCHUB_INTERNAL_KEY: preserve(),
      DCHUB_MCP_OAUTH_CHALLENGE: preserve(),
      DCHUB_MCP_RESOURCE: preserve(),
      DCHUB_OAUTH_CHALLENGE_DISABLE: preserve(),
      DCHUB_PER_PLATFORM_DESC_DISABLE: preserve(),
      DCHUB_PREVIEW_ISERROR: preserve(),
      DCHUB_QUOTA_HINT: preserve(),
      DCHUB_RESEND_API_KEY: preserve(),
      DCHUB_RETENTION_PITCH_ENABLED: preserve(),
      DCHUB_RETURN_REWARD: preserve(),
      DCHUB_STRIPE_DEVELOPER_LINK: preserve(),
      DCHUB_TRIAL_TOOL_DAILY_FULL: preserve(),
      DCHUB_WORKOS_AUD_ENFORCE: preserve(),
      DCHUB_WORKOS_OAUTH_ENABLED: preserve(),
      EIA_API_KEY: preserve(),
      MPP_ENABLED: preserve(),
      MPP_PREWALL_AT: preserve(),
      MPP_PREWALL_DISABLE: preserve(),
      MPP_SIDECAR_TOKEN: preserve(),
      MPP_SIDECAR_URL: preserve(),
      NODE_OPTIONS: preserve(),
      OPTIN_CTA_ENABLED: preserve(),
      WORKOS_AUTHKIT_DOMAIN: preserve(),
      WORKOS_CLIENT_ID: preserve(),
      // Added 2026-10-20: set in Railway after the last sync, so the plan proposed
      // DELETING them. preserve() keeps the value in Railway, out of git.
      ACTIVATION_EMAILS_ENABLED: preserve(),
      BRAIN_AGENT_LOOP_MODEL_B: preserve(),
      DCHUB_ASK_PAGES: preserve(),
      DCHUB_B2_SITE_HEADLINE: preserve(),
      DCHUB_BIND_RECEIPT_ARM: preserve(),
      DCHUB_CLAUDE_LAZY_AUTH: preserve(),
      DCHUB_EMAIL_DECISION_TOOL_DAILY_FULL: preserve(),
      DCHUB_EMAIL_HINT_V1: preserve(),
      DCHUB_PAID_SELL_LINE: preserve(),
      DCHUB_PAYWALL_CONTRACT: preserve(),
      DCHUB_PRO_TRIAL_OFFER: preserve(),
      DCHUB_QUEUE_MOAT: preserve(),
      DCHUB_RETURN_NUDGE: preserve(),
      DCHUB_WALL_ISERROR: preserve(),
      SMITHERY_API_KEY: preserve(),
      WEB_BOT_AUTH_PRIVATE_JWK: preserve(),
    },
  });

  return project("resourceful-essence", {
    resources: [dchubMcpServer],
  });
});
