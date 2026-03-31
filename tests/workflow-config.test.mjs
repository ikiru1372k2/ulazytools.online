import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function runWorkflowConfigTest() {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");

  assert.match(workflow, /^name: CI/m);
  assert.match(workflow, /push:\s+branches:\s+- main/m);
  assert.match(workflow, /pull_request:/m);
  assert.match(workflow, /permissions:\s+contents: read/m);
  assert.match(workflow, /cancel-in-progress: true/m);
  assert.match(workflow, /name: Quality/m);
  assert.match(workflow, /run: npm run lint/m);
  assert.match(workflow, /run: npm run typecheck/m);
  assert.match(workflow, /run: npm test/m);
  assert.match(workflow, /name: Integration Smoke/m);
  assert.match(workflow, /run: npm run ci:smoke/m);
  assert.match(workflow, /name: Build/m);
  assert.match(workflow, /run: npx prisma generate/m);
  assert.match(workflow, /run: npm run build/m);
}
