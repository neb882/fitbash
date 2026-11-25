import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = path.join(root, "scripts", "stamp-version.sh");

function copyOfSite(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "fitbash-stamp-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(path.join(root, "public"), dir, { recursive: true });
  return dir;
}
const stamp = (dir) => execFileSync("sh", [script, dir], { encoding: "utf8" }).trim();

test("the repository's own copy of the site is never stamped", () => {
  assert.match(readFileSync(path.join(root, "public", "sw.js"), "utf8"), /const VERSION = "dev";/);
  assert.match(readFileSync(path.join(root, "public", "index.html"), "utf8"), /name="fitbash-version" content="dev"/);
});

test("stamping writes one version into the page and the service worker", (t) => {
  const dir = copyOfSite(t);
  const version = stamp(dir);
  assert.match(version, /^[0-9a-f]{12}$/);
  assert.ok(readFileSync(path.join(dir, "sw.js"), "utf8").includes(`const VERSION = "${version}";`));
  assert.ok(readFileSync(path.join(dir, "index.html"), "utf8").includes(`name="fitbash-version" content="${version}"`));
});

test("the version changes exactly when a file a visitor loads changes", (t) => {
  const same = [stamp(copyOfSite(t)), stamp(copyOfSite(t))];
  assert.equal(same[0], same[1]);

  const edited = copyOfSite(t);
  appendFileSync(path.join(edited, "style.css"), "\n/* a change */\n");
  assert.notEqual(stamp(edited), same[0]);

  const added = copyOfSite(t);
  writeFileSync(path.join(added, "lib", "new.js"), "export {};\n");
  assert.notEqual(stamp(added), same[0]);
});

test("a copy that is already stamped is refused instead of stamped twice", (t) => {
  const dir = copyOfSite(t);
  stamp(dir);
  assert.throws(() => execFileSync("sh", [script, dir], { stdio: "pipe" }), /already stamped/);
});
