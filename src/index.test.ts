import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "./index.js";
import { REGULAR_COMMIT } from "./test-fixtures.js";

// Exercises the barrel file itself, not the logic behind it (that's covered
// per-module elsewhere): every name a consumer of the published package
// would reach for has to actually come through here.
test("index re-exports the public API and it round-trips a commit", () => {
  const commit = api.parseCommit(REGULAR_COMMIT);
  assert.equal(api.printCanonical(commit), REGULAR_COMMIT.replace(/\n$/, ""));
  assert.ok(api.printHuman(commit).startsWith("tree      "));
  assert.equal(api.formatDiff(REGULAR_COMMIT, api.printCanonical(commit)), "no differences: input already matches canonical form");
});

test("index exposes the error classes and armor/signature helpers", () => {
  assert.equal(typeof api.CommitParseError, "function");
  assert.equal(typeof api.CommitEncodingError, "function");
  assert.equal(typeof api.ArmorError, "function");
  assert.equal(typeof api.OpenPgpError, "function");
  assert.equal(typeof api.dearmor, "function");
  assert.equal(typeof api.armor, "function");
  assert.equal(typeof api.decodeCommitObject, "function");
  assert.equal(typeof api.verifyCommitSignature, "function");
  assert.equal(typeof api.importRsaPublicKey, "function");
  assert.equal(typeof api.diffLines, "function");
});
