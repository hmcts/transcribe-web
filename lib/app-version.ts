import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Written by Jenkinsfile_CNP before the image build (the short git SHA, as in
// the image tag). The CNP pipeline passes no build arguments to the image.
const BUILD_VERSION_FILE = join(
  /* turbopackIgnore: true */ process.cwd(),
  "BUILD_VERSION",
);

const LOCAL_VERSION = "dev";

export function appVersion(buildVersionFile = BUILD_VERSION_FILE): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    return readFileSync(buildVersionFile, "utf8").trim() || LOCAL_VERSION;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return LOCAL_VERSION;
    throw err;
  }
}
