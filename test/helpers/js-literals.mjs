// test/helpers/js-literals.mjs — pull the STRING LITERALS out of a JS source text.
//
// Why a lexer and not a regex over lines: the copy this repo ships to agents lives in
// single-, double- and backtick-quoted strings (a tool description is a chain of them),
// and the same words ("Pro", "Developer", "$10") also appear in comments, regex literals
// and identifiers that are not copy. A line grep counts all of those; this returns only
// string-literal text, with comments and regex literals skipped.
//
// Template literals: the text parts are returned and each `${ ... }` expression is replaced
// by a single space — so a price built from canon (`${PLAN_PRICE.developer}`) is NOT a
// literal price, which is exactly the distinction the price guard needs.
//
// Pure: no fs, no network. Returns [{ line, text }].
export function stringLiterals(src) {
  const out = [];
  const n = src.length;
  let i = 0, line = 1;
  let prev = '';            // last significant (non-space, non-comment) char, for regex-vs-divide
  const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
  const bump = (c) => { if (c === '\n') line++; };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { bump(src[i]); i++; }
      i += 2; continue;
    }
    if (c === "'" || c === '"') {
      const q = c, startLine = line; let s = ''; i++;
      while (i < n && src[i] !== q && src[i] !== '\n') {
        if (src[i] === '\\') { if (src[i + 1] === '\n') line++; s += src[i + 1]; i += 2; continue; }
        s += src[i++];
      }
      i++; out.push({ line: startLine, text: s }); prev = q; continue;
    }
    if (c === '`') {
      const startLine = line; let s = ''; i++; let depth = 0;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') { s += src[i + 1]; if (src[i + 1] === '\n') line++; i += 2; continue; }
        if (depth === 0 && ch === '`') break;
        if (ch === '$' && src[i + 1] === '{') { depth++; s += ' '; i += 2; continue; }
        if (depth > 0) {
          if (ch === '{') depth++; else if (ch === '}') depth--;
          bump(ch); i++; continue;
        }
        bump(ch); s += ch; i++;
      }
      i++; out.push({ line: startLine, text: s }); prev = '`'; continue;
    }
    if (c === '/' && REGEX_AFTER.has(prev)) {          // a regex literal: skip it whole
      i++; let inClass = false;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true; else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        i++;
      }
      i++; while (i < n && /[a-z]/i.test(src[i])) i++;
      prev = '/'; continue;
    }
    prev = c; i++;
  }
  return out;
}
