import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The repository is public and its history keeps everything. This catches what a pattern can
// see; names in prose and pictures of people are still on whoever commits.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEXT = /\.(md|js|mjs|json|html|css|yml|yaml|sh|txt|svg)$/;
// Generated or third-party text, which is not ours to scan: the vendored SDK, the lock file, a font's licence.
// This file is skipped too: its second test holds made-up examples of each thing.
const SKIP = [/^public\/vendor\//, /^package-lock\.json$/, /^public\/fonts\/OFL\.txt$/, /^test\/privacy\.test\.js$/];

const PATTERNS = [
  // A real home folder. Placeholders (<home>, <user>, <owner>) and the names every machine has are fine.
  ["a Windows home-folder path", /[A-Za-z]:[\\/]+Users[\\/]+(?!<|Public\b|Default\b)[^\\/\s"'`<>|]+/g],
  ["a home-folder path", /(?<![\w.-])\/(?:Users|home)\/(?!<|user\b|runner\b)[A-Za-z0-9._-]+/g],
  ["a computer's name", /\b(?:DESKTOP|LAPTOP|WIN)-[A-Z0-9]{6,}\b/g],
  ["a session's identifier", /\bsession_[0-9A-Za-z]{16,}\b/g],
  ["an email address", /\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org)\b)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g],
];
// Text that only looks like one of the above.
const ALLOWED = [/^noreply@anthropic\.com$/, /^@anthropic-ai\//, /@[\d.]+$/];

export function findings(file, text) {
  const found = [];
  for (const [what, pattern] of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (ALLOWED.some((ok) => ok.test(match[0]))) continue;
      const line = text.slice(0, match.index).split("\n").length;
      found.push(`${file}:${line}: ${what}: ${match[0]}`);
    }
  }
  return found;
}

test("no tracked file holds a home-folder path, a computer's name, an email address or a session's identifier", () => {
  const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((file) => TEXT.test(file) && !SKIP.some((skip) => skip.test(file)));
  assert.ok(files.length > 30, "the tracked files were listed");
  const found = files.flatMap((file) => findings(file, readFileSync(path.join(root, file), "utf8")));
  assert.deepEqual(found, []);
});

test("the check sees what it is there for, and leaves placeholders alone", () => {
  const caught = (text) => findings("x.md", text).length;
  // Each of these is the shape of something a worker's log has really held.
  assert.equal(caught(String.raw`Hash verified for C:\Users\someone\.cache\huggingface\hub`), 1);
  assert.equal(caught("Started C:\\Users/someone\\.cache\\lemonade\\bin\\sd-server.exe"), 1);
  assert.equal(caught("cwd: /Users/someone/code/fitbash"), 1);
  assert.equal(caught("cwd: /home/someone/fitbash"), 1);
  assert.equal(caught("computer DESKTOP-AB12CD3 answered"), 1);
  assert.equal(caught("from session_0123456789abcdefABCDEFgh"), 1);
  assert.equal(caught("write to someone@mail.example.net about it"), 1);

  assert.equal(caught(String.raw`C:\Users\<user>\.cache and <home>/.cache and C:\Users\Public`), 0);
  assert.equal(caught("/home/user/fitbash on the cloud machine, /home/runner/work on CI"), 0);
  assert.equal(caught("https://example.com/home/page and docs/home/index.md"), 0);
  assert.equal(caught("Co-Authored-By: someone <noreply@anthropic.com>"), 0);
  assert.equal(caught("import x from '@anthropic-ai/sdk'; actions/checkout@v7; playwright@1.63.0"), 0);
});
