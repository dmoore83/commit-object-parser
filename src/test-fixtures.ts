// Commit object text shaped like real `git cat-file -p <sha>` output, used
// by both the parser and printer test suites. Kept in one place so the two
// suites exercise the same objects instead of drifting apart.

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
export const SIGNED_COMMIT =
  "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
  "parent 1a2b3c4d5e6f70819203a4b5c6d7e8f901234567\n" +
  "author Jane Doe <jane@example.com> 1704067200 +0000\n" +
  "committer Jane Doe <jane@example.com> 1704067200 +0000\n" +
  "gpgsig -----BEGIN PGP SIGNATURE-----\n" +
  " \n" +
  " iQEzBAABCAAdFiEEab12cd34ef56ab12cd34ef56ab12cd34ef56FAmVkAAoJEAB\n" +
  " CDEFabcdefABCDEFabcdefABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD\n" +
  " =Ab3d\n" +
  " -----END PGP SIGNATURE-----\n" +
  "\n" +
  "Sign this commit\n";

export const UNICODE_AUTHOR_COMMIT =
  "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
  "author Jörg Müller <jorg@example.de> 1704067200 +0100\n" +
  "committer 田中 太郎 <tanaka@example.jp> 1704067200 +0900\n" +
  "\n" +
  "Update translations\n";
