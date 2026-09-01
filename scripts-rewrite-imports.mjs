#!/usr/bin/env node
/**
 * Repoint recording-origin imports at their namespaced locations.
 *
 * Both upstream frontends used the same `@/*` -> `./*` alias, and both had
 * `lib/utils.ts`, `lib/api-client.ts`, `lib/auth-utils.ts` and several
 * `components/ui/*` files with the same names but different contents. Dictation
 * is the base, so recording's copies live under `lib/recording/` and
 * `components/recording/` and its files must be pointed there.
 *
 * Idempotent: already-namespaced paths are left alone.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Directories whose files originated in the recording frontend.
const RECORDING_TREES = [
  "app/recording",
  "app/api",
  "components/recording",
  "lib/recording",
  "tests/recording",
];

const EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.has(p.slice(p.lastIndexOf(".")))) out.push(p);
  }
  return out;
}

function rewrite(text) {
  let n = 0;
  const sub = (re, repl) => {
    text = text.replace(re, (...args) => {
      n += 1;
      return typeof repl === "function" ? repl(...args) : repl;
    });
  };

  // @/lib/... -> @/lib/recording/...   (skip if already namespaced)
  sub(/(['"`])@\/lib\/(?!recording\/)/g, (_m, q) => `${q}@/lib/recording/`);
  // @/components/... -> @/components/recording/...
  sub(/(['"`])@\/components\/(?!recording\/)/g, (_m, q) => `${q}@/components/recording/`);

  // Recording's own routes moved under /recording, EXCEPT its app/api route
  // handlers, which kept their paths because dictation had no app/api.
  sub(/(['"`])@\/app\/page(?=['"`])/g, (_m, q) => `${q}@/app/recording/page`);
  sub(/(['"`])@\/app\/jobs\//g, (_m, q) => `${q}@/app/recording/jobs/`);

  return [text, n];
}

let files = 0;
let subs = 0;
for (const tree of RECORDING_TREES) {
  for (const f of walk(tree)) {
    const before = readFileSync(f, "utf8");
    const [after, n] = rewrite(before);
    if (n > 0) {
      writeFileSync(f, after);
      files += 1;
      subs += n;
    }
  }
}
console.log(`rewrote ${subs} import specifiers across ${files} files`);
