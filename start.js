// Replaces `server.js` as the container entrypoint (see supervisord.conf).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// 1. Key Vault secrets. The HMCTS nodejs chart's `keyVaults:` block mounts each
//    secret as a FILE at /mnt/secrets/<vault>/<alias> (CSI driver); it does not
//    set environment variables. Load them into process.env before the server
//    starts so the login code (lib/auth/config.ts) can read them. An env var
//    that is already set wins. The transcribe-api does the same at package
//    import (runtime/secret_files.py).
const secretsDir = process.env.SECRETS_DIR ?? "/mnt/secrets/transcribe";
try {
  for (const name of readdirSync(secretsDir)) {
    const path = join(secretsDir, name);
    // The CSI driver also creates ..data / ..timestamp bookkeeping entries.
    if (name.startsWith(".") || !statSync(path).isFile()) continue;
    if (process.env[name] === undefined) {
      process.env[name] = readFileSync(path, "utf8").trim();
    }
  }
} catch (err) {
  if (err.code !== "ENOENT") throw err; // no mount locally: nothing to load
}

// 2. Runtime NEXT_PUBLIC_ values for the browser (read via lib/env.ts).
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.startsWith("NEXT_PUBLIC_"))
);

writeFileSync(
  "./public/env-config.js",
  `window.__ENV = ${JSON.stringify(env)};`
);

await import("./server.js");
