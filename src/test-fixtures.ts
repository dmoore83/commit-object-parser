// Commit object text shaped like real `git cat-file -p <sha>` output, used
// by both the parser and printer test suites. Kept in one place so the two
// suites exercise the same objects instead of drifting apart.

import { createHash, createSign, generateKeyPairSync, KeyObject } from "node:crypto";
import { armor } from "./armor.js";
import { ParsedCommit } from "./parser.js";
import { printCanonical } from "./printer.js";

export const REGULAR_COMMIT =
  "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
  "parent 1a2b3c4d5e6f70819203a4b5c6d7e8f901234567\n" +
  "author Jane Doe <jane@example.com> 1704067200 +0000\n" +
  "committer Jane Doe <jane@example.com> 1704067200 +0000\n" +
  "\n" +
  "Fix off-by-one in changelog generator\n";

export const ROOT_COMMIT =
  "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
  "author Jane Doe <jane@example.com> 1704067200 +0000\n" +
  "committer Jane Doe <jane@example.com> 1704067200 +0000\n" +
  "\n" +
  "Initial commit\n";

export const MERGE_COMMIT =
  "tree 7c9e2b4a1d3f5680a9b8c7d6e5f4a3b2c1d0e9f8\n" +
  "parent 1a2b3c4d5e6f70819203a4b5c6d7e8f901234567\n" +
  "parent 9f8e7d6c5b4a392817061524334455667788990a\n" +
  "author Jane Doe <jane@example.com> 1704067200 -0500\n" +
  "committer Jane Doe <jane@example.com> 1704067200 -0500\n" +
  "\n" +
  "Merge branch 'feature/parser' into main\n";

// gpgsig continuation lines each carry a single leading space, including
// the blank line in the middle of the armored block - that's how git
// distinguishes "still part of this header" from "end of headers".
//
// The armored body here is empty: CRC24("") is the algorithm's own init
// value, 0xb704ce, which base64-encodes to "twTO" - see armor.test.ts for
// the same fixed point. That keeps this fixture's checksum verifiable by
// inspection instead of by trusting a pasted base64 blob.
export const SIGNED_COMMIT =
  "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
  "parent 1a2b3c4d5e6f70819203a4b5c6d7e8f901234567\n" +
  "author Jane Doe <jane@example.com> 1704067200 +0000\n" +
  "committer Jane Doe <jane@example.com> 1704067200 +0000\n" +
  "gpgsig -----BEGIN PGP SIGNATURE-----\n" +
  " \n" +
  " =twTO\n" +
  " -----END PGP SIGNATURE-----\n" +
  "\n" +
  "Sign this commit\n";

export const UNICODE_AUTHOR_COMMIT =
  "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
  "author Jörg Müller <jorg@example.de> 1704067200 +0100\n" +
  "committer 田中 太郎 <tanaka@example.jp> 1704067200 +0900\n" +
  "\n" +
  "Update translations\n";

// Below: builds a real, signed commit from scratch at test time - generating
// an RSA keypair, hashing and signing per RFC 4880 5.2.4, and hand-assembling
// the OpenPGP packets - rather than pasting in fixed key material. That
// exercises the actual signing math instead of a canned example, and
// sidesteps ever needing to check in anything that looks like a real key.

export function uint16be(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(n);
  return buf;
}

function uint32be(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n);
  return buf;
}

// RFC 4880 3.2: MPI = 16-bit bit count + minimal big-endian bytes.
function mpiFromBuffer(buf: Buffer): Buffer {
  let start = 0;
  while (start < buf.length - 1 && buf[start] === 0) start++;
  const trimmed = buf.subarray(start);
  let bitLength = (trimmed.length - 1) * 8;
  let firstByte = trimmed[0];
  while (firstByte > 0) {
    bitLength++;
    firstByte >>= 1;
  }
  return Buffer.concat([uint16be(bitLength), trimmed]);
}

