import { CommitHeader, ParsedCommit, PersonStamp } from "./parser.js";

function formatPersonLine(label: string, person: PersonStamp): string {
  return `${label} ${person.name} <${person.email}> ${person.timestamp} ${person.tzOffset}`;
}

function formatHeaderBlock(header: CommitHeader): string {
  return header.value
    .split("\n")
    .map((line, index) => (index === 0 ? `${header.key} ${line}` : ` ${line}`))
    .join("\n");
}

// Re-serializes a parsed commit back into the exact text git would store,
// useful for round-tripping: parse(raw) -> printCanonical() should equal raw.
export function printCanonical(commit: ParsedCommit): string {
  const lines: string[] = [`tree ${commit.tree}`];
  for (const parent of commit.parents) lines.push(`parent ${parent}`);
  lines.push(formatPersonLine("author", commit.author));
  lines.push(formatPersonLine("committer", commit.committer));
  for (const header of commit.extraHeaders) lines.push(formatHeaderBlock(header));
  lines.push("", commit.message);
  return lines.join("\n");
}

// author/committer lines store a unix timestamp plus a raw offset like
// "-0500" rather than a timezone name, so the local time has to be
// reconstructed by hand instead of going through Date's own timezone logic.
function formatDate(timestamp: number, tzOffset: string): string {
  const sign = tzOffset.startsWith("-") ? -1 : 1;
  const hours = Number(tzOffset.slice(1, 3));
  const minutes = Number(tzOffset.slice(3, 5));
  const offsetSeconds = sign * (hours * 3600 + minutes * 60);
  const local = new Date((timestamp + offsetSeconds) * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
  return `${date} ${time} ${tzOffset}`;
}

// A human-readable rendering, closer to what a person reviewing history
// wants to see than the raw object format is.
export function printHuman(commit: ParsedCommit): string {
  const lines: string[] = [];
  lines.push(`tree      ${commit.tree}`);
  for (const parent of commit.parents) lines.push(`parent    ${parent}`);
  lines.push(
    `author    ${commit.author.name} <${commit.author.email}>  ${formatDate(commit.author.timestamp, commit.author.tzOffset)}`
  );
  lines.push(
    `committer ${commit.committer.name} <${commit.committer.email}>  ${formatDate(commit.committer.timestamp, commit.committer.tzOffset)}`
  );
  for (const header of commit.extraHeaders) {
    lines.push(`${header.key} (${header.value.split("\n").length} line(s), not rendered)`);
  }
  lines.push("");
  for (const messageLine of commit.message.split("\n")) lines.push(`    ${messageLine}`);
  return lines.join("\n");
}
