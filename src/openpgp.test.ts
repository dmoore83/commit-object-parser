import { test } from "node:test";
import assert from "node:assert/strict";
import { armor, dearmor } from "./armor.js";
import { parseCommit, ParsedCommit } from "./parser.js";
import {
  importRsaPublicKey,
  verifyCommitSignature,
  parseRsaPublicKeyPacket,
  parseRsaSignaturePacket,
  OpenPgpError,
} from "./openpgp.js";
import {
  REGULAR_COMMIT,
  buildSignedCommitText,
  generateRsaKeyPair,
  publicKeyArmorText,
  uint16be,
  wrapPacket,
} from "./test-fixtures.js";

function generateKeyAndBlock() {
  const { publicKey, privateKey } = generateRsaKeyPair();
  const publicKeyBlock = dearmor(publicKeyArmorText(publicKey));
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
