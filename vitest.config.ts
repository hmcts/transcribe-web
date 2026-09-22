import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // MERGE NOTE: recording ships Playwright specs under tests/recording/e2e.
    // Its own scripts scoped vitest to tests/unit; the merged script runs the
    // whole tree, so exclude them here instead — vitest cannot run @playwright
    // specs. They run via "pnpm test:e2e".
    // .claude/worktrees holds throwaway copies of the whole repo from local
    // agent sessions. They are untracked, so CI never sees them, but locally
    // vitest would otherwise collect every test twice over against stale code.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/e2e/**",
      "**/.claude/**",
    ],
    globals: true,
    // Both suites arrived with their own setup file; both are needed.
    setupFiles: ["./tests/setup.ts", "./tests/recording/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "app/**/*.{ts,tsx}",
        "components/**/*.{ts,tsx}",
        "hooks/**/*.{ts,tsx}",
        "lib/**/*.{ts,tsx}",
        "providers/**/*.{ts,tsx}",
        "lib/recording/**/*.{ts,tsx}",
        "components/recording/**/*.{ts,tsx}",
        "utils/**/*.{ts,tsx}",
      ],
      exclude: [
        "node_modules/",
        "tests/",
        "**/*.config.*",
        "**/*.d.ts",
        "**/*.test.*",
        "scripts/**",
        "src/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      // MERGE NOTE: recording's api-client and Next route handlers import
      // "server-only", whose guard throws under Vitest's jsdom environment.
      // Recording's own config aliased it to a no-op mock; dictation's did not,
      // so 18 recording test files failed until this was carried over.
      "server-only": path.resolve(__dirname, "./tests/recording/__mocks__/server-only.ts"),
    },
  },
});