// RFC 4880 4.2.2: new-format packet header. Covers the one- and two-octet
// length forms, which is all a single RSA key or signature packet ever
// needs (even a 4096-bit modulus MPI stays well under the 8383-byte cutoff
// for the two-octet form).
export function wrapPacket(tag: number, body: Buffer): Buffer {
  let header: Buffer;
  if (body.length < 192) {
    header = Buffer.from([0xc0 | tag, body.length]);
  } else if (body.length < 8384) {
    const v = body.length - 192;
    header = Buffer.from([0xc0 | tag, (v >> 8) + 192, v & 0xff]);
  } else {
    throw new Error("test helper only supports packet bodies under 8384 bytes");
  }
  return Buffer.concat([header, body]);
}

function buildPublicKeyArmor(n: Buffer, e: Buffer): string {
  const body = Buffer.concat([Buffer.from([4, 0, 0, 0, 0, 1]), mpiFromBuffer(n), mpiFromBuffer(e)]);
  return armor("PUBLIC KEY BLOCK", wrapPacket(6, body));
}

// RFC 4880 5.2.3/5.2.4: builds a version-4 RSA signature packet over
// `payload`, with no hashed or unhashed subpackets.
function buildSignatureArmor(payload: Buffer, hashAlgoCode: number, hashName: string, privateKey: KeyObject): string {
  const hashedPart = Buffer.concat([Buffer.from([4, 0x00, 1, hashAlgoCode]), uint16be(0)]);
  const trailer = Buffer.concat([Buffer.from([4, 0xff]), uint32be(hashedPart.length)]);
  const preimage = Buffer.concat([payload, hashedPart, trailer]);
  const leftHash16 = createHash(hashName).update(preimage).digest().subarray(0, 2);
  const signature = createSign(hashName).update(preimage).sign(privateKey);
  const body = Buffer.concat([hashedPart, uint16be(0), leftHash16, mpiFromBuffer(signature)]);
  return armor("SIGNATURE", wrapPacket(2, body));
}

function foldHeader(key: string, value: string): string {
  return value
    .split("\n")
    .map((line, i) => (i === 0 ? `${key} ${line}` : ` ${line}`))
    .join("\n");
}

const UNSIGNED_SIGNABLE_COMMIT: ParsedCommit = {
  tree: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  parents: ["1a2b3c4d5e6f70819203a4b5c6d7e8f901234567"],
  author: { name: "Jane Doe", email: "jane@example.com", timestamp: 1704067200, tzOffset: "+0000" },
  committer: { name: "Jane Doe", email: "jane@example.com", timestamp: 1704067200, tzOffset: "+0000" },
  extraHeaders: [],
  message: "Sign this commit\n",
};

// Generates a fresh RSA keypair for signing test fixtures. Never a fixed
// keypair, so nothing that looks like a real key ever gets checked in.
export function generateRsaKeyPair(): { publicKey: KeyObject; privateKey: KeyObject } {
  return generateKeyPairSync("rsa", { modulusLength: 2048 });
}

export function publicKeyArmorText(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  return buildPublicKeyArmor(Buffer.from(jwk.n, "base64url"), Buffer.from(jwk.e, "base64url"));
}

// Builds the raw text of a commit object, signed over its own canonical
// form, exactly as `git commit -S` would produce for the fixed identity and
// message above.
export function buildSignedCommitText(hashAlgoCode: number, hashName: string, privateKey: KeyObject): string {
  const payload = Buffer.from(printCanonical(UNSIGNED_SIGNABLE_COMMIT), "utf8");
  const signatureArmor = buildSignatureArmor(payload, hashAlgoCode, hashName, privateKey);
  const headerLines = [
    `tree ${UNSIGNED_SIGNABLE_COMMIT.tree}`,
    `parent ${UNSIGNED_SIGNABLE_COMMIT.parents[0]}`,
    `author Jane Doe <jane@example.com> 1704067200 +0000`,
    `committer Jane Doe <jane@example.com> 1704067200 +0000`,
    foldHeader("gpgsig", signatureArmor),
  ];
  return headerLines.join("\n") + "\n\n" + UNSIGNED_SIGNABLE_COMMIT.message;
}
