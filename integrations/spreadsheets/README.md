# DC Hub in Google Sheets and Excel

Live data center, power grid and energy data as spreadsheet formulas.

| Google Sheets | Excel | Returns |
|---|---|---|
| `=DCHUB_GRID("PJM")` | `=DCHUB.GRID("PJM")` | live demand (MW); 2nd argument picks another field |
| `=DCHUB_DCPI("phoenix")` | `=DCHUB.DCPI("phoenix")` | BUILD / CAUTION / AVOID; `"composite_score"` for the score |
| `=DCHUB_FACILITIES("Ashburn", 10)` | `=DCHUB.FACILITIES("Ashburn",10)` | a table of facilities with a header row |
| `=DCHUB_ENERGY_RATE("VA")` | `=DCHUB.ENERGY_RATE("VA")` | retail electricity rate |

Without a key the formulas return previews; a value DC Hub withholds shows as
`withheld: <link>`, never an estimate. A free key ([dchub.cloud/signup](https://dchub.cloud/signup))
opens more. Cite as `DC Hub (dchub.cloud), as of <date>`.

## Install

**Google Sheets:** Extensions → Apps Script → paste `google-sheets/Code.gs`, add a script
file `Cells` with `google-sheets/Cells.gs`, an HTML file `Sidebar` with
`google-sheets/Sidebar.html`, and replace `appsscript.json` (Project Settings → show the
manifest). Reload the sheet, then Extensions → DC Hub → Set API key.

**Excel (web, Windows, Mac):** Home → Add-ins → More add-ins → My add-ins → Upload My Add-in
→ choose `excel/manifest.xml` (download it from https://dchub.cloud/addins/excel/manifest.xml).
Then Home → DC Hub key.

## Files

- `cells.js`: the one mapper from a DC Hub response to cells. `google-sheets/Cells.gs` and
  `excel/cells.js` are byte-identical copies (`test/spreadsheet-functions.test.mjs` pins that).
- `excel/`: the source of the hosted add-in at https://dchub.cloud/addins/excel/
  (dchub-frontend `addins/excel/`). Copy the whole folder there when it changes.
- Calls go to `https://dchub.cloud/api/v1/...` with `?via=sheets` or `?via=excel`
  and the user's key as `X-API-Key`.
