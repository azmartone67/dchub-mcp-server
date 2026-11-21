// metro-anchor.mjs -- planner 5.58: "fastest 250 MW site near Chicago" searches around Chicago, not the whole state.
//
// WHY. Grok QA 2026-11-20 item 1: "fastest 250 MW data center site near Chicago Illinois within 30 months" routes to
// siting_search (a ranking class), whose find_sites step ran state=IL. Ranked by DCPI verdict, that search listed
// downstate MISO substations 56-170 km away and no Chicago-area area at all. Planner 5.55 led the answer with a caveat
// line; the owner then asked for the search itself to be anchored (2026-11-20: "anchor fastest-site-near-X asks to the
// metro").
//
// WHAT. nearMetroSlug(text, namedMarkets): the one named market the question puts the site NEAR ("near / around /
// close to / outside / within 50 miles of Chicago", "the Chicago area / metro / suburbs"), else null. Two or more
// named markets, or a market named without proximity wording ("in Dallas: any faster sites?" asks for alternatives
// to Dallas), return null and the plan keeps its state-wide search. The planner then passes find_sites market=<slug>
// with the state kept beside it: the backend centres the search on the market (60 km) and falls back to the state
// when the market does not resolve.
// Pure; nothing here throws.

const PROXIMITY = String.raw`(?:near(?:by)?|around|close\s+to|outside(?:\s+of)?|just\s+outside|by|`
  + String.raw`within\s+(?:about\s+)?\d+\s*(?:km|kilomet(?:er|re)s?|mi(?:les?)?)\s+(?:of|from)|`
  + String.raw`(?:an?|one|\d+)\s+hours?\s+(?:from|of)|commut(?:e|ing)\s+(?:distance\s+)?(?:of|from|to))`;
const AREA = String.raw`(?:area|metro(?:politan)?(?:\s+area)?|region|suburbs?|market)`;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "chicago-il" / "salt-lake-city" -> /chicago/, /salt\s+lake\s+city/ (a hyphen or space between words).
function nameRe(slug) {
  const words = String(slug || '').toLowerCase().replace(/-[a-z]{2}$/, '').split('-').filter(Boolean);
  if (!words.length) return null;
  return words.map(esc).join(String.raw`[\s-]+`);
}

export function nearMetroSlug(text, namedMarkets) {
  try {
    const named = [...new Set((Array.isArray(namedMarkets) ? namedMarkets : []).filter((x) => typeof x === 'string' && x))];
    if (named.length !== 1) return null;
    const n = nameRe(named[0]);
    if (!n) return null;
    const t = String(text || '').slice(0, 2000);
    const near = new RegExp(String.raw`\b${PROXIMITY}\s+(?:the\s+)?(?:city\s+of\s+)?${n}\b`, 'i');
    const area = new RegExp(String.raw`\b${n}[\s-]+${AREA}\b`, 'i');
    return near.test(t) || area.test(t) ? named[0] : null;
  } catch (_e) { return null; }
}

// "within 50 miles of Phoenix" -> 80 (km, find_sites' 5-400 clamp), else null: the backend's market default (60 km).
export function nearMetroRadiusKm(text) {
  try {
    const m = /\bwithin\s+(?:about\s+)?(\d+(?:\.\d+)?)\s*(km|kilomet(?:er|re)s?|mi(?:les?)?)\s+(?:of|from)\b/i.exec(String(text || '').slice(0, 2000));
    if (!m) return null;
    const v = Number(m[1]) * (/^mi/i.test(m[2]) ? 1.609344 : 1);
    return Number.isFinite(v) && v > 0 ? Math.min(400, Math.max(5, Math.round(v))) : null;
  } catch (_e) { return null; }
}
