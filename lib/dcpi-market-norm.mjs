// One normal form for place names, shared by the DCPI market table generator
// and its matcher so an alias and the text it must match are folded alike:
// accents dropped (Querétaro → queretaro), dashes to spaces (Midland–Odessa →
// midland odessa), periods and apostrophes dropped (St. Louis → st louis,
// Coeur d'Alene → coeur dalene), everything else but commas to one space.
export function normPlace(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[‐-―-]/g, ' ').replace(/[.'’]/g, '')
    .replace(/[^a-z0-9,]+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').replace(/^[ ,]+|[ ,]+$/g, '');
}
