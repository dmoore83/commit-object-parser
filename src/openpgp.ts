// Turns the OpenPGP packet stream inside a dearmored gpgsig header (or a
// dearmored public key block) into something node:crypto can act on, and
// uses that to check a commit's signature against a given RSA public key.
// This only covers what git commit signing actually produces: version 4
// signature packets over an RSA key, per RFC 4880 sections 5.2 and 5.5.

import { createHash, createPublicKey, createVerify, KeyObject } from "node:crypto";
import { ArmoredBlock } from "./armor.js";
import { ParsedCommit } from "./parser.js";
import { printCanonical } from "./printer.js";

export class OpenPgpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenPgpError";
  }
}

interface Packet {
  tag: number;
  body: Buffer;
}

// RFC 4880 4.2: reads consecutive packets, in either the old or new header
// format. Partial-length bodies (used for streamed data like compressed or
// literal packets) never occur in a single key or signature packet, so
// they're rejected rather than implemented.
function readPackets(data: Buffer): Packet[] {
  const packets: Packet[] = [];
  let offset = 0;
  while (offset < data.length) {
    const first = data[offset];
    if ((first & 0x80) === 0) {
      throw new OpenPgpError(`byte ${offset} is not a valid OpenPGP packet header`);
    }
    const newFormat = (first & 0x40) !== 0;
    offset++;
    let tag: number;
    let length: number;
    if (newFormat) {
      tag = first & 0x3f;
      const b0 = data[offset];
      if (b0 === undefined) throw new OpenPgpError("truncated packet length");
      if (b0 < 192) {
        length = b0;
        offset += 1;
      } else if (b0 < 224) {
        const b1 = data[offset + 1];
        if (b1 === undefined) throw new OpenPgpError("truncated packet length");
        length = (b0 - 192) * 256 + b1 + 192;
        offset += 2;
      } else if (b0 === 255) {
        if (offset + 5 > data.length) throw new OpenPgpError("truncated packet length");
        length = data.readUInt32BE(offset + 1);
        offset += 5;
      } else {
        throw new OpenPgpError("partial-length packets are not supported");
      }
    } else {
      tag = (first >> 2) & 0x0f;
      const lengthType = first & 0x03;
      if (lengthType === 0) {
        if (offset + 1 > data.length) throw new OpenPgpError("truncated packet length");
        length = data[offset];
        offset += 1;
      } else if (lengthType === 1) {
        if (offset + 2 > data.length) throw new OpenPgpError("truncated packet length");
        length = data.readUInt16BE(offset);
        offset += 2;
      } else if (lengthType === 2) {
        if (offset + 4 > data.length) throw new OpenPgpError("truncated packet length");
        length = data.readUInt32BE(offset);
        offset += 4;
      } else {
        throw new OpenPgpError("indeterminate-length packets are not supported");
      }
    }
    if (offset + length > data.length) throw new OpenPgpError("packet body runs past end of data");
    packets.push({ tag, body: data.subarray(offset, offset + length) });
    offset += length;
  }
  return packets;
}

// RFC 4880 3.2: a multiprecision integer is a 16-bit bit count followed by
// exactly enough bytes to hold that many bits, big-endian, with no leading
// zero byte.
function readMpi(data: Buffer, offset: number): { value: Buffer; next: number } {
  if (offset + 2 > data.length) throw new OpenPgpError("truncated MPI");
  const bits = data.readUInt16BE(offset);
  const byteLength = Math.ceil(bits / 8);
  const start = offset + 2;
  const end = start + byteLength;
  if (end > data.length) throw new OpenPgpError("truncated MPI");
  return { value: data.subarray(start, end), next: end };
}

// Algorithm IDs 1 (RSA Encrypt or Sign), 2 (Encrypt-Only) and 3 (Sign-Only)
// all use the same key material shape; this project only needs to check
// signatures, so the distinction between them doesn't matter here.
const RSA_ALGORITHMS = new Set([1, 2, 3]);

export interface RsaPublicKey {
  n: Buffer;
  e: Buffer;
}

// RFC 4880 5.5.2: a version-4 public key packet.
export function parseRsaPublicKeyPacket(body: Buffer): RsaPublicKey {
  const version = body[0];
  if (version !== 4) {
    throw new OpenPgpError(`unsupported public key packet version ${version}`);
  }
  const algorithm = body[5];
  if (!RSA_ALGORITHMS.has(algorithm)) {
    throw new OpenPgpError(`unsupported public key algorithm ${algorithm}, only RSA is supported`);
  }
  const { value: n, next } = readMpi(body, 6);
  const { value: e } = readMpi(body, next);
  return { n, e };
}

const PUBLIC_KEY_PACKET_TAG = 6;

// Imports the first RSA public key found in a dearmored "PUBLIC KEY BLOCK",
// as a node:crypto key object usable with verifyRsaSignature. node's JWK
// import accepts n/e in their raw big-endian form, so no ASN.1 DER encoding
// has to be built by hand.
export function importRsaPublicKey(block: ArmoredBlock): KeyObject {
  const packets = readPackets(block.body);
  const keyPacket = packets.find((p) => p.tag === PUBLIC_KEY_PACKET_TAG);
  if (!keyPacket) {
    throw new OpenPgpError("no public key packet found in armor block");
  }
  const { n, e } = parseRsaPublicKeyPacket(keyPacket.body);
  return createPublicKey({
    key: { kty: "RSA", n: n.toString("base64url"), e: e.toString("base64url") },
    format: "jwk",
  });
}

export interface RsaSignature {
  signatureType: number;
  pubkeyAlgorithm: number;
  hashAlgorithm: number;
  hashedData: Buffer;
  leftHash16: number;
  value: Buffer;
}

