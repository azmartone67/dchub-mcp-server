// Deterministic ZIP read/write for dchub.dxt — the Claude Desktop extension bundle.
//
// WHY THIS EXISTS (★2026-08-30). dchub.dxt is a COMMITTED BINARY at the repo root.
// Nothing built it: it was hand-zipped in a88e500 (2026-07-26), last repacked by
// hand on 2026-07-30 (#107), and then went a month without one. Measured on
// origin/main at 887c250, the shipped bundle's embedded manifest.json read
//
//   version 1.0.0 · 81 tools · 15,300+ facilities
//
// against a canon of 2.12.1 / 83 / 19,500+. The bridge CODE inside was current —
// only the metadata rotted. This is the same partial-heal shape the version loop
// keeps turning up, one level worse: sync-tools-manifest.mjs heals
// dxt/manifest.json and has no idea a zip beside it carries a COPY, so the file a
// user actually installs was the stale one. `grep -c dchub.dxt` was 0 in both the
// sync script and daily-manifest-sync.yml's $OWNED.
//
// DEPENDENCY-FREE on purpose, matching dxt/server/index.js's own rule ("no
// node_modules to package, sign, or patch") and avoiding a shell-out to `zip`,
// which would make the guard depend on a binary being installed.
//
// ★ CRC32 is implemented here rather than taken from zlib.crc32, which landed in
// Node 22.15. CI pins `node-version: '22'` (floating), so relying on it would make
// this guard's availability a function of when the runner image last moved.
//
// ★ DETERMINISM is the point. A zip embeds per-entry mtimes; if the packer emitted
// a fresh timestamp each run, the daily job would commit a new binary every day
// forever. Every entry is stamped with the ZIP epoch (1980-01-01) and written in a
// fixed order with no extra fields, so identical inputs give identical bytes.
//
// ★ Even so, the GUARD compares CONTENTS, never bytes — see bundleDrift(). Two
// zlib builds may deflate the same input to different (equally valid) streams, and
// a byte-comparison guard would then fail for a reason that has nothing to do with
// drift. The invariant that matters is "the bundle carries the current source".
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ZIP epoch: 1980-01-01 00:00:00. DOS date = (y-1980)<<9 | m<<5 | d, time = h<<11 | m<<5 | s/2.
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/**
 * Build a deterministic ZIP.
 * @param {{name: string, data?: Buffer}[]} entries — a name ending in '/' is an
 *   empty directory entry (stored, not deflated).
 * @returns {Buffer}
 */
export function buildZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const isDir = e.name.endsWith('/');
    const raw = isDir ? Buffer.alloc(0) : e.data;
    if (!isDir && !Buffer.isBuffer(raw)) throw new Error(`entry ${e.name}: data must be a Buffer`);
    const method = isDir ? 0 : 8;
    const comp = isDir ? Buffer.alloc(0) : zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const name = Buffer.from(e.name, 'utf8');

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(SIG_LOCAL, 0);
    lfh.writeUInt16LE(20, 4);              // version needed to extract
    lfh.writeUInt16LE(0, 6);               // flags
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(DOS_TIME, 10);
    lfh.writeUInt16LE(DOS_DATE, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(name.length, 26);
    lfh.writeUInt16LE(0, 28);              // extra len
    local.push(lfh, name, comp);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(SIG_CENTRAL, 0);
    cdh.writeUInt16LE(20, 4);              // version made by
    cdh.writeUInt16LE(20, 6);              // version needed
    cdh.writeUInt16LE(0, 8);               // flags
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(DOS_TIME, 12);
    cdh.writeUInt16LE(DOS_DATE, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(comp.length, 20);
    cdh.writeUInt32LE(raw.length, 24);
    cdh.writeUInt16LE(name.length, 28);
    cdh.writeUInt16LE(0, 30);              // extra len
    cdh.writeUInt16LE(0, 32);              // comment len
    cdh.writeUInt16LE(0, 34);              // disk number start
    cdh.writeUInt16LE(0, 36);              // internal attrs
    cdh.writeUInt32LE(isDir ? 0x41ed0010 : 0x81a40000, 38); // drwxr-xr-x+DIR / -rw-r--r--
    cdh.writeUInt32LE(offset, 42);
    central.push(cdh, name);

    offset += lfh.length + name.length + comp.length;
  }

  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);                // this disk
  eocd.writeUInt16LE(0, 6);                // disk with CD
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);               // comment len
  return Buffer.concat([...local, cd, eocd]);
}

/**
 * Read a ZIP's entries. Directory entries come back as zero-length buffers.
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>}
 */
export function readZipEntries(buf) {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive: end-of-central-directory not found');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error(`corrupt central directory at entry ${n}`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    if (buf.readUInt32LE(lho) !== SIG_LOCAL) throw new Error(`corrupt local header for ${name}`);
    const dataStart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const comp = buf.subarray(dataStart, dataStart + compSize);
    if (method !== 0 && method !== 8) throw new Error(`${name}: unsupported compression method ${method}`);
    out.set(name, method === 0 ? Buffer.from(comp) : zlib.inflateRawSync(comp));

    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

// The bundle's shape, in the order the hand-built original used. `server/` is an
// explicit empty directory entry because the original carried one; keeping the
// shape identical means this packer's output differs from the known-working
// bundle only in the metadata that actually changed.
export const BUNDLE_LAYOUT = [
  { name: 'manifest.json', src: 'dxt/manifest.json' },
  { name: 'server/' },
  { name: 'server/index.js', src: 'dxt/server/index.js' },
];

/**
 * Pack the bundle from already-resolved source contents.
 * @param {(src: string) => Buffer} readSource — maps 'dxt/manifest.json' to its
 *   CURRENT bytes (in the sync script this is readCur, so pending heals are seen).
 */
export function packBundle(readSource) {
  return buildZip(BUNDLE_LAYOUT.map((e) => (
    e.src ? { name: e.name, data: readSource(e.src) } : { name: e.name }
  )));
}

/**
 * Compare a committed bundle against source. Returns [] when they agree.
 * CONTENTS only — never bytes; see the header note on zlib variance.
 * @returns {string[]} human-readable drift descriptions
 */
export function bundleDrift(bundleBuf, readSource) {
  let entries;
  try {
    entries = readZipEntries(bundleBuf);
  } catch (e) {
    return [`unreadable as a zip (${e.message}) — the bundle a user installs cannot be verified`];
  }
  const out = [];
  const expected = new Set(BUNDLE_LAYOUT.map((e) => e.name));
  for (const name of entries.keys()) {
    if (!expected.has(name)) out.push(`carries an unexpected entry "${name}"`);
  }
  for (const e of BUNDLE_LAYOUT) {
    if (!entries.has(e.name)) { out.push(`is MISSING entry "${e.name}"`); continue; }
    if (!e.src) continue;
    const have = entries.get(e.name);
    const want = readSource(e.src);
    if (!have.equals(want)) {
      out.push(`entry "${e.name}" does not match ${e.src} `
        + `(bundle ${have.length} bytes, source ${want.length} bytes)`);
    }
  }
  return out;
}
