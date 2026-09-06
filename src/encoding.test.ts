import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeCommitObject, CommitEncodingError } from "./encoding.js";
import { REGULAR_COMMIT } from "./test-fixtures.js";

test("decodes a plain UTF-8 commit with no encoding header unchanged", () => {
  const decoded = decodeCommitObject(Buffer.from(REGULAR_COMMIT, "utf8"));
  assert.equal(decoded, REGULAR_COMMIT);
});

test("defaults to UTF-8 for multi-byte characters when no encoding header is present", () => {
  const raw =
    "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
    "author 田中 太郎 <tanaka@example.jp> 1704067200 +0900\n" +
    "committer 田中 太郎 <tanaka@example.jp> 1704067200 +0900\n" +
    "\n" +
    "Update translations\n";
  const decoded = decodeCommitObject(Buffer.from(raw, "utf8"));
  assert.equal(decoded, raw);
});

test("honors a declared ISO-8859-1 encoding header", () => {
  const raw =
    "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
    "author J\xf6rg M\xfcller <jorg@example.de> 1704067200 +0100\n" +
    "committer J\xf6rg M\xfcller <jorg@example.de> 1704067200 +0100\n" +
    "encoding ISO-8859-1\n" +
    "\n" +
    "Update translations\n";
  const bytes = Buffer.from(raw, "latin1");
  const decoded = decodeCommitObject(bytes);
  assert.ok(decoded.includes("Jörg Müller"));
  assert.ok(decoded.includes("encoding ISO-8859-1"));
});

test("only honors an encoding header found before the blank line", () => {
  // "encoding" appearing in the message body, after the real header block
  // has already ended, must not be mistaken for a declared header.
  const raw =
    "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
    "author Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "committer Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "\n" +
    "encoding notes: switched the build to use a new bundler\n";
  const decoded = decodeCommitObject(Buffer.from(raw, "utf8"));
  assert.equal(decoded, raw);
});

test("rejects an encoding header naming an unsupported charset", () => {
  const raw = "tree x\nencoding not-a-real-charset\n\nmsg\n";
  assert.throws(() => decodeCommitObject(Buffer.from(raw, "utf8")), CommitEncodingError);
});

test("rejects bytes that are not valid under the declared encoding", () => {
  // 0xC0 0x00 is not a well-formed UTF-8 sequence (0xC0 must never appear).
  const bytes = Buffer.from("tree x\nencoding UTF-8\n\n\xc0\x00\n", "latin1");
  assert.throws(() => decodeCommitObject(bytes), CommitEncodingError);
});
