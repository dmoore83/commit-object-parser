// Parses the raw text of a git commit object, i.e. exactly what
// `git cat-file -p <sha>` prints for a commit. That format is:
//
//   tree <sha>
//   parent <sha>        (zero or more, in order)
//   author <name> <email> <timestamp> <tz>
//   committer <name> <email> <timestamp> <tz>
//   <other headers, e.g. gpgsig, mergetag, encoding>
//   <blank line>
//   <message>
//
// Header values can span multiple lines: continuation lines start with a
// single space, which is how gpgsig blocks survive inside a single header.

import { ArmoredBlock, dearmor } from "./armor.js";

export interface PersonStamp {
  name: string;
  email: string;
  timestamp: number;
  tzOffset: string;
}

export interface CommitHeader {
  key: string;
  value: string;
}

export interface ParsedCommit {
  tree: string;
  parents: string[];
  author: PersonStamp;
  committer: PersonStamp;
  extraHeaders: CommitHeader[];
  message: string;
  // Present when a `gpgsig` header was found and its value is a
  // well-formed OpenPGP armor envelope. The raw header text is still kept
  // in extraHeaders untouched, for round-tripping; this is the dearmored
  // form of the same bytes, for anything that wants to inspect the
  // signature packet itself.
  signature?: ArmoredBlock;
}

export class CommitParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommitParseError";
  }
}

// git accepts both sha1 (40 hex chars) and sha256 (64 hex chars) object ids.
const SHA_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
const PERSON_RE = /^(.*) <([^>]*)> (\d+) ([+-]\d{4})$/;

function splitHeaderAndMessage(raw: string): { headerLines: string[]; message: string } {
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length && lines[i] !== "") i++;
  if (i === lines.length) {
    throw new CommitParseError("missing blank line separating headers from message");
  }
  return { headerLines: lines.slice(0, i), message: lines.slice(i + 1).join("\n") };
}

function joinHeaders(headerLines: string[]): CommitHeader[] {
  const headers: CommitHeader[] = [];
  for (const line of headerLines) {
    if (line.startsWith(" ")) {
      const last = headers[headers.length - 1];
      if (!last) {
        throw new CommitParseError(`continuation line with no preceding header: ${JSON.stringify(line)}`);
      }
      last.value += "\n" + line.slice(1);
      continue;
    }
    const spaceIndex = line.indexOf(" ");
    if (spaceIndex === -1) {
      throw new CommitParseError(`malformed header line: ${JSON.stringify(line)}`);
    }
    headers.push({ key: line.slice(0, spaceIndex), value: line.slice(spaceIndex + 1) });
  }
  return headers;
}

function parsePerson(field: string, value: string): PersonStamp {
  const match = PERSON_RE.exec(value);
  if (!match) {
    throw new CommitParseError(`malformed ${field} line: ${JSON.stringify(value)}`);
  }
  const [, name, email, timestamp, tzOffset] = match;
  return { name, email, timestamp: Number(timestamp), tzOffset };
}

function requireSha(field: string, value: string): string {
  if (!SHA_RE.test(value)) {
    throw new CommitParseError(`${field} is not a valid object id: ${JSON.stringify(value)}`);
  }
  return value;
}

export function parseCommit(raw: string): ParsedCommit {
  const { headerLines, message } = splitHeaderAndMessage(raw);
  const headers = joinHeaders(headerLines);

  let tree: string | undefined;
  let author: PersonStamp | undefined;
  let committer: PersonStamp | undefined;
  let signature: ArmoredBlock | undefined;
  const parents: string[] = [];
  const extraHeaders: CommitHeader[] = [];

  for (const header of headers) {
    switch (header.key) {
      case "tree":
        if (tree !== undefined) throw new CommitParseError("duplicate tree header");
        tree = requireSha("tree", header.value);
        break;
      case "parent":
        parents.push(requireSha("parent", header.value));
        break;
      case "author":
        if (author !== undefined) throw new CommitParseError("duplicate author header");
        author = parsePerson("author", header.value);
        break;
      case "committer":
        if (committer !== undefined) throw new CommitParseError("duplicate committer header");
        committer = parsePerson("committer", header.value);
        break;
      case "gpgsig":
        if (signature !== undefined) throw new CommitParseError("duplicate gpgsig header");
        try {
          signature = dearmor(header.value);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          throw new CommitParseError(`malformed gpgsig header: ${reason}`);
        }
        extraHeaders.push(header);
        break;
      default:
        extraHeaders.push(header);
    }
  }

  if (tree === undefined) throw new CommitParseError("missing tree header");
  if (author === undefined) throw new CommitParseError("missing author header");
  if (committer === undefined) throw new CommitParseError("missing committer header");

  return { tree, parents, author, committer, extraHeaders, message, signature };
}
