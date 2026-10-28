// evidence-contract.mjs: the partner-grade evidence block, provenance.evidence
// (partner program 2026-10-27, section 6).
//
// WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT.
// The envelope (lib/attribution.mjs, 1.1 here, 1.2 from the backend) already carries
// as_of, retrieved_at, basis_class, completeness, caveats[] and sources[].license. A partner
// diligencing us asks for those under the contract's names, with the same honesty rules the
// envelope already keeps. This block restates them, additively, in ONE object a reader can
// find without walking the response:
//
//   evidence_as_of   provenance.as_of: when the underlying data was current. null when the
//                    response carries no collection date; never retrieved_at. A fresh
//                    retrieval time is not a fresh measurement.
//   retrieved_at     when DC Hub returned it.
//   data_basis       reported | measured | modeled | inferred, ONLY from a class a backend
//                    block stated (the 1.2 `basis`, else the v1.1 `basis_class`). null for
//                    unknown and for mixed. Never guessed from a number's shape.
//   license_id       a single id ONLY when the envelope itself names one that is not the
//                    default grant; 'composite' when the response declares two or more
//                    different layers; otherwise null. null means "not stated for this
//                    response", and provenance.license (CC-BY-4.0) is the envelope default,
//                    not a per-layer grant. A composite record does not inherit one licence.
//   license_layers   every layer licence the payload itself declares (a license object with
//                    an id, sources[].license, the envelope licence when it is not the
//                    default, and an OpenStreetMap / ODbL mention), each under its own id.
//                    ODbL-1.0 is never folded into CC-BY-4.0.
//   attribution_text what to print beside the figures: DC Hub, plus every credit the payload
//                    states for a layer. From the payload; none is invented.
//   limitations[]    {code, text}: the backend caveats, a partial preview, a hard wall, an
//                    unmeasured date, unverified coverage. Empty array when none applies.
//   coverage         {status, shown, total, withheld_fields, basis}: completeness as the
//                    envelope derived it, with the shown-of-total gap when it was measured.
//   source_owner / source_url
//                    the one upstream's name and link when sources[] names exactly one; null
//                    otherwise (several upstreams, or none stated). Not every fact is DC
//                    Hub's own, and a block with no sources[] does not claim it is.
//   partner_credit   null until a partner exists: {name, url, licence} then.
//
//   layers[]         one entry per upstream layer the payload itself dates or names, each with its OWN
//                    evidence_as_of, source and licence: a named sub-object that carries its own
//                    as_of / source_as_of / source_url (market siting layers, per-ISO queue freshness),
//                    and each composed step of an execute_plan. A layer whose date is the fetch date of
//                    a live feed carries evidence_as_of null and the date as fetched_on: a fetch date is
//                    not a measurement date. Several layers never collapse into one date or one licence.
//
// NOT EMITTED YET (needs entity crosswalks or per-figure claims, see the design note):
// claim_id, partner_entity_id, dchub_entity_id.
//
// Kill switch DCHUB_EVIDENCE_CONTRACT=0 removes the block. Pure, never throws.

export const EVIDENCE_CONTRACT_REVISION = '1';
export const EVIDENCE_ENV = 'DCHUB_EVIDENCE_CONTRACT';

export function evidenceContractOn(env = process.env) {
  const raw = env && env[EVIDENCE_ENV];
  if (raw === undefined || raw === null || raw === '') return true;
  return !/^(0|false|off|no)$/i.test(String(raw).trim());
}

// How the envelope's classes read in the contract's four words. Pinned to the two vocabularies
// in lib/attribution.mjs (BASIS_CLASSES for v1.1, BASIS_12 for 1.2). mixed and unknown are
// absent on purpose: they have no contract word.
export const DATA_BASIS = Object.freeze(['reported', 'measured', 'modeled', 'inferred']);
export const DATA_BASIS_OF = Object.freeze({
  filed: 'reported', stated: 'reported', published: 'reported', cited: 'reported',
  measured: 'measured',
  estimated: 'modeled', modelled: 'modeled',
  derived: 'inferred',
});

