#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseCommit } from "./parser.js";
import { printCanonical, printHuman } from "./printer.js";

export interface CliIO {
  readFile: (path: string) => string;
  writeOut: (text: string) => void;
  writeErr: (text: string) => void;
}

// Pulled out of main() so the CLI's argument handling and error formatting
// can be exercised in tests without touching the real filesystem or stdio.
export function runCli(argv: string[], io: CliIO): number {
  const args = argv.slice(2);
  const humanFlag = args.includes("--human");
  const filePath = args.find((a) => !a.startsWith("--"));

  if (!filePath) {
    io.writeErr("usage: commit-object-parser <commit-object-file> [--human]\n");
    return 1;
  }

  const raw = io.readFile(filePath);
  try {
    const commit = parseCommit(raw);
    io.writeOut((humanFlag ? printHuman(commit) : printCanonical(commit)) + "\n");
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.writeErr(`invalid commit object: ${message}\n`);
    return 1;
  }
}

function main(argv: string[]): void {
  process.exitCode = runCli(argv, {
    readFile: (path) => readFileSync(path, "utf8"),
    writeOut: (text) => process.stdout.write(text),
    writeErr: (text) => process.stderr.write(text),
  });
}

// Only run when invoked directly (node cli.js ...), not when imported by tests.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main(process.argv);
}
