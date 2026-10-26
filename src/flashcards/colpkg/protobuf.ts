/**
 * A minimal protobuf reader.
 *
 * Modern Anki stores a few things as protobuf messages: the package
 * metadata, the media list, and note type, deck and deck-option settings
 * inside the database. Only reading is needed, and only of varints,
 * length-delimited fields and floats, so this is a few dozen lines rather
 * than a code generator.
 */

export interface Field {
  number: number;
  wire: number;
  /** Varint and fixed values. */
  value?: number;
  /** Length-delimited payloads: strings, bytes, nested messages, packed arrays. */
  bytes?: Uint8Array;
}

function varint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  let byte: number;
  do {
    if (pos >= buf.length) throw new Error('Truncated protobuf varint.');
    byte = buf[pos++];
    // Plain arithmetic rather than bit operations, so values above 2^31 survive.
    result += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte & 0x80);
  return [result, pos];
}

export function decode(buf: Uint8Array): Field[] {
  const out: Field[] = [];
  let pos = 0;
  while (pos < buf.length) {
    let key: number;
    [key, pos] = varint(buf, pos);
    const number = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) {
      let value: number;
      [value, pos] = varint(buf, pos);
      out.push({ number, wire, value });
    } else if (wire === 2) {
      let length: number;
      [length, pos] = varint(buf, pos);
      out.push({ number, wire, bytes: buf.subarray(pos, pos + length) });
      pos += length;
    } else if (wire === 5) {
      const view = new DataView(buf.buffer, buf.byteOffset + pos, 4);
      out.push({ number, wire, value: view.getFloat32(0, true) });
      pos += 4;
    } else if (wire === 1) {
      const view = new DataView(buf.buffer, buf.byteOffset + pos, 8);
      out.push({ number, wire, value: view.getFloat64(0, true) });
      pos += 8;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}.`);
    }
  }
  return out;
}

const text = new TextDecoder();

export function str(fields: Field[], number: number): string | undefined {
  const f = fields.find((x) => x.number === number && x.bytes);
  return f?.bytes ? text.decode(f.bytes) : undefined;
}

export function num(fields: Field[], number: number): number | undefined {
  return fields.find((x) => x.number === number && x.value !== undefined)?.value;
}

export function msg(fields: Field[], number: number): Field[] | undefined {
  const f = fields.find((x) => x.number === number && x.bytes);
  return f?.bytes ? decode(f.bytes) : undefined;
}

/** A repeated float field, packed (the proto3 default) or not. */
export function floats(fields: Field[], number: number): number[] {
  const out: number[] = [];
  for (const f of fields.filter((x) => x.number === number)) {
    if (f.wire === 5 && f.value !== undefined) out.push(f.value);
    else if (f.bytes) {
      const view = new DataView(f.bytes.buffer, f.bytes.byteOffset, f.bytes.byteLength);
      for (let i = 0; i + 4 <= f.bytes.byteLength; i += 4) out.push(view.getFloat32(i, true));
    }
  }
  return out;
}

export function repeated(fields: Field[], number: number): Field[][] {
  return fields.filter((x) => x.number === number && x.bytes).map((x) => decode(x.bytes as Uint8Array));
}
