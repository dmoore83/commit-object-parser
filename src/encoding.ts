// A commit object is stored as raw bytes, not text. Almost always those
// bytes are UTF-8, but git lets a commit declare otherwise with an
// `encoding` header (e.g. `encoding ISO-8859-1`) naming the charset the
// message and author/committer names were written in. There's no other way
// to know which bytes mean what, so this has to run before parseCommit ever
// sees a string.

export class CommitEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommitEncodingError";
  }
}

const DEFAULT_ENCODING = "utf-8";

// The `encoding` header, like every header name, is plain ASCII, so it can
// be found by decoding the header region as latin1 - a decode that never
// fails and preserves byte values 1:1 - before committing to the real
// decode the header actually asks for.
function findDeclaredEncoding(bytes: Uint8Array): string | undefined {
  const asLatin1 = new TextDecoder("latin1").decode(bytes);
  const blankLineIndex = asLatin1.indexOf("\n\n");
  const headerRegion = blankLineIndex === -1 ? asLatin1 : asLatin1.slice(0, blankLineIndex);
  for (const line of headerRegion.split("\n")) {
    if (line.startsWith("encoding ")) return line.slice("encoding ".length).trim();
  }
  return undefined;
}

// Decodes the raw bytes of a commit object into the string parseCommit
// expects, honoring a declared `encoding` header if there is one and
// falling back to UTF-8 (git's own default) otherwise.
export function decodeCommitObject(bytes: Uint8Array): string {
  const encoding = findDeclaredEncoding(bytes) ?? DEFAULT_ENCODING;
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(encoding, { fatal: true });
  } catch {
    throw new CommitEncodingError(`unsupported "encoding ${encoding}" header`);
  }
  try {
    return decoder.decode(bytes);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CommitEncodingError(`commit bytes are not valid ${encoding}: ${reason}`);
  }
}
