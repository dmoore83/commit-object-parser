#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dearmor } from "./armor.js";
import { decodeCommitObject } from "./encoding.js";
import { verifyCommitSignature } from "./openpgp.js";
import { parseCommit, ParsedCommit } from "./parser.js";
import { printCanonical, printHuman } from "./printer.js";

const USAGE = "usage: commit-object-parser <commit-object-file> [--human] [--verify <public-key-file>]\n";

export interface CliIO {
  readFile: (path: string) => string;
  readFileBytes: (path: string) => Uint8Array;
  writeOut: (text: string) => void;
  writeErr: (text: string) => void;
}

// Pulled out of main() so the CLI's argument handling and error formatting
// can be exercised in tests without touching the real filesystem or stdio.
export function runCli(argv: string[], io: CliIO): number {
  const args = argv.slice(2);
  let humanFlag = false;
  let verifyKeyPath: string | undefined;
  let filePath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--human") {
      humanFlag = true;
    } else if (arg === "--verify") {
      i++;
      if (args[i] === undefined) {
        io.writeErr("--verify requires a public key file argument\n");
        return 1;
      }
      verifyKeyPath = args[i];
    } else if (arg.startsWith("--")) {
      io.writeErr(`unrecognized flag: ${arg}\n`);
      return 1;
    } else if (filePath === undefined) {
      filePath = arg;
    } else {
      io.writeErr(`unexpected argument: ${arg}\n`);
      return 1;
    }
  }

  if (!filePath) {
    io.writeErr(USAGE);
    return 1;
  }

  let raw: string;
  try {
    raw = decodeCommitObject(io.readFileBytes(filePath));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.writeErr(`invalid commit object: ${message}\n`);
    return 1;
  }

  let commit: ParsedCommit;
  try {
    commit = parseCommit(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.writeErr(`invalid commit object: ${message}\n`);
    return 1;
  }

  io.writeOut((humanFlag ? printHuman(commit) : printCanonical(commit)) + "\n");

  if (verifyKeyPath === undefined) {
    return 0;
  }

  try {
    const publicKeyBlock = dearmor(io.readFile(verifyKeyPath));
    const result = verifyCommitSignature(commit, publicKeyBlock);
    if (!result.valid) {
      io.writeOut(`signature: invalid (${result.reason})\n`);
      return 1;
    }
    io.writeOut("signature: valid\n");
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.writeErr(`signature verification failed: ${message}\n`);
    return 1;
  }
}

function main(argv: string[]): void {
  process.exitCode = runCli(argv, {
    readFile: (path) => readFileSync(path, "utf8"),
    readFileBytes: (path) => readFileSync(path),
    writeOut: (text) => process.stdout.write(text),
    writeErr: (text) => process.stderr.write(text),
  });
}

// Only run when invoked directly (node cli.js ...), not when imported by tests.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main(process.argv);
}
