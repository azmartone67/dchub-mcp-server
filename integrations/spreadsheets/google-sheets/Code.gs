/*
 * DC Hub for Google Sheets: live data center, power grid and energy data as formulas.
 *   =DCHUB_GRID("PJM")                     live demand (MW); 2nd arg picks another field
 *   =DCHUB_DCPI("phoenix")                 BUILD / CAUTION / AVOID; "composite_score" for the score
 *   =DCHUB_FACILITIES("Ashburn", 10)       a table of facilities
 *   =DCHUB_ENERGY_RATE("VA")               retail electricity rate
 * Extensions > DC Hub > Set API key stores your free key (https://dchub.cloud/signup)
 * for your account only. The mapping from responses to cells lives in Cells.gs.
 */
var DCHUB_CACHE_SECONDS = 600;

function onOpen() {
  SpreadsheetApp.getUi().createAddonMenu()
    .addItem("Set API key", "dchubShowSidebar")
    .addToUi();
}

function onInstall() { onOpen(); }

function dchubShowSidebar() {
  SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile("Sidebar").setTitle("DC Hub"));
}

/* Called from Sidebar.html. */
function dchubSaveKey(key) {
  var k = String(key || "").trim();
  if (k) PropertiesService.getUserProperties().setProperty("DCHUB_API_KEY", k);
  else PropertiesService.getUserProperties().deleteProperty("DCHUB_API_KEY");
  return k ? "saved" : "cleared";
}

function dchubFetch_(fn, args) {
  var url = dchubUrl(fn, args, "sheets");
  var key = PropertiesService.getUserProperties().getProperty("DCHUB_API_KEY") || "";
  var cache = CacheService.getUserCache();
  var ck = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, url + "|" + key));
  var hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  var headers = { "Accept": "application/json" };
  if (key) headers["X-API-Key"] = key;
  var res = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
  var body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { return null; }
  var text = JSON.stringify(body);
  if (text.length < 90000) cache.put(ck, text, DCHUB_CACHE_SECONDS);
  return body;
}

/**
 * Live grid data for an ISO or grid code.
 * @param {string} iso Grid code, e.g. "PJM", "ERCOT", "CAISO".
 * @param {string} [field] Field to return (default "demand_mw").
 * @return Live value from DC Hub (dchub.cloud).
 * @customfunction
 */
function DCHUB_GRID(iso, field) { return dchubCell("GRID", dchubFetch_("GRID", [iso]), field); }

/**
 * DCPI power verdict for a data center market.
 * @param {string} market Market slug, e.g. "phoenix", "northern-virginia".
 * @param {string} [field] Field to return (default "verdict"; e.g. "composite_score").
 * @return DCPI value from DC Hub (dchub.cloud), CC BY 4.0.
 * @customfunction
 */
function DCHUB_DCPI(market, field) { return dchubCell("DCPI", dchubFetch_("DCPI", [market]), field); }

/**
 * Data center facilities matching a search, as a table.
 * @param {string} query Free text, e.g. "Ashburn" or an operator name.
 * @param {number} [limit] Rows to return (default 10, max 100).
 * @return A table with a header row, from DC Hub (dchub.cloud).
 * @customfunction
 */
function DCHUB_FACILITIES(query, limit) { return dchubTable(dchubFetch_("FACILITIES", [query, limit])); }

/**
 * Retail electricity rate for a US state.
 * @param {string} state Two-letter state code, e.g. "VA".
 * @param {string} [field] Field to return (default "retail_rate_kwh").
 * @return Rate from DC Hub (dchub.cloud), sourced from EIA.
 * @customfunction
 */
function DCHUB_ENERGY_RATE(state, field) { return dchubCell("ENERGY_RATE", dchubFetch_("ENERGY_RATE", [state]), field); }
