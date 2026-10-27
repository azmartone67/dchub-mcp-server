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
  if (/^cc-by-4\.0\b/i.test(t)) return 'CC-BY-4.0';
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
  let osm = false;
  try {
    walk(payload, (k, v, parent) => {
      if (k === 'license' && isObj(v) && text(v.id)) {
        // No url: a license object rides on one row (its own source_url), not on the layer.
        addLayer(layers, { id: licenseIdOf(v.id) === 'other' ? text(v.id) : licenseIdOf(v.id),
          reuse: text(v.reuse), attribution: text(v.attribution) });
      } else if (typeof v === 'string' && /^(source|data_source|attribution|license|licence)$/.test(k)
                 && /openstreetmap|\bodbl\b/i.test(v)) {
        osm = true;
      }
    });
  } catch (_) { /* a partial list is still honest */ }
  if (osm) addLayer(layers, { id: 'ODbL-1.0', attribution: OSM_ATTRIBUTION, reuse: 'share_alike' });
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
    const one = sources.length === 1 ? sources[0] : null;
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
      source_owner: one ? text(one.name) : null,
      source_url: one ? text(one.url) : null,
      partner_credit: null,
    };
    if (Object.keys(byField).length) ev.data_basis_by_field = byField;
    return ev;
  } catch (_) {
    return null;
  }
}
