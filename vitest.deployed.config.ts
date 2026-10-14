import { defineConfig } from "vitest/config";

// Tests that run against a deployed environment, after the CNP pipeline's AKS
// deploy: `yarn test:smoke` and `yarn test:functional` (YarnBuilder). TEST_URL
// is set by the pipeline to the release it just deployed. Plain Node: no jsdom,
// no unit-test setup files.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/deployed/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
