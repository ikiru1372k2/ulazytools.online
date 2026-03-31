import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function runPackageScriptsTest() {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const scripts = packageJson.scripts ?? {};

  assert.equal(scripts.lint, "next lint");
  assert.equal(
    scripts.typecheck,
    "tsc --noEmit --incremental false --project tsconfig.typecheck.json"
  );
  assert.equal(scripts.test, "node tests/run-tests.mjs");
  assert.equal(scripts.build, "next build");
  assert.equal(scripts["ci:smoke"], "node scripts/ci-runtime-smoke.mjs");
}
