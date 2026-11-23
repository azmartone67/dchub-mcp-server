// lib/free-tighten.mjs — one dial for how many FULL answers a keyless caller gets up front (owner 2026-11-22,
// "giving away too much for free up front").
//
// Three keyless lanes each have their own per-(IP, tool, UTC day) cap today:
//   DCHUB_KEYLESS_FIRST_FULL_CAP   lib/keyless-first-full.mjs  the five energy tools, default 1 (lane ON by default)
//   DCHUB_KEYLESS_FULL_TRIAL_CAP   lib/keyless-full-trial.mjs  get_facility / get_grid_data / get_market_dcpi_rank, default 2
//   DCHUB_KEYLESS_SITE_FULL_CAP    lib/keyless-full-trial.mjs  analyze_site daily run, default 2 (lane ON by default)
// This module does not replace them. With DCHUB_FREE_TIGHTEN on, each of those caps is clamped to at most
// DCHUB_FREE_TIGHTEN_CAP (default 0: no keyless full answer at all; the caller gets the preview every other keyless
// call already gets). A lane whose cap is clamped to 0 returns no seat, so its call takes today's preview path.
//
// Off (unset / 0 / false / no / off): every cap reads exactly what it read before this file existed.
// The anonymous per-IP soft cap (DCHUB_ANON_DAILY_CAP) and every keyed tier are untouched.
// ★ Published copy (/ai, /connect, the server instructions) says the first call each UTC day to each core energy tool
// is a full answer. Clamping to 0 makes that sentence false: change the copy in the same window as the flag.

export const FREE_TIGHTEN_FLAG = 'DCHUB_FREE_TIGHTEN';
export const FREE_TIGHTEN_CAP_VAR = 'DCHUB_FREE_TIGHTEN_CAP';
export const FREE_TIGHTEN_CAP_DEFAULT = 0;

export function freeTightenOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[FREE_TIGHTEN_FLAG]) || '').trim());
}

// The ceiling the keyless caps are clamped to, or null when the dial is off.
export function freeTightenCeiling(env = process.env) {
  if (!freeTightenOn(env)) return null;
  const raw = String((env && env[FREE_TIGHTEN_CAP_VAR]) || '').trim();
  const v = raw === '' ? FREE_TIGHTEN_CAP_DEFAULT : parseInt(raw, 10);
  if (!Number.isFinite(v) || v < 0) return FREE_TIGHTEN_CAP_DEFAULT;
  return v;
}

// cap, clamped by the dial when it is on. Never raises the cap.
export function tightenedCap(cap, env = process.env) {
  const ceil = freeTightenCeiling(env);
  return ceil === null ? cap : Math.min(cap, ceil);
}
