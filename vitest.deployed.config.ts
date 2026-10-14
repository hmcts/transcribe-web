import { defineConfig } from "vitest/config";

// yarn test:smoke / test:functional, run by the pipeline against TEST_URL.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/deployed/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
