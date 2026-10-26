/**
 * Just enough ZIP to read and write Anki packages.
 *
 * Anki packages are ordinary ZIP files with stored or deflated entries. The
 * browser already has a deflate implementation (`CompressionStream`), so the
 * container format is all that needs writing: local headers, a central
 * directory and an end record, with CRC-32 checksums.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export const inflateRaw = (bytes: Uint8Array) => pipe(bytes, new DecompressionStream('deflate-raw'));
export const deflateRaw = (bytes: Uint8Array) => pipe(bytes, new CompressionStream('deflate-raw'));

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  dataOffset: number;
}

/**
 * Lists entries from the central directory - the authoritative copy, which
 * stays correct even when local headers defer their sizes to a data
 * descriptor, as streaming zip writers do.
 */
export function listEntries(buffer: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This is not a valid package: no ZIP directory was found.');

  let count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  // ZIP64, for very large collections.
  if (offset === 0xffffffff || count === 0xffff) {
    const locator = eocd - 20;
    if (locator >= 0 && view.getUint32(locator, true) === 0x07064b50) {
      const z64 = Number(view.getBigUint64(locator + 8, true));
      count = Number(view.getBigUint64(z64 + 32, true));
      offset = Number(view.getBigUint64(z64 + 48, true));
    }
  }

  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('The package directory is damaged.');
    const method = view.getUint16(offset + 10, true);
    let compressedSize = view.getUint32(offset + 20, true);
    let size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    let localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(buffer.subarray(offset + 46, offset + 46 + nameLength));

    // ZIP64 extra field: sizes and offset that did not fit in 32 bits.
    let extra = offset + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = view.getUint16(extra, true);
      const length = view.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let p = extra + 4;
        if (size === 0xffffffff) {
          size = Number(view.getBigUint64(p, true));
          p += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = Number(view.getBigUint64(p, true));
          p += 8;
        }
        if (localOffset === 0xffffffff) localOffset = Number(view.getBigUint64(p, true));
      }
      extra += 4 + length;
    }

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    entries.set(name, { name, method, compressedSize, size, dataOffset: localOffset + 30 + localNameLength + localExtraLength });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function readEntry(buffer: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const raw = buffer.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  if (entry.method === 0) return raw.slice();
  if (entry.method === 8) return inflateRaw(raw);
  throw new Error(`Unsupported compression in "${entry.name}" (method ${entry.method}).`);
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Writes a ZIP. Entries already compressed by another scheme (images) are
 * stored rather than deflated again, which saves time and loses nothing.
 */
export async function writeZip(files: { name: string; data: Uint8Array; store?: boolean }[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const deflated = file.store ? null : await deflateRaw(file.data);
    const useDeflate = deflated !== null && deflated.length < file.data.length;
    const body = useDeflate ? deflated : file.data;
    const method = useDeflate ? 8 : 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, file.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, body);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, method, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, file.data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + body.length;
  }

  const centralSize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' });
}
