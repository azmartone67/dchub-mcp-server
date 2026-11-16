// changelog-entry.mjs: the CHANGELOG.md entry `sync-tools-manifest --fix` writes when it
// patch-bumps the version (Grok Note P follow-up, 2026-11-16).
//
// test/changelog-and-publish-gate.test.mjs (hard gate) requires the top CHANGELOG entry to be
// the version every publish surface carries. The daily manifest sync can bump the patch on its
// own (server.json version fence); without an entry the bot's pre-push hard gate fails and the
// day's heal is held. So the bump writes the minimal entry itself, in the format that test reads:
//
//   ## <x.y.z> (<YYYY-MM-DD>)
//
//   - <one user-facing line>
//
// No plan names, prices or paid/upgrade/trial wording: the same test scans the whole file.

export const CHANGELOG_FILE = 'CHANGELOG.md';
export const SYNC_ENTRY_LINE = 'Tool catalog and listing metadata sync; no behaviour change.';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Today's date in UTC, YYYY-MM-DD (the date the workflow runs, whatever the runner's TZ). */
export const todayUTC = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Return `text` with a `## <version> (<date>)` entry at the top of the version list.
 * Unchanged when an entry for `version` already exists (a re-run must not stack a second one).
 * The entry goes above the first `## x.y.z (` heading; with none, above the first `## ` heading
 * (e.g. "How releases are cut"); with no heading at all, at the end.
 */
export function addChangelogEntry(text, version, date, line = SYNC_ENTRY_LINE) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`changelog entry: not a bare x.y.z version: ${version}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`changelog entry: not a YYYY-MM-DD date: ${date}`);
  if (new RegExp(`^## ${esc(version)} \\(`, 'm').test(text)) return text;
  const entry = `## ${version} (${date})\n\n- ${line}\n\n`;
  const at = text.search(/^## \d+\.\d+\.\d+ \(/m);
  const pos = at >= 0 ? at : text.search(/^## /m);
  if (pos >= 0) return text.slice(0, pos) + entry + text.slice(pos);
  return `${text.replace(/\n*$/, '')}\n\n${entry.replace(/\n+$/, '\n')}`;
}
