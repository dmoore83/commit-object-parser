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
node dist/cli.js commit.txt                          # canonical form
node dist/cli.js commit.txt --human                  # human-readable form
node dist/cli.js commit.txt --diff                    # canonical vs input, line by line
node dist/cli.js commit.txt --verify signer.pgp.asc   # also check the gpgsig header
```

`--verify` takes the path to an armored RSA public key block (the same
format `gpg --export --armor` produces) and checks it against the commit's
`gpgsig` header, printing `signature: valid` or `signature: invalid (reason)`
and exiting nonzero if it doesn't check out.

`--diff` reparses the input, reprints it in canonical form, and shows the
two side by side, one line per input/canonical line, marked the way `diff -u`
marks lines (` ` unchanged, `-` only in the input, `+` only in canonical
form). Well-formed commits round-trip exactly, so this is normally
`no differences: input already matches canonical form` - a non-empty diff
means the parser accepted something it can't reproduce byte for byte, e.g.
headers in a non-standard order:

```
$ node dist/cli.js weird-order-commit.txt --diff
 tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904
 parent 1a2b3c4d5e6f70819203a4b5c6d7e8f901234567
-committer Jane Doe <jane@example.com> 1704067200 +0000
 author Jane Doe <jane@example.com> 1704067200 +0000
+committer Jane Doe <jane@example.com> 1704067200 +0000
 
 Fix off-by-one in changelog generator
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
- if present, `gpgsig` is a well-formed OpenPGP ASCII-armor envelope
  (`src/armor.ts`): valid BEGIN/END markers, headers, base64 body, and a
  matching CRC24 checksum

## Status

Early skeleton: the core headers (`tree`, `parent`, `author`, `committer`)
are fully validated, and unrecognized headers like `mergetag` are preserved
(including multi-line continuation) without being interpreted. Next up:
publishing this as an npm package once the API stabilizes.

A commit's bytes aren't always UTF-8: git lets a commit declare a different
charset with an `encoding` header (e.g. `encoding ISO-8859-1`), and the
message and author/committer names outside of ASCII are only meaningful
once decoded that way. `src/encoding.ts` reads the raw bytes of a commit
object, checks for that header, and decodes accordingly before the text
ever reaches `parseCommit`:

```ts
import { readFileSync } from "node:fs";
import { decodeCommitObject } from "./src/encoding.js";
import { parseCommit } from "./src/parser.js";

const commit = parseCommit(decodeCommitObject(readFileSync("commit.txt")));
```

The CLI does this automatically now, so `node dist/cli.js commit.txt` works
on a non-UTF-8 commit object without any extra flag.

`parseCommit` dearmors a `gpgsig` header's value and exposes the decoded
envelope as `commit.signature` (type, headers, and raw body bytes) -
rejecting the commit if the envelope itself is malformed. The raw header
text is still kept in `extraHeaders` untouched, so canonical printing keeps
round-tripping byte for byte.

`src/openpgp.ts` reads those bytes as actual OpenPGP packets and checks a
signed commit against an RSA public key:

```ts
import { dearmor } from "./src/armor.js";
import { verifyCommitSignature } from "./src/openpgp.js";

const publicKeyBlock = dearmor(readFileSync("signer.pgp.asc", "utf8"));
const result = verifyCommitSignature(commit, publicKeyBlock);
console.log(result.valid ? "signature ok" : `signature invalid: ${result.reason}`);
```

It supports version-4 RSA signatures (SHA-1/224/256/384/512), the only kind
`git commit -S` with an RSA key produces. The public key is imported into
node:crypto via its raw modulus and exponent, so no ASN.1 DER encoding is
built by hand. DSA/ECDSA keys, and non-RSA signatures, are rejected rather
than silently skipped. Wired into the CLI as `--verify`, above.
