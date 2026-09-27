// Preload: NODE_OPTIONS="--import ./lib/web-bot-auth-preload.mjs" signs a
// script's requests to dchub.cloud (no-op without WEB_BOT_AUTH_PRIVATE_JWK).
// Also the vitest setupFile, so live-prod suites sign their probes.
import { installFetchSigning } from './web-bot-auth.mjs';

installFetchSigning();
