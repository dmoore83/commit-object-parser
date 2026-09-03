import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync, KeyObject } from "node:crypto";
import { armor, dearmor } from "./armor.js";
import { parseCommit, ParsedCommit } from "./parser.js";
import { printCanonical } from "./printer.js";
import {
  importRsaPublicKey,
  verifyCommitSignature,
  parseRsaPublicKeyPacket,
  parseRsaSignaturePacket,
  OpenPgpError,
} from "./openpgp.js";
import { REGULAR_COMMIT } from "./test-fixtures.js";

// Everything below builds a real, signed commit from scratch at test time -
// generating an RSA keypair, hashing and signing per RFC 4880 5.2.4, and
// hand-assembling the OpenPGP packets - rather than pasting in fixed key
// material. That keeps this file exercising the actual signing math instead
// of a canned example, and sidesteps ever needing to check in anything that
// looks like a real key.

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

// RFC 4880 3.2: MPI = 16-bit bit count + minimal big-endian bytes.
function mpiFromBuffer(buf: Buffer): Buffer {
  let start = 0;
  while (start < buf.length - 1 && buf[start] === 0) start++;
  const trimmed = buf.subarray(start);
  let bitLength = (trimmed.length - 1) * 8;
  let firstByte = trimmed[0];
  while (firstByte > 0) {
    bitLength++;
    firstByte >>= 1;
  }
  return Buffer.concat([uint16be(bitLength), trimmed]);
}

// RFC 4880 4.2.2: new-format packet header. Covers the one- and two-octet
// length forms, which is all a single RSA key or signature packet ever
// needs (even a 4096-bit modulus MPI stays well under the 8383-byte cutoff
// for the two-octet form).
function wrapPacket(tag: number, body: Buffer): Buffer {
  let header: Buffer;
  if (body.length < 192) {
    header = Buffer.from([0xc0 | tag, body.length]);
  } else if (body.length < 8384) {
    const v = body.length - 192;
    header = Buffer.from([0xc0 | tag, (v >> 8) + 192, v & 0xff]);
  } else {
    throw new Error("test helper only supports packet bodies under 8384 bytes");
  }
  return Buffer.concat([header, body]);
}

function buildPublicKeyArmor(n: Buffer, e: Buffer): string {
  const body = Buffer.concat([Buffer.from([4, 0, 0, 0, 0, 1]), mpiFromBuffer(n), mpiFromBuffer(e)]);
  return armor("PUBLIC KEY BLOCK", wrapPacket(6, body));
}

// RFC 4880 5.2.3/5.2.4: builds a version-4 RSA signature packet over
// `payload`, with no hashed or unhashed subpackets.
function buildSignatureArmor(payload: Buffer, hashAlgoCode: number, hashName: string, privateKey: KeyObject): string {
  const hashedPart = Buffer.concat([Buffer.from([4, 0x00, 1, hashAlgoCode]), uint16be(0)]);
  const trailer = Buffer.concat([Buffer.from([4, 0xff]), uint32be(hashedPart.length)]);
  const preimage = Buffer.concat([payload, hashedPart, trailer]);
  const leftHash16 = createHash(hashName).update(preimage).digest().subarray(0, 2);
  const signature = createSign(hashName).update(preimage).sign(privateKey);
  const body = Buffer.concat([hashedPart, uint16be(0), leftHash16, mpiFromBuffer(signature)]);
  return armor("SIGNATURE", wrapPacket(2, body));
}

function foldHeader(key: string, value: string): string {
  return value
    .split("\n")
    .map((line, i) => (i === 0 ? `${key} ${line}` : ` ${line}`))
    .join("\n");
}

const UNSIGNED_COMMIT: ParsedCommit = {
  tree: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  parents: ["1a2b3c4d5e6f70819203a4b5c6d7e8f901234567"],
  author: { name: "Jane Doe", email: "jane@example.com", timestamp: 1704067200, tzOffset: "+0000" },
  committer: { name: "Jane Doe", email: "jane@example.com", timestamp: 1704067200, tzOffset: "+0000" },
  extraHeaders: [],
  message: "Sign this commit\n",
};

