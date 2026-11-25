// queue-project-mode.mjs — get_interconnection_queue mode=project (Grok spec 2026-11-24, item 6B).
//
// One queue project by queue id, project name, or a point + radius, read from the backend's
// /api/v1/interconnection-queue/by-iso?mode=project (util/queue_project.py there). Behind
// DCHUB_QUEUE_PROJECT_MODE, default OFF: with it off the tool's schema, description and answer
// are exactly what they were, and execute_plan never routes here.
//
// Gating is NOT changed here. The answer goes through the same trackedTool gate as every other
// get_interconnection_queue answer: a non-paid seat gets the labelled taste of
// lib/free-decision-taste.mjs, which withholds `projects` (the rows) with their count, exactly as
// it withholds the per-ISO rows today. The body always carries a string `iso` and an array
// `projects`, the shape that taste is defined for, so it can never fall through to the generic
// row trim (which would show three rows). test/queue-project-mode-1125.test.mjs pins that.

export const QUEUE_PROJECT_FLAG = 'DCHUB_QUEUE_PROJECT_MODE';

export function queueProjectModeOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env || {})[QUEUE_PROJECT_FLAG] || '').trim());
}

// The params mode=project adds to the tool's input schema (only when the flag is on at startup).
export const QUEUE_PROJECT_PARAMS = Object.freeze(['mode', 'queue_id', 'name', 'lat', 'lon', 'radius_km']);

export const QUEUE_PROJECT_DESCRIPTION = ' mode=project looks up queue projects: by queue_id (e.g. PJM-C01-1097), by name, or by lat+lon (radius_km, default 10). Each row carries status, MW, fuel, county/state, the ISO file\'s source_url and its as_of; fields the ISO file does not carry are null with a note. An unknown id says it was not found in that ISO\'s queue as of the file date.';

export function queueProjectSchema(z, S, N) {
  return {
    mode: z.enum(['project']).optional().describe('project: look up queue projects by queue_id, name, or lat+lon instead of the ISO summary.'),
    queue_id: S.describe('mode=project: an ISO queue id, e.g. PJM-C01-1097 or AH1-570 with iso=PJM.'),
    name: S.describe('mode=project: a project name or part of one, e.g. "Homer City".'),
    lat: N.describe('mode=project: latitude of the point to search around (with lon).'),
    lon: N.describe('mode=project: longitude of the point to search around (with lat).'),
    radius_km: z.number().min(0.5).max(100).optional().describe('mode=project: search radius in km around lat/lon (default 10, max 100).'),
  };
}

// The backend query for a mode=project call; null when the call is not one.
export function queueProjectQuery(a) {
  if (!a || String(a.mode || '').toLowerCase() !== 'project') return null;
  const q = { mode: 'project' };
  for (const k of ['iso', 'queue_id', 'name', 'lat', 'lon', 'radius_km']) {
    if (a[k] !== undefined && a[k] !== null && a[k] !== '') q[k] = a[k];
  }
  return q;
}

// The body the gate reads: always a string iso and an array projects (see the header).
export function shapeQueueProjectBody(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { mode: 'project', iso: 'ALL', projects: [], project_count: 0, error: 'queue_unavailable' };
  }
  // The data service answers mode=project only while its own DCHUB_QUEUE_PROJECT_MODE is on; with it off, by-iso
  // ignores mode and serves the ISO summary, which must not be passed off as a project answer.
  if (data.mode !== 'project' && !data.error) {
    return { mode: 'project', iso: 'ALL', projects: [], project_count: 0, error: 'project_mode_unavailable',
      message: 'The per-project queue lookup is not enabled on the data service yet; call without mode for the ISO summary.' };
  }
  const out = { ...data };
  if (typeof out.iso !== 'string' || !out.iso) out.iso = 'ALL';
  if (!Array.isArray(out.projects)) out.projects = [];
  return out;
}

// ── execute_plan routing ──────────────────────────────────────────────────────
// "status of queue project PJM-C01-1097", "where is AH1-570 in the PJM queue",
// "queue projects near 39.11, -77.56", "interconnection projects within 10 km of <point>".
const _ID_RE = /\b((?:PJM|MISO|SPP|CAISO|NYISO|ISO-NE|ERCOT)-[A-Z0-9][A-Z0-9-]{2,30}|[A-Z]{1,3}\d-\d{2,4}|INR\d{2}[A-Z]?\d{3,5}|J\d{3,5})\b/i;
const _STATUS_RE = /\b(status|stage|where\s+is|progress|withdrawn|in[-\s]service)\b/i;
const _QUEUE_RE = /\b(queue|interconnection|interconnect)\b/i;
const _NEAR_RE = /\b(near|around|within\s+\d+(?:\.\d+)?\s*(?:km|kilometers?|mi|miles?)\s+of|close\s+to)\b/i;
const _PROJECTS_RE = /\bprojects?\b/i;
const _DC_RE = /\b(data\s*cent(?:er|re)s?|campus(?:es)?|facilit(?:y|ies)|colo(?:cation)?)\b/i;
const _NAME_RE = /\b(?:queue\s+project|project)\s+(?:named\s+|called\s+)?["“']([^"”']{3,80})["”']/i;
const _RADIUS_RE = /\bwithin\s+(\d+(?:\.\d+)?)\s*(km|kilometers?|mi|miles?)\b/i;

// { queue_id } | { name } | { lat, lon, radius_km } | null. `coords` is the plan's parsed point.
export function queueProjectAsk(text, coords = null) {
  const t = String(text || '');
  if (!t) return null;
  const queue = _QUEUE_RE.test(t);
  const id = _ID_RE.exec(t);
  if (id && (queue || _STATUS_RE.test(t))) return { queue_id: id[1].toUpperCase() };
  const nm = _NAME_RE.exec(t);
  if (nm && queue) return { name: nm[1].trim() };
  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)
      && _PROJECTS_RE.test(t) && _NEAR_RE.test(t) && (queue || !_DC_RE.test(t))) {
    const r = _RADIUS_RE.exec(t);
    let km = r ? Number(r[1]) * (/^mi/i.test(r[2]) ? 1.609 : 1) : 10;
    if (!Number.isFinite(km) || km <= 0) km = 10;
    return { lat: coords.lat, lon: coords.lon, radius_km: Math.min(100, Math.round(km * 10) / 10) };
  }
  return null;
}

export function queueProjectSequence(ask, iso) {
  return [{
    step: 1, tool: 'get_interconnection_queue', depends_on: [], estimated_calls: 1,
    why: 'Per-project queue read (mode=project): status, MW, fuel, place, the ISO file\'s source_url and as_of, and the nearest DC Hub market.',
    args_hint: { mode: 'project', ...(iso ? { iso } : {}), ...ask },
  }];
}
