import { runPackageScriptsTest } from "./package-scripts.test.mjs";
import { runWorkflowConfigTest } from "./workflow-config.test.mjs";

const testCases = [
  {
    name: "package scripts stay aligned with CI expectations",
    run: runPackageScriptsTest,
  },
  {
    name: "workflow config covers the required CI stages",
    run: runWorkflowConfigTest,
  },
];

async function main() {
  for (const testCase of testCases) {
    await testCase.run();
    console.log(`PASS ${testCase.name}`);
  }
}

main().catch((error) => {
  console.error("Test run failed.");
  console.error(error);
  process.exitCode = 1;
});
