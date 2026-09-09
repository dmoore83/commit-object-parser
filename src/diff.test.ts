import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLines, formatDiff } from "./diff.js";

test("diffLines marks every line equal when both sides match", () => {
  const ops = diffLines(["a", "b", "c"], ["a", "b", "c"]);
  assert.deepEqual(
    ops.map((op) => op.type),
    ["equal", "equal", "equal"]
  );
});

test("diffLines finds an inserted line", () => {
  const ops = diffLines(["a", "c"], ["a", "b", "c"]);
  assert.deepEqual(ops, [
    { type: "equal", line: "a" },
    { type: "add", line: "b" },
    { type: "equal", line: "c" },
  ]);
});

test("diffLines finds a removed line", () => {
  const ops = diffLines(["a", "b", "c"], ["a", "c"]);
  assert.deepEqual(ops, [
    { type: "equal", line: "a" },
    { type: "remove", line: "b" },
    { type: "equal", line: "c" },
  ]);
});

test("diffLines finds a changed line as a remove plus an add", () => {
  const ops = diffLines(["tree aaa"], ["tree bbb"]);
  assert.deepEqual(ops, [
    { type: "remove", line: "tree aaa" },
    { type: "add", line: "tree bbb" },
  ]);
});

test("diffLines handles a completely empty side", () => {
  assert.deepEqual(diffLines([], ["a", "b"]), [
    { type: "add", line: "a" },
    { type: "add", line: "b" },
  ]);
  assert.deepEqual(diffLines(["a", "b"], []), [
    { type: "remove", line: "a" },
    { type: "remove", line: "b" },
  ]);
});

test("formatDiff reports no differences for identical text", () => {
  assert.equal(formatDiff("tree x\n\nmsg", "tree x\n\nmsg"), "no differences: input already matches canonical form");
});

test("formatDiff renders unchanged, removed and added lines with diff-style markers", () => {
  const result = formatDiff("tree aaa\n\nold message", "tree bbb\n\nold message");
  assert.equal(result, "-tree aaa\n+tree bbb\n \n old message");
});
