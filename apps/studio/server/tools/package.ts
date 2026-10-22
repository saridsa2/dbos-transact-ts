import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { fileMapSchema, type ToolFiles } from '../../lib/tools/contracts';
import { packageHash, sha } from './compiler';
export function packTool(raw: ToolFiles) {
  const files = fileMapSchema.parse(raw),
    index = Object.keys(files)
      .sort()
      .map((path) => ({ path, sha256: sha(files[path]) }));
  return zipSync(
    Object.fromEntries([
      ...Object.entries(files).map(([p, s]) => [p, strToU8(s)] as const),
      ['__stackproc.json', strToU8(JSON.stringify({ schemaVersion: 1, hash: packageHash(files), files: index }))],
    ]),
    { level: 6 },
  );
}
export function unpackTool(bytes: Uint8Array): ToolFiles {
  if (bytes.length > 1100000) throw Error('Archive exceeds upload size.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Inspect the central directory before allocating decompressed entries.
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--)
    if (view.getUint32(p, true) === 0x06054b50) {
      end = p;
      break;
    }
  if (end < 0) throw Error('Invalid tool archive.');
  const count = view.getUint16(end + 10, true),
    offset = view.getUint32(end + 16, true);
  if (count > 101 || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0)
    throw Error('Unsupported archive structure.');
  let at = offset,
    total = 0;
  const names = new Set<string>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw Error('Invalid archive directory.');
    const compressed = view.getUint32(at + 20, true),
      size = view.getUint32(at + 24, true),
      len = view.getUint16(at + 28, true),
      extra = view.getUint16(at + 30, true),
      comment = view.getUint16(at + 32, true),
      mode = view.getUint32(at + 38, true) >>> 16;
    if (at + 46 + len + extra + comment > bytes.length) throw Error('Invalid archive path.');
    const path = strFromU8(bytes.subarray(at + 46, at + 46 + len));
    total += size;
    if (
      names.has(path) ||
      total > 1100000 ||
      size > 1048576 ||
      size > Math.max(1024, compressed * 200) ||
      ((mode & 0xf000) !== 0 && (mode & 0xf000) !== 0x8000)
    )
      throw Error('Archive duplicates, special files or size limits are invalid.');
    if (path !== '__stackproc.json') fileMapSchema.parse({ [path]: '' });
    names.add(path);
    at += 46 + len + extra + comment;
  }
  const unpacked = unzipSync(bytes),
    files: ToolFiles = {};
  if (Object.keys(unpacked).length !== count) throw Error('Archive file index mismatch.');
  const envelope = JSON.parse(strFromU8(unpacked['__stackproc.json'] ?? new Uint8Array()));
  for (const [path, data] of Object.entries(unpacked)) if (path !== '__stackproc.json') files[path] = strFromU8(data);
  fileMapSchema.parse(files);
  if (
    envelope.schemaVersion !== 1 ||
    envelope.hash !== packageHash(files) ||
    JSON.stringify(envelope.files) !==
      JSON.stringify(
        Object.keys(files)
          .sort()
          .map((path) => ({ path, sha256: sha(files[path]) })),
      )
  )
    throw Error('Archive integrity check failed.');
  return files;
}
