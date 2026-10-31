/*
 * DC Hub for Excel: custom functions (namespace DCHUB).
 *   =DCHUB.GRID("PJM")   =DCHUB.DCPI("phoenix")   =DCHUB.FACILITIES("Ashburn",10)   =DCHUB.ENERGY_RATE("VA")
 * Loaded by taskpane.html (shared runtime) after cells.js, which holds the mapping.
 * The key is set in the task pane and kept in OfficeRuntime.storage on this device.
 */
/* global CustomFunctions, OfficeRuntime, dchubUrl, dchubCell, dchubTable */

async function dchubFetch(fn, args) {
  var key = "";
  try { key = (await OfficeRuntime.storage.getItem("dchub_api_key")) || ""; } catch (e) { key = ""; }
  var headers = { Accept: "application/json" };
  if (key) headers["X-API-Key"] = key;
  try {
    var res = await fetch(dchubUrl(fn, args, "excel"), { headers: headers });
    return await res.json();
  } catch (e) {
    return null;
  }
}

/** Live grid data for an ISO. @customfunction GRID */
async function grid(iso, field) { return dchubCell("GRID", await dchubFetch("GRID", [iso]), field); }
/** DCPI verdict for a market. @customfunction DCPI */
async function dcpi(market, field) { return dchubCell("DCPI", await dchubFetch("DCPI", [market]), field); }
/** Facilities matching a search, as a table. @customfunction FACILITIES */
async function facilities(query, limit) { return dchubTable(await dchubFetch("FACILITIES", [query, limit])); }
/** Retail electricity rate for a US state. @customfunction ENERGY_RATE */
async function energyRate(state, field) { return dchubCell("ENERGY_RATE", await dchubFetch("ENERGY_RATE", [state]), field); }

if (typeof CustomFunctions !== "undefined") {
  CustomFunctions.associate("GRID", grid);
  CustomFunctions.associate("DCPI", dcpi);
  CustomFunctions.associate("FACILITIES", facilities);
  CustomFunctions.associate("ENERGY_RATE", energyRate);
}