const DEFAULT_GRANT = 'CC-BY-4.0';
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function dataBasisOf(cls) {
  return typeof cls === 'string' && Object.prototype.hasOwnProperty.call(DATA_BASIS_OF, cls)
    ? DATA_BASIS_OF[cls] : null;
}

// A licence string or id -> a stable id. Unrecognised text is 'other' and the text rides along.
export function licenseIdOf(raw) {
  const t = text(raw);
  if (!t) return null;
  if (/odbl|openstreetmap/i.test(t)) return 'ODbL-1.0';
  if (/^cc[- ]by[- ]4\.0\b/i.test(t)) return 'CC-BY-4.0';
  if (/peeringdb/i.test(t)) return 'peeringdb-aup';
  if (/public domain/i.test(t)) return 'public-domain';
  if (/^publisher-copyright$/i.test(t)) return 'publisher-copyright';
  if (/^(composite|mixed)\b/i.test(t)) return 'composite';
  return 'other';
}

const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

function addLayer(layers, layer) {
  const key = `${layer.id}|${layer.source_id || ''}|${layer.name || ''}`;
  if (layers.has(key)) return;
  const clean = {};
  for (const [k, v] of Object.entries(layer)) if (v !== undefined && v !== null) clean[k] = v;
  layers.set(key, clean);
}

// Layer licences the payload itself declares. `walk` is attribution.mjs's bounded walker.
function collectLayers(payload, prov, walk) {
  const layers = new Map();
  const sources = Array.isArray(prov && prov.sources) ? prov.sources : [];
  for (const s of sources) {
    if (!isObj(s) || !text(s.license)) continue;
    const id = licenseIdOf(s.license);
    addLayer(layers, { id, source_id: text(s.id), name: text(s.name), url: text(s.url),
      attribution: text(s.attribution), license_text: id === 'other' || id === 'public-domain' ? text(s.license) : null });
  }
  const envLic = text(prov && prov.license);
  if (envLic && envLic !== DEFAULT_GRANT) {
    const id = licenseIdOf(envLic);
    addLayer(layers, { id, scope: 'envelope', license_text: id === 'other' || id === 'peeringdb-aup' ? envLic : null });
  }
  let osm = false, pdb = false;
  try {
    walk(payload, (k, v, parent) => {
      if (k === 'attribution' && Array.isArray(v)) {
        // A third-party layer the payload credits: its own licence string, name, link and the
        // citation it asks for. Its licence is that layer's, not the envelope's.
        for (const a of v) {
          if (!isObj(a) || !text(a.license) || !(text(a.source) || text(a.url))) continue;
          const id = licenseIdOf(a.license);
          addLayer(layers, { id, name: text(a.source), url: text(a.url), attribution: text(a.citation),
            license_text: id === 'other' ? text(a.license) : null });
        }
      } else if (k === 'provenance' && isObj(v) && v !== prov) {
        // A composed step's own sources[]: each upstream keeps its own licence at the top level.
        for (const s of Array.isArray(v.sources) ? v.sources : []) {
          if (!isObj(s) || !text(s.license)) continue;
          const id = licenseIdOf(s.license);
          addLayer(layers, { id, source_id: text(s.id), name: text(s.name), url: text(s.url),
            attribution: text(s.attribution), license_text: id === 'other' || id === 'public-domain' ? text(s.license) : null });
        }
      } else if (k === 'license' && isObj(v) && text(v.id)) {
        // No url: a license object rides on one row (its own source_url), not on the layer.
        addLayer(layers, { id: licenseIdOf(v.id) === 'other' ? text(v.id) : licenseIdOf(v.id),
          reuse: text(v.reuse), attribution: text(v.attribution) });
      } else if (typeof v === 'string') {
        if (/^(source|data_source|attribution|license|licence)$/.test(k) && /openstreetmap|\bodbl\b/i.test(v)) osm = true;
        if (/^(source|data_source|attribution)$/.test(k) && /peeringdb/i.test(v)) pdb = true;
      }
    });
  } catch (_) { /* a partial list is still honest */ }
  const has = (id) => [...layers.values()].some((l) => l.id === id);
  if (osm && !has('ODbL-1.0')) addLayer(layers, { id: 'ODbL-1.0', attribution: OSM_ATTRIBUTION, reuse: 'share_alike' });
  // The backend's own attribution names PeeringDB; that layer is under the PeeringDB Acceptable Use
  // Policy (lib/attribution.mjs PEERINGDB_LICENSE), never under the envelope's CC-BY-4.0.
  if (pdb && !has('peeringdb-aup')) addLayer(layers, { id: 'peeringdb-aup', name: 'PeeringDB', url: 'https://dchub.cloud/data-sources', attribution: 'PeeringDB' });
  return [...layers.values()];
}

