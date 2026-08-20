#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseCommit } from "./parser.js";
import { printCanonical, printHuman } from "./printer.js";

function main(argv: string[]): void {
  const args = argv.slice(2);
  const humanFlag = args.includes("--human");
  const filePath = args.find((a) => !a.startsWith("--"));

  if (!filePath) {
    process.stderr.write("usage: commit-object-parser <commit-object-file> [--human]\n");
    process.exitCode = 1;
    return;
  }

  const raw = readFileSync(filePath, "utf8");
  try {
    const commit = parseCommit(raw);
    process.stdout.write((humanFlag ? printHuman(commit) : printCanonical(commit)) + "\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`invalid commit object: ${message}\n`);
    process.exitCode = 1;
  }
}

main(process.argv);
