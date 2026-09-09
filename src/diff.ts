// Line-based diff between the raw text handed to the CLI and the canonical
// form the parser+printer produce from it. Almost always these are
// identical - the whole point of the parser is to accept only text it can
// reproduce byte for byte - so a non-empty diff here is evidence of a real
// discrepancy: reordered headers, dropped whitespace, anything the parser
// tolerates on the way in but printCanonical doesn't reconstruct exactly.

export type DiffOp =
  | { type: "equal"; line: string }
  | { type: "remove"; line: string }
  | { type: "add"; line: string };

// Standard LCS dynamic-programming table, walked backward to recover the
// edit script. Commit objects are a handful of headers plus a message, so
// the O(n*m) table costs nothing in practice.
export function diffLines(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", line: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: "remove", line: a[i] });
      i++;
    } else {
      ops.push({ type: "add", line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "remove", line: a[i++] });
  while (j < m) ops.push({ type: "add", line: b[j++] });
  return ops;
}

const MARKERS: Record<DiffOp["type"], string> = { equal: " ", remove: "-", add: "+" };

// Renders the diff the way `diff -u` marks lines (' ' / '-' / '+'), without
// hunk headers - for objects this small, showing the whole thing is more
// useful than truncating context around changes.
export function formatDiff(input: string, canonical: string): string {
  const ops = diffLines(input.split("\n"), canonical.split("\n"));
  if (ops.every((op) => op.type === "equal")) {
    return "no differences: input already matches canonical form";
  }
  return ops.map((op) => `${MARKERS[op.type]}${op.line}`).join("\n");
}