function chooseLicenseId(prov, layers) {
  const envLic = text(prov && prov.license);
  const ids = [...new Set(layers.map((l) => l.id))];
  if (envLic && envLic !== DEFAULT_GRANT && ids.length <= 1) {
    const id = licenseIdOf(envLic);
    return { id, basis: 'the envelope names a licence other than the default grant' };
  }
  if (ids.length >= 2 || (envLic && envLic !== DEFAULT_GRANT)) {
    return { id: 'composite', basis: `this response declares ${ids.length} layer licences; none of them is a licence for the whole` };
  }
  return { id: null, basis: 'no single licence is stated for this response; provenance.license is the envelope default and is not a per-layer grant, so do not assume CC-BY-4.0 for any layer not listed in license_layers' };
}

function limitationsOf(prov) {
  const out = [];
  const seen = new Set();
  const add = (code, t) => { if (t && !seen.has(code)) { seen.add(code); out.push({ code, text: t }); } };
  for (const c of Array.isArray(prov.caveats) ? prov.caveats : []) {
    if (isObj(c)) add(String(c.code || 'caveat'), text(c.text));
  }
  if (prov.completeness === 'partial_preview') {
    add('partial_preview', text(prov.preview_warning) || 'Data was withheld by tier gating; this is not the complete dataset.');
  } else if (prov.completeness === 'walled') {
    add('walled', text(prov.completeness_basis) || 'Hard wall for this tier: no data was returned.');
  } else if (prov.completeness === 'unknown') {
    add('coverage_unverified', text(prov.completeness_basis) || 'Coverage is unverified for this response.');
  }
  if (prov.as_of === null || prov.as_of === undefined) {
    add('evidence_as_of_unmeasured', 'This response carries no collection date; retrieved_at is when DC Hub served it, not when the data was collected.');
  }
  return out;
}

function coverageOf(prov) {
  const g = isObj(prov.preview) ? prov.preview : null;
  const c = { status: typeof prov.completeness === 'string' ? prov.completeness : 'unknown' };
  if (g && Number.isFinite(g.shown) && Number.isFinite(g.total)) { c.shown = g.shown; c.total = g.total; }
  if (g && Array.isArray(g.withheld_fields) && g.withheld_fields.length) c.withheld_fields = g.withheld_fields.slice(0, 12);
  c.basis = text(prov.completeness_basis);
  return c;
}

function attributionOf(prov, layers) {
  const parts = ['DC Hub, dchub.cloud'];
  const add = (t) => { if (t && !parts.includes(t)) parts.push(t); };
  for (const l of layers) add(l.attribution);
  return parts.join('; ');
}

// A backend block with no sources[] that nevertheless names ONE external upstream in `source` and
// links it in `source_url` (get_energy_prices: EIA retail sales). Both must be stated, and the
// link must leave dchub.cloud: the envelope's own `url` / `source: "DC Hub"` is the fallback, not
// an upstream. Returned in the {name, url} shape of a sources[] entry.
function statedSingleSource(prov, sources) {
  if (sources.length) return null;
  const name = text(prov.source), url = text(prov.source_url);
  if (!name || !url || /^DC Hub\b/i.test(name)) return null;
  let host = '';
  try { host = new URL(url).hostname; } catch (_) { return null; }
  if (/(^|\.)dchub\.cloud$/i.test(host)) return null;
  return { name, url };
}

