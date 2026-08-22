# commit-object-parser

git stores every commit as a small text object: a `tree` line, zero or more
`parent` lines, an `author` line, a `committer` line, maybe a signature or
other extension header, a blank line, then the message. Anything that
generates commits directly instead of going through `git commit` — history
rewriting tools, monorepo import scripts, signing wrappers — has to produce
that text exactly right, because git will happily hash and store a
malformed object and you won't find out until something downstream (a
signature check, `git log`, a mirror push) chokes on it.

This is a small validating parser for that format, plus two ways to print
a parsed commit back out: canonical form (byte-for-byte what git would
store, for round-trip checks) and a human-readable form.

## Usage

Grab the raw object text for a commit with git itself:

```sh
git cat-file -p HEAD > commit.txt
```

`commit.txt` now looks like:

```
tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904
parent 2c9f0b1a5e4d3c7f8a9b0d1e2f3a4b5c6d7e8f90
author Jane Doe <jane@example.com> 1755763200 -0400
committer Jane Doe <jane@example.com> 1755763200 -0400

Fix off-by-one in changelog generator
```

Parse it as a library:

```ts
import { readFileSync } from "node:fs";
import { parseCommit } from "./src/parser.js";
import { printCanonical, printHuman } from "./src/printer.js";

const raw = readFileSync("commit.txt", "utf8");
const commit = parseCommit(raw);

console.log(commit.author.email);       // "jane@example.com"
console.log(commit.parents.length);     // 1

console.log(printCanonical(commit) === raw.replace(/\n$/, "")); // round-trips
console.log(printHuman(commit));
```

Or from the command line, after building:

```sh
npm run build
node dist/cli.js commit.txt            # canonical form
node dist/cli.js commit.txt --human    # human-readable form
```

A malformed object is rejected with a specific reason instead of being
silently accepted:

```
$ echo "tree not-a-sha" | node dist/cli.js /dev/stdin
invalid commit object: missing blank line separating headers from message
```

## Testing

Tests use Node's built-in test runner, so there's nothing extra to install:

```sh
npm test
```

The suite parses and round-trips real commit shapes: a regular commit, a
root commit, a merge commit, a gpgsig-signed commit, and a commit with
non-ASCII author/committer names, alongside the malformed-input cases that
should be rejected.

## What's validated

- `tree` is present exactly once and is a well-formed sha1 or sha256 id
- `parent` lines (if any) are well-formed object ids
- `author` and `committer` are present exactly once, each matching
  `name <email> timestamp tz-offset`
- header continuation lines (used by e.g. `gpgsig`) are attached to the
  header they continue, not dropped or misparsed as new headers

## Status

Early skeleton: the core headers (`tree`, `parent`, `author`, `committer`)
are fully validated, and unrecognized headers like `gpgsig` or `mergetag`
are preserved (including multi-line continuation) without being
interpreted. See the roadmap for what's next.
