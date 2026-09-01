// This file replaces `server.js` and allows NEXT_PUBLIC_ environment variables to be injected at runtime
import { writeFileSync } from "node:fs";

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.startsWith("NEXT_PUBLIC_"))
);

writeFileSync(
  "./public/env-config.js",
  `window.__ENV = ${JSON.stringify(env)};`
);

await import("./server.js");