// ── per-layer evidence ─────────────────────────────────────────────────────
const STAMP_RE = /^\d{4}-\d{2}(-\d{2})?([T ]\d{2}(:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$/;
// Hour-only ("T23") and hour-only-zone ("+00") spellings are completed ONLY to test that the stamp
// parses; the stamp is emitted as the source spelled it.
const completeStamp = (v) => v.replace(' ', 'T')
  .replace(/T(\d{2})$/, (_m, h) => `T${h}:00`)
  .replace(/(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-]\d{2})$/, (_m, t, z) => `${t}${z}:00`);
const isStamp = (v) => typeof v === 'string' && STAMP_RE.test(v) && Number.isFinite(Date.parse(completeStamp(v)));
const LAYER_DATE_KEYS = ['source_as_of', 'as_of', 'data_as_of'];
const SKIP_KEY = /^(provenance|citation|evidence|identity|quota|taste|preview)$|_provenance$|^_/;
const MAX_LAYERS = 24, MAX_LAYER_NODES = 2500, MAX_LAYER_DEPTH = 6;

function layerOfNode(path, node, upstream) {
  const dateKey = LAYER_DATE_KEYS.find((k) => isStamp(node[k]));
  const url = text(node.source_url);
  if (!dateKey && !url) return null;
  const kind = text(node.source_as_of_basis) || text(node.as_of_basis);
  const fetchDate = !!kind && /fetch|retriev/i.test(kind);
  const l = { layer: path, evidence_as_of: dateKey && !fetchDate ? node[dateKey] : null };
  if (dateKey && fetchDate) l.fetched_on = node[dateKey];
  l.as_of_basis = kind ? kind.slice(0, 200)
    : (dateKey ? `the layer's own ${dateKey}` : 'UNMEASURED: this layer states no collection date');
  const period = text(node.period);
  if (period) l.period = period;
  const owner = text(upstream && upstream.publisher) || text(node.publisher) || text(node.source) || text(node.source_report);
  if (owner && !/^DC Hub\b/i.test(owner)) l.source_owner = owner;
  if (url) l.source_url = url;
  const d = dataBasisOf(node.basis_class) || dataBasisOf(node.basis) || dataBasisOf(node.data_basis);
  if (d) l.data_basis = d;
  const lic = isObj(node.license) ? text(node.license.id) : text(node.license);
  if (lic) l.license_id = licenseIdOf(lic) === 'other' ? lic : licenseIdOf(lic);
  return l;
}

// A composed step (execute_plan executed[]): its own tool, date, upstream and licence, read from
// the step's own provenance. The step's evidence_as_of is that provenance's as_of, nothing newer.
function layerOfStep(label, prov) {
  const srcs = Array.isArray(prov.sources) ? prov.sources.filter(isObj) : [];
  const one = srcs.length === 1 ? srcs[0] : statedSingleSource(prov, srcs);
  const l = { layer: label, evidence_as_of: isStamp(prov.as_of) ? prov.as_of : null };
  l.as_of_basis = text(prov.as_of_basis) ? String(prov.as_of_basis).slice(0, 200)
    : (l.evidence_as_of ? "the step's own as_of" : 'UNMEASURED: this step states no collection date');
  if (one && text(one.name)) l.source_owner = text(one.name);
  if (one && text(one.url)) l.source_url = text(one.url);
  const d = dataBasisOf(prov.basis) || dataBasisOf(prov.basis_class);
  if (d) l.data_basis = d;
  const ids = [...new Set(srcs.filter((s) => text(s.license)).map((s) => licenseIdOf(s.license)))];
  if (ids.length === 1) l.license_id = ids[0];
  else if (ids.length > 1) l.license_id = 'composite';
  return l;
}

function evidenceLayers(payload) {
  const out = [];
  let nodes = 0;
  const upstream = isObj(payload) && isObj(payload.upstream_sources) ? payload.upstream_sources : null;
  const rec = (node, path, depth) => {
    if (out.length >= MAX_LAYERS || depth > MAX_LAYER_DEPTH || nodes++ > MAX_LAYER_NODES) return;
    if (Array.isArray(node)) {
      node.forEach((e, i) => {
        if (!isObj(e)) return;
        const carrier = isObj(e.provenance) ? e : (isObj(e.result) && isObj(e.result.provenance) ? e.result : null);
        if (carrier) {
          const label = text(carrier.provenance.tool) || text(e.tool) || text(e.step) || `${path}[${i}]`;
          const step = layerOfStep(label, carrier.provenance);
          step.step_index = i;
          out.push(step);
        }
      });
      return;                                   // other array elements are rows, not layers
    }
    if (!isObj(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (SKIP_KEY.test(k) || !v || typeof v !== 'object') continue;
      const p = path ? `${path}.${k}` : k;
      if (Array.isArray(v)) { rec(v, p, depth + 1); continue; }
      const parentKey = path.split('.').pop();
      const up = upstream && upstream[k] && isObj(upstream[k]) && parentKey === 'freshness_by_iso' ? upstream[k] : null;
      const l = layerOfNode(p, v, up);
      if (l) { out.push(l); continue; }          // a qualifying layer is not descended into
      rec(v, p, depth + 1);
    }
  };
  try { rec(payload, '', 0); } catch (_) { /* a partial list is still honest */ }
  return out.slice(0, MAX_LAYERS);
}

/**
 * The evidence block for one stamped provenance. `prov` is the MERGED provenance (backend
 * values already won); `payload` is the response body it describes; `walk` is
 * attribution.mjs's bounded walker. Returns null when the kill switch is off.
 */
export function buildEvidence(payload, prov, walk, env = process.env) {
  try {
    if (!evidenceContractOn(env) || !isObj(prov)) return null;
    const layers = collectLayers(payload, prov, walk);
    const lic = chooseLicenseId(prov, layers);
    // data_basis: the 1.2 basis when it names a contract word, else the v1.1 class.
    let basisFrom = null, dataBasis = null;
    for (const [key, val] of [['basis', prov.basis], ['basis_class', prov.basis_class]]) {
      const d = dataBasisOf(val);
      if (d) { dataBasis = d; basisFrom = `${key} ${val}`; break; }
    }
    const byField = {};
    if (isObj(prov.fields)) {
      for (const [name, f] of Object.entries(prov.fields)) {
        const d = isObj(f) ? (dataBasisOf(f.basis) || dataBasisOf(f.basis_class)) : null;
        byField[name] = d;
      }
    }
    const sources = Array.isArray(prov.sources) ? prov.sources.filter(isObj) : [];
    const one = sources.length === 1 ? sources[0] : statedSingleSource(prov, sources);
    const ev = {
      contract_revision: EVIDENCE_CONTRACT_REVISION,
      evidence_as_of: prov.as_of === undefined ? null : prov.as_of,
      evidence_as_of_basis: text(prov.as_of_basis),
      retrieved_at: text(prov.retrieved_at),
      data_basis: dataBasis,
      data_basis_basis: dataBasis
        ? `read from the backend-stated ${basisFrom}`
        : `no contract word applies: basis_class ${text(prov.basis_class) || 'unstated'}${text(prov.basis) ? `, basis ${prov.basis}` : ''}; this server does not guess one`,
      license_id: lic.id,
      license_id_basis: lic.basis,
      license_layers: layers,
      attribution_text: attributionOf(prov, layers),
      limitations: limitationsOf(prov),
      coverage: coverageOf(prov),
      source_owner: one ? text(one.name || one.source) : null,
      source_url: one ? text(one.url) : null,
      partner_credit: null,
    };
    const layerList = evidenceLayers(payload);
    if (layerList.length) ev.layers = layerList;
    if (Object.keys(byField).length) ev.data_basis_by_field = byField;
    return ev;
  } catch (_) {
    return null;
  }
}