function buildSignedCommitText(hashAlgoCode: number, hashName: string, privateKey: KeyObject): string {
  const payload = Buffer.from(printCanonical(UNSIGNED_COMMIT), "utf8");
  const signatureArmor = buildSignatureArmor(payload, hashAlgoCode, hashName, privateKey);
  const headerLines = [
    `tree ${UNSIGNED_COMMIT.tree}`,
    `parent ${UNSIGNED_COMMIT.parents[0]}`,
    `author Jane Doe <jane@example.com> 1704067200 +0000`,
    `committer Jane Doe <jane@example.com> 1704067200 +0000`,
    foldHeader("gpgsig", signatureArmor),
  ];
  return headerLines.join("\n") + "\n\n" + UNSIGNED_COMMIT.message;
}

function generateKeyAndBlock() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  const publicKeyBlock = dearmor(
    buildPublicKeyArmor(Buffer.from(jwk.n, "base64url"), Buffer.from(jwk.e, "base64url"))
  );
  return { privateKey, publicKeyBlock };
}

test("verifyCommitSignature accepts a real RSA/SHA-256 signature", () => {
  const { privateKey, publicKeyBlock } = generateKeyAndBlock();
  const commit = parseCommit(buildSignedCommitText(8, "sha256", privateKey));
  const result = verifyCommitSignature(commit, publicKeyBlock);
  assert.deepEqual(result, { valid: true });
});

test("verifyCommitSignature accepts RSA/SHA-512 too", () => {
  const { privateKey, publicKeyBlock } = generateKeyAndBlock();
  const commit = parseCommit(buildSignedCommitText(10, "sha512", privateKey));
  const result = verifyCommitSignature(commit, publicKeyBlock);
  assert.deepEqual(result, { valid: true });
});

test("verifyCommitSignature rejects a commit whose message changed after signing", () => {
  const { privateKey, publicKeyBlock } = generateKeyAndBlock();
  const commit = parseCommit(buildSignedCommitText(8, "sha256", privateKey));
  const tampered: ParsedCommit = { ...commit, message: "Sign this commit, or don't\n" };
  const result = verifyCommitSignature(tampered, publicKeyBlock);
  assert.equal(result.valid, false);
});

test("verifyCommitSignature rejects a signature checked against the wrong key", () => {
  const { privateKey } = generateKeyAndBlock();
  const { publicKeyBlock: wrongKeyBlock } = generateKeyAndBlock();
  const commit = parseCommit(buildSignedCommitText(8, "sha256", privateKey));
  const result = verifyCommitSignature(commit, wrongKeyBlock);
  assert.equal(result.valid, false);
});

test("verifyCommitSignature throws when the commit has no gpgsig header", () => {
  const { publicKeyBlock } = generateKeyAndBlock();
  const commit = parseCommit(REGULAR_COMMIT);
  assert.throws(() => verifyCommitSignature(commit, publicKeyBlock), /no gpgsig signature/);
});

test("importRsaPublicKey rejects an armor block with no public key packet", () => {
  const block = dearmor(armor("PUBLIC KEY BLOCK", wrapPacket(13, Buffer.alloc(0))));
  assert.throws(() => importRsaPublicKey(block), /no public key packet found/);
});

test("parseRsaPublicKeyPacket rejects a non-v4 packet", () => {
  assert.throws(() => parseRsaPublicKeyPacket(Buffer.from([3, 0, 0, 0, 0, 1])), /unsupported public key packet version/);
});

test("parseRsaPublicKeyPacket rejects a non-RSA algorithm", () => {
  const body = Buffer.concat([Buffer.from([4, 0, 0, 0, 0, 19]), Buffer.alloc(4)]);
  assert.throws(() => parseRsaPublicKeyPacket(body), /only RSA is supported/);
});

test("parseRsaSignaturePacket rejects a non-v4 packet", () => {
  assert.throws(() => parseRsaSignaturePacket(Buffer.from([3, 0, 1, 8])), /unsupported signature packet version/);
});

test("parseRsaSignaturePacket rejects an unsupported hash algorithm", () => {
  const body = Buffer.concat([Buffer.from([4, 0x00, 1, 99]), uint16be(0), uint16be(0), Buffer.alloc(2)]);
  assert.throws(() => parseRsaSignaturePacket(body), /unsupported hash algorithm/);
});

test("parseRsaSignaturePacket rejects a truncated packet", () => {
  assert.throws(() => parseRsaSignaturePacket(Buffer.from([4, 0x00, 1, 8, 0])), /truncated signature packet/);
});

test("thrown errors are instances of OpenPgpError", () => {
  assert.throws(() => parseRsaPublicKeyPacket(Buffer.from([9])), OpenPgpError);
});
