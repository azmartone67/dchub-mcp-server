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

// Brain 2026-11-23 item 5: a slug that 404s gets the 3 closest slugs on file. The slug's words (a trailing
// hash dropped) go to search, and the rows are ranked by how many of those words their own slug shares.
const HASH_RE = /^[0-9a-f]{6,}$/;
export function slugWords(ref) {
  const seen = new Set();
  return toks(String(ref || '').replace(/[-_]+/g, ' ')).filter((t) => !HASH_RE.test(t) && t.length > 1
    && !seen.has(t) && seen.add(t));
}

export function closestSlugs(ref, rows, n = 3) {
  const want = slugWords(ref);
  if (!want.length || !Array.isArray(rows)) return [];
  const self = String(ref || '').toLowerCase();
  const scored = [];
  const seen = new Set();
  for (const r of rows) {
    const slug = r && String(r.slug || r.id || '');
    if (!slug || seen.has(slug) || slug.toLowerCase() === self) continue;
    seen.add(slug);
    const have = new Set([...slugWords(slug), ...toks(r.name)]);
    const shared = want.filter((t) => have.has(t)).length;
    if (!shared) continue;
    scored.push({ slug, name: r.name || null, city: r.city || null, shared, len: have.size });
  }
  scored.sort((a, b) => b.shared - a.shared || a.len - b.len || a.slug.localeCompare(b.slug));
  return scored.slice(0, n).map(({ slug, name, city }) => ({ slug, name, city }));
}

export async function notFoundSuggestions(ref, search, n = 3) {
  try {
    const words = slugWords(ref);
    if (!words.length) return [];
    const tries = [words.slice(0, 4).join(' ')];
    if (words.length > 2) tries.push([words[0], words[words.length - 1]].join(' '));
    tries.push(words[0]);
    let rows = [];
    for (const q of tries) {
      const res = await search(q);
      const got = (res && (res.data || res.results || res.facilities)) || [];
      if (Array.isArray(got)) rows = rows.concat(got);
      if (closestSlugs(ref, rows, n).length >= n) break;
    }
    return closestSlugs(ref, rows, n);
  } catch (_) { return []; }
}
