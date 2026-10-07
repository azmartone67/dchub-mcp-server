// A facility named in words ("Equinix DA1", "Dallas Infomart") is not an id or a
// slug, and the detail endpoints 404 on it (Grok 2026-10-06, item 14). Resolve it
// through the search rows instead. Pure: no network, never throws.

const toks = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

// A reference in words has whitespace; an id or slug never does.
export function looksLikeName(ref) {
  return typeof ref === 'string' && /\s/.test(ref.trim());
}

// Whole-token matching only: "DA1" must not match "DA11".
export function pickFacilityByName(ref, rows) {
  const want = toks(ref);
  if (!want.length || !Array.isArray(rows)) return null;
  let best = null;
  for (const r of rows) {
    const slug = r && (r.slug || r.id);
    const have = toks(r && r.name);
    if (!slug || !have.length) continue;
    let score = 0;
    if (have.length === want.length && want.every((t, i) => have[i] === t)) score = 100;
    else if (want.every((t, i) => have[i] === t)) score = 80;           // ref is a leading phrase
    else if (want.every((t) => have.includes(t))) score = 50;           // all words present
    if (!score) continue;
    const key = [score, -have.length];
    if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && key[1] > best.key[1])) best = { slug: String(slug), name: r.name, key };
  }
  return best ? { slug: best.slug, name: best.name } : null;
}

export async function resolveFacilityRef(ref, search) {
  try {
    if (!looksLikeName(ref)) return null;
    const res = await search(String(ref).trim());
    const rows = (res && (res.data || res.results || res.facilities)) || [];
    return pickFacilityByName(ref, rows);
  } catch (_) { return null; }
}
