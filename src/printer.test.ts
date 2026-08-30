import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommit } from "./parser.js";
import { printCanonical, printHuman } from "./printer.js";
import {
  REGULAR_COMMIT,
  ROOT_COMMIT,
  MERGE_COMMIT,
  SIGNED_COMMIT,
  UNICODE_AUTHOR_COMMIT,
} from "./test-fixtures.js";

function assertRoundTrips(raw: string): void {
  const commit = parseCommit(raw);
  assert.equal(printCanonical(commit), raw.replace(/\n$/, ""));
}

test("round-trips a regular commit through canonical form", () => {
  assertRoundTrips(REGULAR_COMMIT);
});

test("round-trips a root commit through canonical form", () => {
  assertRoundTrips(ROOT_COMMIT);
});

test("round-trips a merge commit through canonical form", () => {
  assertRoundTrips(MERGE_COMMIT);
});

test("round-trips a signed commit, preserving the gpgsig block byte for byte", () => {
  assertRoundTrips(SIGNED_COMMIT);
});

test("round-trips a commit with non-ASCII author and committer names", () => {
  assertRoundTrips(UNICODE_AUTHOR_COMMIT);
});

test("printHuman renders a +0000 timestamp as-is", () => {
  const human = printHuman(parseCommit(REGULAR_COMMIT));
  assert.ok(human.includes("author    Jane Doe <jane@example.com>  2024-01-01 00:00:00 +0000"));
});

test("printHuman shifts the wall-clock time for a negative offset", () => {
  const human = printHuman(parseCommit(MERGE_COMMIT));
  assert.ok(human.includes("author    Jane Doe <jane@example.com>  2023-12-31 19:00:00 -0500"));
});

test("printHuman shifts the wall-clock time for a positive offset", () => {
  const human = printHuman(parseCommit(UNICODE_AUTHOR_COMMIT));
  assert.ok(human.includes("author    Jörg Müller <jorg@example.de>  2024-01-01 01:00:00 +0100"));
  assert.ok(human.includes("committer 田中 太郎 <tanaka@example.jp>  2024-01-01 09:00:00 +0900"));
});

test("printHuman notes extra headers without rendering their content", () => {
  const human = printHuman(parseCommit(SIGNED_COMMIT));
  assert.ok(human.includes("gpgsig (4 line(s), not rendered)"));
  assert.ok(!human.includes("BEGIN PGP SIGNATURE"));
});

test("printHuman indents every message line", () => {
  const human = printHuman(parseCommit(MERGE_COMMIT));
  assert.ok(human.endsWith("    Merge branch 'feature/parser' into main"));
});
