import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// keyVaults secrets are mounted as files named after their alias, which start.js
// loads into process.env, so the alias must be the name instrumentation.ts reads.
const root = join(__dirname, "../..");
const values = readFileSync(
  join(root, "charts/transcribe-web/values.yaml"),
  "utf8"
);

function keyVaultSecrets(yaml: string): Record<string, string> {
  const block = yaml.slice(yaml.indexOf("  keyVaults:"));
  const pairs = block.matchAll(/- name: (\S+)\s*\n\s*alias: (\S+)/g);
  return Object.fromEntries([...pairs].map(([, name, alias]) => [name, alias]));
}

describe("chart values: App Insights for Flux-deployed pods", () => {
  it("mounts the shared-infra connection string under the name the SDK reads", () => {
    expect(keyVaultSecrets(values)).toMatchObject({
      AppInsightsConnectionString: "APPLICATIONINSIGHTS_CONNECTION_STRING",
    });
  });

  it("starts Azure Monitor from that same environment variable", () => {
    const instrumentation = readFileSync(
      join(root, "instrumentation.ts"),
      "utf8"
    );
    expect(instrumentation).toContain(
      "process.env.APPLICATIONINSIGHTS_CONNECTION_STRING"
    );
  });

  it("names the service, so telemetry is not reported as unknown_service:node", () => {
    expect(values).toMatch(/^\s+OTEL_SERVICE_NAME: transcribe-web$/m);
  });
});