// RFC 4880 9.4: hash algorithm IDs this project can actually check, since
// node:crypto's RSA verify needs a digest name to pass to OpenSSL. MD5 and
// RIPEMD-160 (IDs 1 and 3) are left out - git has never used them for commit
// signing and OpenSSL builds increasingly drop RIPEMD-160 support entirely.
const HASH_ALGORITHMS: Record<number, string> = {
  2: "sha1",
  8: "sha256",
  9: "sha384",
  10: "sha512",
  11: "sha224",
};

const SIGNATURE_PACKET_TAG = 2;

// RFC 4880 5.2.3: a version-4 signature packet, RSA variant (a single MPI
// holding the signature value, rather than the pair DSA and ECDSA use).
export function parseRsaSignaturePacket(body: Buffer): RsaSignature {
  const version = body[0];
  if (version !== 4) {
    throw new OpenPgpError(`unsupported signature packet version ${version}`);
  }
  const signatureType = body[1];
  const pubkeyAlgorithm = body[2];
  if (!RSA_ALGORITHMS.has(pubkeyAlgorithm)) {
    throw new OpenPgpError(`unsupported signature algorithm ${pubkeyAlgorithm}, only RSA is supported`);
  }
  const hashAlgorithm = body[3];
  if (!(hashAlgorithm in HASH_ALGORITHMS)) {
    throw new OpenPgpError(`unsupported hash algorithm ${hashAlgorithm}`);
  }
  if (body.length < 6) throw new OpenPgpError("truncated signature packet");
  const hashedLength = body.readUInt16BE(4);
  const hashedStart = 6;
  const hashedEnd = hashedStart + hashedLength;
  if (hashedEnd + 2 > body.length) throw new OpenPgpError("truncated signature packet");
  const hashedData = body.subarray(hashedStart, hashedEnd);
  const unhashedLength = body.readUInt16BE(hashedEnd);
  const unhashedEnd = hashedEnd + 2 + unhashedLength;
  if (unhashedEnd + 2 > body.length) throw new OpenPgpError("truncated signature packet");
  const leftHash16 = body.readUInt16BE(unhashedEnd);
  const { value } = readMpi(body, unhashedEnd + 2);
  return { signatureType, pubkeyAlgorithm, hashAlgorithm, hashedData, leftHash16, value };
}

function uint16be(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(n);
  return buf;
}

function uint32be(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n);
  return buf;
}

// RFC 4880 5.2.4: what actually gets hashed isn't just the signed data - it's
// the data followed by a reconstruction of the signature packet's own
// leading fields (everything the hashed subpackets can bind), closed off by
// a fixed trailer that pins the length of that reconstruction down.
function signaturePreimage(payload: Buffer, sig: RsaSignature): Buffer {
  const hashedPart = Buffer.concat([
    Buffer.from([4, sig.signatureType, sig.pubkeyAlgorithm, sig.hashAlgorithm]),
    uint16be(sig.hashedData.length),
    sig.hashedData,
  ]);
  const trailer = Buffer.concat([Buffer.from([4, 0xff]), uint32be(hashedPart.length)]);
  return Buffer.concat([payload, hashedPart, trailer]);
}

export interface SignatureVerification {
  valid: boolean;
  reason?: string;
}

// Checks an RSA signature packet against the exact bytes it was computed
// over. `payload` is whatever was hashed - for a git commit that's the
// object text with the gpgsig header removed entirely, not just blanked.
export function verifyRsaSignature(
  payload: Buffer,
  signature: RsaSignature,
  publicKey: KeyObject
): SignatureVerification {
  const hashName = HASH_ALGORITHMS[signature.hashAlgorithm];
  const preimage = signaturePreimage(payload, signature);

  const digest = createHash(hashName).update(preimage).digest();
  if (digest.readUInt16BE(0) !== signature.leftHash16) {
    return { valid: false, reason: "signature's stored hash prefix does not match the recomputed hash" };
  }

  const modulusBits = publicKey.asymmetricKeyDetails?.modulusLength;
  const modulusBytes = modulusBits ? Math.ceil(modulusBits / 8) : signature.value.length;
  const padding = modulusBytes - signature.value.length;
  if (padding < 0) {
    return { valid: false, reason: "signature value is longer than the public key's modulus" };
  }
  const sigBytes = padding > 0 ? Buffer.concat([Buffer.alloc(padding), signature.value]) : signature.value;

  const valid = createVerify(hashName).update(preimage).verify(publicKey, sigBytes);
  return valid ? { valid: true } : { valid: false, reason: "RSA signature does not verify against the given public key" };
}

// Reconstructs the exact bytes git hashed before signing: the commit object
// with the gpgsig header removed outright (not blanked, not reordered).
function signaturePayload(commit: ParsedCommit): Buffer {
  const withoutSignature: ParsedCommit = {
    ...commit,
    extraHeaders: commit.extraHeaders.filter((header) => header.key !== "gpgsig"),
  };
  return Buffer.from(printCanonical(withoutSignature), "utf8");
}

// High-level entry point: given a commit already carrying a parsed gpgsig
// signature, and a dearmored public key block, checks one against the other.
export function verifyCommitSignature(commit: ParsedCommit, publicKeyBlock: ArmoredBlock): SignatureVerification {
  if (!commit.signature) {
    throw new OpenPgpError("commit has no gpgsig signature to verify");
  }
  const sigPackets = readPackets(commit.signature.body);
  const sigPacket = sigPackets.find((p) => p.tag === SIGNATURE_PACKET_TAG);
  if (!sigPacket) {
    throw new OpenPgpError("no signature packet found in gpgsig header");
  }
  const signature = parseRsaSignaturePacket(sigPacket.body);
  const publicKey = importRsaPublicKey(publicKeyBlock);
  return verifyRsaSignature(signaturePayload(commit), signature, publicKey);
}
