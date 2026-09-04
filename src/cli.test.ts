import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli, CliIO } from "./cli.js";
import {
  REGULAR_COMMIT,
  MERGE_COMMIT,
  buildSignedCommitText,
  generateRsaKeyPair,
  publicKeyArmorText,
} from "./test-fixtures.js";

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

test("rejects an unrecognized flag", () => {
  const io = fakeIO({ "commit.txt": REGULAR_COMMIT });
  const exitCode = runCli(["node", "cli.js", "commit.txt", "--bogus"], io);
  assert.equal(exitCode, 1);
  assert.equal(io.err, "unrecognized flag: --bogus\n");
});

test("rejects a --verify with no key path argument", () => {
  const io = fakeIO({ "commit.txt": REGULAR_COMMIT });
  const exitCode = runCli(["node", "cli.js", "commit.txt", "--verify"], io);
  assert.equal(exitCode, 1);
  assert.equal(io.err, "--verify requires a public key file argument\n");
});

test("--verify prints the parsed commit and confirms a valid signature", () => {
  const { publicKey, privateKey } = generateRsaKeyPair();
  const io = fakeIO({
    "commit.txt": buildSignedCommitText(8, "sha256", privateKey),
    "key.asc": publicKeyArmorText(publicKey),
  });
  const exitCode = runCli(["node", "cli.js", "commit.txt", "--verify", "key.asc"], io);
  assert.equal(exitCode, 0);
  assert.ok(io.out.includes("Sign this commit"));
  assert.ok(io.out.endsWith("signature: valid\n"));
});

test("--verify exits nonzero and reports the reason for an invalid signature", () => {
  const { privateKey } = generateRsaKeyPair();
  const { publicKey: wrongKey } = generateRsaKeyPair();
  const io = fakeIO({
    "commit.txt": buildSignedCommitText(8, "sha256", privateKey),
    "wrong-key.asc": publicKeyArmorText(wrongKey),
  });
  const exitCode = runCli(["node", "cli.js", "commit.txt", "--verify", "wrong-key.asc"], io);
  assert.equal(exitCode, 1);
  assert.match(io.out, /^signature: invalid \(/m);
});

test("--verify reports an error when the commit has no signature", () => {
  const { publicKey } = generateRsaKeyPair();
  const io = fakeIO({
    "commit.txt": REGULAR_COMMIT,
    "key.asc": publicKeyArmorText(publicKey),
  });
  const exitCode = runCli(["node", "cli.js", "commit.txt", "--verify", "key.asc"], io);
  assert.equal(exitCode, 1);
  assert.match(io.err, /^signature verification failed: .*no gpgsig signature/);
});
