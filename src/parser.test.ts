import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommit, CommitParseError } from "./parser.js";
import {
  REGULAR_COMMIT,
  ROOT_COMMIT,
  MERGE_COMMIT,
  SIGNED_COMMIT,
  UNICODE_AUTHOR_COMMIT,
} from "./test-fixtures.js";

test("parses a regular single-parent commit", () => {
  const commit = parseCommit(REGULAR_COMMIT);
  assert.equal(commit.tree, "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
  assert.deepEqual(commit.parents, ["1a2b3c4d5e6f70819203a4b5c6d7e8f901234567"]);
  assert.equal(commit.author.name, "Jane Doe");
  assert.equal(commit.author.email, "jane@example.com");
  assert.equal(commit.author.timestamp, 1704067200);
  assert.equal(commit.author.tzOffset, "+0000");
  assert.deepEqual(commit.extraHeaders, []);
  assert.equal(commit.message, "Fix off-by-one in changelog generator\n");
});

test("parses a root commit with no parents", () => {
  const commit = parseCommit(ROOT_COMMIT);
  assert.deepEqual(commit.parents, []);
});

test("parses a merge commit with parents kept in order", () => {
  const commit = parseCommit(MERGE_COMMIT);
  assert.deepEqual(commit.parents, [
    "1a2b3c4d5e6f70819203a4b5c6d7e8f901234567",
    "9f8e7d6c5b4a392817061524334455667788990a",
  ]);
  assert.equal(commit.author.tzOffset, "-0500");
});

test("accepts a sha256 object id", () => {
  const sha256 = "a".repeat(64);
  const raw =
    `tree ${sha256}\n` +
    "author Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "committer Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "\nmsg\n";
  const commit = parseCommit(raw);
  assert.equal(commit.tree, sha256);
});

test("preserves a multi-line gpgsig header without interpreting it", () => {
  const commit = parseCommit(SIGNED_COMMIT);
  assert.equal(commit.extraHeaders.length, 1);
  const [gpgsig] = commit.extraHeaders;
  assert.equal(gpgsig.key, "gpgsig");
  assert.ok(gpgsig.value.startsWith("-----BEGIN PGP SIGNATURE-----\n"));
  assert.ok(gpgsig.value.endsWith("-----END PGP SIGNATURE-----"));
  assert.equal(gpgsig.value.split("\n").length, 4);
});

test("dearmors a gpgsig header into commit.signature", () => {
  const commit = parseCommit(SIGNED_COMMIT);
  assert.ok(commit.signature);
  assert.equal(commit.signature.type, "SIGNATURE");
  assert.equal(commit.signature.body.length, 0);
});

test("leaves commit.signature undefined when there is no gpgsig header", () => {
  const commit = parseCommit(REGULAR_COMMIT);
  assert.equal(commit.signature, undefined);
});

test("rejects a gpgsig header whose armor checksum doesn't match", () => {
  const raw = SIGNED_COMMIT.replace(" =twTO\n", " =AAAA\n");
  assert.throws(() => parseCommit(raw), /malformed gpgsig header: armor checksum mismatch/);
});

test("rejects a gpgsig header that isn't a valid armor block", () => {
  const raw =
    "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
    "author Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "committer Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "gpgsig not an armor block\n" +
    "\nmsg\n";
  assert.throws(() => parseCommit(raw), /malformed gpgsig header: missing armor header line/);
});

test("parses non-ASCII author and committer names", () => {
  const commit = parseCommit(UNICODE_AUTHOR_COMMIT);
  assert.equal(commit.author.name, "Jörg Müller");
  assert.equal(commit.committer.name, "田中 太郎");
  assert.equal(commit.committer.email, "tanaka@example.jp");
});

test("rejects a commit missing the tree header", () => {
  const raw =
    "author Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "committer Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "\nmsg\n";
  assert.throws(() => parseCommit(raw), /missing tree header/);
});

test("rejects a duplicate tree header", () => {
  const raw =
    "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
    "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
    "author Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "committer Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "\nmsg\n";
  assert.throws(() => parseCommit(raw), /duplicate tree header/);
});

test("rejects a malformed object id", () => {
  const raw =
    "tree not-a-sha\n" +
    "author Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "committer Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "\nmsg\n";
  assert.throws(() => parseCommit(raw), /not a valid object id/);
});

test("rejects a malformed author line", () => {
  const raw =
    "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
    "author Jane Doe jane@example.com 1704067200 +0000\n" +
    "committer Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "\nmsg\n";
  assert.throws(() => parseCommit(raw), /malformed author line/);
});

test("rejects a header line with no key/value separator", () => {
  const raw =
    "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
    "bogus\n" +
    "author Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "committer Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "\nmsg\n";
  assert.throws(() => parseCommit(raw), /malformed header line/);
});

test("rejects a commit with no blank line before the message", () => {
  const raw =
    "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
    "author Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "committer Jane Doe <jane@example.com> 1704067200 +0000";
  assert.throws(() => parseCommit(raw), /missing blank line/);
});

test("rejects a continuation line with no preceding header", () => {
  const raw =
    " leading continuation\n" +
    "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
    "author Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "committer Jane Doe <jane@example.com> 1704067200 +0000\n" +
    "\nmsg\n";
  assert.throws(() => parseCommit(raw), /continuation line with no preceding header/);
});

test("thrown errors are instances of CommitParseError", () => {
  assert.throws(() => parseCommit("tree not-a-sha\n\nmsg\n"), CommitParseError);
});
