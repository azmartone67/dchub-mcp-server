/*
 * DC Hub spreadsheet functions: the ONE mapper from a DC Hub REST response to cells.
 * Source of truth for integrations/spreadsheets/google-sheets/Cells.gs and
 * integrations/spreadsheets/excel/cells.js (byte-identical copies; a test pins that).
 * Plain ES5-style script: Apps Script and the Excel custom-functions runtime load it
 * as a global; Node tests read it through module.exports.
 *
 * Rule: a value DC Hub withholds is shown as withheld, never estimated.
 */
var DCHUB_BASE = "https://dchub.cloud";
var DCHUB_SIGNUP = "https://dchub.cloud/signup";

var DCHUB_FUNCTIONS = {
  GRID:        { path: function (a) { return "/api/v1/grid/intelligence/" + encodeURIComponent(String(a[0] || "").toUpperCase()); }, field: "demand_mw" },
  DCPI:        { path: function (a) { return "/api/v1/dcpi/scores/" + encodeURIComponent(String(a[0] || "").toLowerCase()); }, field: "verdict" },
  FACILITIES:  { path: function (a) { return "/api/v1/facilities?q=" + encodeURIComponent(String(a[0] || "")) + "&limit=" + Math.max(1, Math.min(100, Number(a[1]) || 10)); }, table: true },
  ENERGY_RATE: { path: function (a) { return "/api/v1/energy/retail/rates?state=" + encodeURIComponent(String(a[0] || "").toUpperCase()); }, field: "retail_rate_kwh" }
};

var FACILITY_COLUMNS = ["name", "provider", "city", "state", "country", "as_of", "profile_url"];

function dchubUrl(fn, args, via) {
  var spec = DCHUB_FUNCTIONS[fn];
  if (!spec) throw new Error("Unknown DC Hub function " + fn);
  var p = spec.path(args || []);
  return DCHUB_BASE + p + (p.indexOf("?") >= 0 ? "&" : "?") + "via=" + encodeURIComponent(via || "spreadsheet");
}

function dchubPick(obj, field) {
  var parts = String(field).split(".");
  var cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

function dchubLink(resp) {
  var u = (resp && (resp.human_url || resp.upgrade_url || resp.unlock_url)) || DCHUB_SIGNUP;
  return u.charAt(0) === "/" ? DCHUB_BASE + u : u;   /* some gates return a site-relative link */
}

/* A gate, a cap or a withheld field becomes one readable cell. */
function dchubWithheld(resp) {
  return "withheld: " + dchubLink(resp);
}

/* resp: parsed JSON (or null on a network failure); field: dotted path or "" for the default. */
function dchubCell(fn, resp, field) {
  if (!resp || typeof resp !== "object") return "error: no response from DC Hub";
  if (resp.error && !resp.success) return dchubWithheld(resp);
  var f = field || DCHUB_FUNCTIONS[fn].field;
  var v = dchubPick(resp, f);
  var locked = resp._locked_fields || [];
  if (v === null || v === undefined) {
    if (resp.gated || resp._gated || locked.indexOf(f) >= 0) return dchubWithheld(resp);
    return "not reported";
  }
  if (typeof v === "string" && /^<gated/.test(v)) return dchubWithheld(resp);
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

/* FACILITIES: header row + one row per facility, then a note row when DC Hub returned
 * a partial set (free tier), so the sheet says it is partial. */
function dchubTable(resp) {
  if (!resp || typeof resp !== "object") return [["error: no response from DC Hub"]];
  if (resp.error && !resp.success) return [[dchubWithheld(resp)]];
  var rows = [FACILITY_COLUMNS.slice()];
  var data = resp.data || [];
  for (var i = 0; i < data.length; i++) {
    var r = [];
    for (var j = 0; j < FACILITY_COLUMNS.length; j++) {
      var v = data[i][FACILITY_COLUMNS[j]];
      r.push(v === null || v === undefined ? "" : v);
    }
    rows.push(r);
  }
  if (resp.total_matching && resp.total_matching > data.length) {
    var note = ["showing " + data.length + " of " + resp.total_matching + ": " + dchubLink(resp)];
    while (note.length < FACILITY_COLUMNS.length) note.push("");
    rows.push(note);
  }
  return rows;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { DCHUB_FUNCTIONS: DCHUB_FUNCTIONS, FACILITY_COLUMNS: FACILITY_COLUMNS, dchubUrl: dchubUrl, dchubPick: dchubPick, dchubCell: dchubCell, dchubTable: dchubTable };
}
