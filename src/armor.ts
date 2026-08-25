// Parses and re-serializes OpenPGP's ASCII-armor envelope (RFC 4880 section
// 6.2), the wrapper a `gpgsig` header's value is written in. This only deals
// with the envelope: peeling off the "-----BEGIN PGP ...-----" markers,
// decoding the base64 body, and checking its CRC24 checksum. Making sense of
// the decoded bytes as an actual OpenPGP signature packet, and checking that
// signature against a key, is a separate step built on top of this one.

export interface ArmoredBlock {
  type: string;
  headers: [string, string][];
  body: Buffer;
}

export class ArmorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArmorError";
  }
}

const BEGIN_RE = /^-----BEGIN PGP ([^-]+)-----$/;
const END_RE = /^-----END PGP ([^-]+)-----$/;
const BASE64_LINE_RE = /^[A-Za-z0-9+/]+=*$/;
const CHECKSUM_RE = /^=([A-Za-z0-9+/]{4})$/;

// RFC 4880 section 6.1: a 24-bit CRC used to catch transcription errors in
// the base64 body, computed with this exact init value and polynomial.
const CRC24_INIT = 0xb704ce;
const CRC24_POLY = 0x1864cfb;

function crc24(data: Buffer): number {
  let crc = CRC24_INIT;
  for (const byte of data) {
    crc ^= byte << 16;
    for (let i = 0; i < 8; i++) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= CRC24_POLY;
    }
  }
  return crc & 0xffffff;
}

function encodeChecksum(crc: number): string {
  return Buffer.from([(crc >> 16) & 0xff, (crc >> 8) & 0xff, crc & 0xff]).toString("base64");
}

// `text` is expected to already have continuation-line folding undone, i.e.
// one un-prefixed line per logical line joined with "\n" - the same shape
// `CommitHeader.value` is in for a `gpgsig` header once parseCommit has run.
export function dearmor(text: string): ArmoredBlock {
  const lines = text.split("\n");
  const lastIndex = lines.length - 1;

  const beginMatch = BEGIN_RE.exec(lines[0] ?? "");
  if (!beginMatch) {
    throw new ArmorError(`missing armor header line: ${JSON.stringify(lines[0] ?? "")}`);
  }
  const type = beginMatch[1];

  const endMatch = END_RE.exec(lines[lastIndex] ?? "");
  if (!endMatch) {
    throw new ArmorError(`missing armor trailer line: ${JSON.stringify(lines[lastIndex] ?? "")}`);
  }
  if (endMatch[1] !== type) {
    throw new ArmorError(`armor trailer type "${endMatch[1]}" does not match header type "${type}"`);
  }

  let i = 1;
  const headers: [string, string][] = [];
  while (i < lastIndex && lines[i] !== "") {
    const colon = lines[i].indexOf(":");
    if (colon === -1) {
      throw new ArmorError(`malformed armor header line: ${JSON.stringify(lines[i])}`);
    }
    headers.push([lines[i].slice(0, colon).trim(), lines[i].slice(colon + 1).trim()]);
    i++;
  }
  if (lines[i] !== "") {
    throw new ArmorError("missing blank line separating armor headers from body");
  }
  i++;

  const bodyLines: string[] = [];
  let checksum: string | undefined;
  for (; i < lastIndex; i++) {
    const line = lines[i];
    const checksumMatch = CHECKSUM_RE.exec(line);
    if (checksumMatch) {
      checksum = checksumMatch[1];
      i++;
      break;
    }
    if (!BASE64_LINE_RE.test(line)) {
      throw new ArmorError(`malformed armor body line: ${JSON.stringify(line)}`);
    }
    bodyLines.push(line);
  }
  if (i !== lastIndex) {
    throw new ArmorError("data found after the armor checksum line");
  }

  const body = Buffer.from(bodyLines.join(""), "base64");

  if (checksum !== undefined) {
    const expected = encodeChecksum(crc24(body));
    if (checksum !== expected) {
      throw new ArmorError(`armor checksum mismatch: expected ${expected}, got ${checksum}`);
    }
  }

  return { type, headers, body };
}

// Wraps `body` back into an armored block, in the same shape `dearmor`
// accepts. Line length and the always-present checksum follow GnuPG's own
// convention rather than the (larger) maximum RFC 4880 allows.
export function armor(type: string, body: Buffer, headers: [string, string][] = []): string {
  const lines = [`-----BEGIN PGP ${type}-----`];
  for (const [key, value] of headers) lines.push(`${key}: ${value}`);
  lines.push("");
  const encoded = body.toString("base64");
  for (let i = 0; i < encoded.length; i += 64) lines.push(encoded.slice(i, i + 64));
  lines.push(`=${encodeChecksum(crc24(body))}`);
  lines.push(`-----END PGP ${type}-----`);
  return lines.join("\n");
}
