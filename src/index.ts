// Public entry point. Everything a consumer of the published package needs
// is re-exported here, so `import { parseCommit } from "commit-object-parser"`
// works without reaching into individual dist files. The CLI and the
// lower-level OpenPGP packet parsing helpers are intentionally left out -
// those are implementation details, not the stable surface.

export { parseCommit, CommitParseError } from "./parser.js";
export type { ParsedCommit, PersonStamp, CommitHeader } from "./parser.js";

export { printCanonical, printHuman } from "./printer.js";

export { decodeCommitObject, CommitEncodingError } from "./encoding.js";

export { dearmor, armor, ArmorError } from "./armor.js";
export type { ArmoredBlock } from "./armor.js";

export { diffLines, formatDiff } from "./diff.js";
export type { DiffOp } from "./diff.js";

export { verifyCommitSignature, importRsaPublicKey, OpenPgpError } from "./openpgp.js";
export type { SignatureVerification } from "./openpgp.js";
