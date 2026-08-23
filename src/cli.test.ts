import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli, CliIO } from "./cli.js";
import { REGULAR_COMMIT, MERGE_COMMIT } from "./test-fixtures.js";

function fakeIO(files: Record<string, string>): CliIO & { out: string; err: string } {
  const io = {
    out: "",
    err: "",
    readFile(path: string): string {
      if (!(path in files)) throw new Error(`no such fake file: ${path}`);
      return files[path];
    },
    writeOut(text: string): void {
      io.out += text;
    },
    writeErr(text: string): void {
      io.err += text;
    },
  };
  return io;
}

test("prints canonical form by default", () => {
  const io = fakeIO({ "commit.txt": REGULAR_COMMIT });
  const exitCode = runCli(["node", "cli.js", "commit.txt"], io);
  assert.equal(exitCode, 0);
  assert.equal(io.out, REGULAR_COMMIT);
  assert.equal(io.err, "");
});

test("prints human-readable form with --human", () => {
  const io = fakeIO({ "commit.txt": MERGE_COMMIT });
  const exitCode = runCli(["node", "cli.js", "commit.txt", "--human"], io);
  assert.equal(exitCode, 0);
  assert.ok(io.out.startsWith("tree      "));
  assert.ok(io.out.includes("Merge branch 'feature/parser' into main"));
});

test("accepts flags before or after the file path", () => {
  const io = fakeIO({ "commit.txt": REGULAR_COMMIT });
  const exitCode = runCli(["node", "cli.js", "--human", "commit.txt"], io);
  assert.equal(exitCode, 0);
  assert.ok(io.out.startsWith("tree      "));
});

test("prints usage and exits nonzero when no file path is given", () => {
  const io = fakeIO({});
  const exitCode = runCli(["node", "cli.js"], io);
  assert.equal(exitCode, 1);
  assert.equal(io.out, "");
  assert.match(io.err, /^usage: commit-object-parser/);
});

test("prints usage when only flags are given", () => {
  const io = fakeIO({});
  const exitCode = runCli(["node", "cli.js", "--human"], io);
  assert.equal(exitCode, 1);
  assert.match(io.err, /^usage: commit-object-parser/);
});

test("reports a parse error with its reason and exits nonzero", () => {
  const io = fakeIO({ "bad.txt": "tree not-a-sha\n\nmsg\n" });
  const exitCode = runCli(["node", "cli.js", "bad.txt"], io);
  assert.equal(exitCode, 1);
  assert.equal(io.out, "");
  assert.equal(io.err, "invalid commit object: tree is not a valid object id: \"not-a-sha\"\n");
});
