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

describe("chart values: Dictation feature flag (DIAAT-366)", () => {
  // The nodejs chart renders each value with `tpl ($val | quote)`, which
  // escapes double quotes, so the string literal has to be a backtick one.
  it("turns Dictation off in prod only, from global.environment", () => {
    expect(values).toContain(
      "NEXT_PUBLIC_DICTATION_ENABLED: '{{ ne .Values.global.environment `prod` }}'"
    );
  });

  it("is read through getEnv, so start.js's runtime value reaches the browser", () => {
    const environment = readFileSync(join(root, "lib/environment.ts"), "utf8");
    expect(environment).toContain('getEnv("NEXT_PUBLIC_DICTATION_ENABLED")');
  });
});

describe("chart values: transcribe-api in PR previews (DIAAT-399)", () => {
  const chart = (file: string) =>
    readFileSync(join(root, "charts/transcribe-web", file), "utf8");

  it("deploys the api subchart only where its condition is switched on", () => {
    expect(chart("Chart.yaml")).toMatch(
      /- name: transcribe-api\n(\s+.+\n)*?\s+condition: transcribe-api\.enabled\n/
    );
    expect(values).toMatch(/^transcribe-api:\n {2}enabled: false$/m);
    expect(chart("values.aat.template.yaml")).not.toContain("transcribe-api:");
  });

  it("switches it on in previews, with the preview user, and no ingress", () => {
    const preview = chart("values.preview.template.yaml");
    expect(preview).toMatch(/^transcribe-api:\n {2}enabled: true$/m);
    expect(preview).toContain("ENVIRONMENT: preview");
    expect(preview).toContain("AUTH_PREVIEW_USER_ENABLED: 'true'");
    expect(preview).toContain("ingressHost: ''");
    expect(preview).toContain(
      "BACKEND_INTERNAL_URL: http://{{ .Release.Name }}-python"
    );
  });

  // envsubst turns an unset variable into an empty string, so the image tag
  // must always be set by the pipeline.
  it("takes the api image tag from the pipeline, which always sets it", () => {
    expect(chart("values.preview.template.yaml")).toMatch(
      /^\s+image: hmctsprod\.azurecr\.io\/transcribe\/api:\$\{TRANSCRIBE_API_IMAGE_TAG\}$/m
    );
    const jenkinsfile = readFileSync(join(root, "Jenkinsfile_CNP"), "utf8");
    expect(jenkinsfile).toMatch(
      /onPR \{\n\s+env\.TRANSCRIBE_API_IMAGE_TAG = apiImageTag\(\)/
    );
    expect(jenkinsfile).toContain('return "latest"');
  });
});
