import { test } from "node:test";
import assert from "node:assert/strict";
import { armor, dearmor, ArmorError } from "./armor.js";

// CRC24("") == 0xb704ce (the init value, since the CRC loop never runs over
// zero bytes), which base64-encodes to "twTO". Fixed point independent of
// the rest of the implementation, so it doubles as a check on encodeChecksum.
const EMPTY_BODY_BLOCK =
  "-----BEGIN PGP SIGNATURE-----\n" +
  "\n" +
  "=twTO\n" +
  "-----END PGP SIGNATURE-----";

test("dearmor parses a minimal block with an empty body", () => {
  const block = dearmor(EMPTY_BODY_BLOCK);
  assert.equal(block.type, "SIGNATURE");
  assert.deepEqual(block.headers, []);
  assert.equal(block.body.length, 0);
});

test("dearmor rejects a checksum that doesn't match the body", () => {
  const bad = EMPTY_BODY_BLOCK.replace("=twTO", "=AAAA");
  assert.throws(() => dearmor(bad), /armor checksum mismatch/);
});

test("dearmor extracts armor headers", () => {
  const text =
    "-----BEGIN PGP SIGNATURE-----\n" +
    "Version: test 1.0\n" +
    "\n" +
    "=twTO\n" +
    "-----END PGP SIGNATURE-----";
  const block = dearmor(text);
  assert.deepEqual(block.headers, [["Version", "test 1.0"]]);
});

test("dearmor rejects a BEGIN/END type mismatch", () => {
  const text =
    "-----BEGIN PGP SIGNATURE-----\n" +
    "\n" +
    "=twTO\n" +
    "-----END PGP PUBLIC KEY BLOCK-----";
  assert.throws(() => dearmor(text), /does not match header type/);
});

test("dearmor rejects a missing BEGIN line", () => {
  assert.throws(() => dearmor("not an armor block"), /missing armor header line/);
});

test("dearmor rejects an armor header line missing a colon", () => {
  const text = "-----BEGIN PGP SIGNATURE-----\nbogus\n\n=twTO\n-----END PGP SIGNATURE-----";
  assert.throws(() => dearmor(text), /malformed armor header line/);
});

test("dearmor rejects a block with no blank line before the body", () => {
  const text = "-----BEGIN PGP SIGNATURE-----\nVersion: test 1.0\n-----END PGP SIGNATURE-----";
  assert.throws(() => dearmor(text), /missing blank line/);
});

test("dearmor rejects a body line with non-base64 characters", () => {
  const text = "-----BEGIN PGP SIGNATURE-----\n\nnot valid base64!\n-----END PGP SIGNATURE-----";
  assert.throws(() => dearmor(text), /malformed armor body line/);
});

test("dearmor rejects trailing data after the checksum line", () => {
  const text =
    "-----BEGIN PGP SIGNATURE-----\n" + "\n" + "=twTO\n" + "extra\n" + "-----END PGP SIGNATURE-----";
  assert.throws(() => dearmor(text), /data found after the armor checksum line/);
});

test("thrown errors are instances of ArmorError", () => {
  assert.throws(() => dearmor("nope"), ArmorError);
});

test("armor and dearmor round-trip an arbitrary body", () => {
  const body = Buffer.from("this is a fake signature payload, long enough to wrap across lines\n", "utf8");
  const text = armor("SIGNATURE", body, [["Version", "test 1.0"]]);
  const block = dearmor(text);
  assert.equal(block.type, "SIGNATURE");
  assert.deepEqual(block.headers, [["Version", "test 1.0"]]);
  assert.ok(block.body.equals(body));
});

test("armor and dearmor round-trip an empty body", () => {
  const text = armor("SIGNATURE", Buffer.alloc(0));
  const block = dearmor(text);
  assert.equal(block.body.length, 0);
});
