import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// DIAAT-373: the web decides nothing from role names; it shows what the API's
// permissions and role lists allow. This keeps the app source free of role
// strings except where one is genuinely a value the API needs, and keeps the
// system administrator out of every list and label.

const root = join(__dirname, "../..");
const SOURCE_DIRS = ["app", "components", "lib", "providers", "hooks"];
const SOURCE_FILES = ["proxy.ts"];

function walk(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (/\.(ts|tsx)$/.test(name)) found.push(path);
  }
  return found;
}

const files = [
  ...SOURCE_DIRS.flatMap((dir) => walk(join(root, dir))),
  ...SOURCE_FILES.map((f) => join(root, f)),
].map((path) => ({ path: relative(root, path), text: readFileSync(path, "utf8") }));

/** Files where a role value is a documented, deliberate exception. */
const ALLOWED_ROLE_VALUES: Record<string, string> = {
  // What `POST /api/access-requests` accepts (the contract's two requestable roles).
  "lib/access/requestable-roles.ts": "the two roles a user may request",
  // The roles the Jurisdictions and Super administrators screens assign.
  "lib/access/assignable-roles.ts": "the roles those two screens assign",
  // "Judge" as a speaker label in a dictation transcript, not a role.
  "components/audio/dictation/dictation.tsx": "a speaker label",
  "lib/recording/mock-data.ts": "a speaker label in demo data",
  "lib/recording/word-alignment.ts": "an example word in a comment",
};

const ROLE_VALUE =
  /["'`](Judge|LegalTextManager|JurisdictionAdministrator|JurisdictionSuperAdministrator)["'`]/;

describe("role strings in the web source", () => {
  it("appear only in the documented exceptions", () => {
    const offenders = files
      .filter((f) => ROLE_VALUE.test(f.text))
      .map((f) => f.path)
      .filter((path) => !(path in ALLOWED_ROLE_VALUES));
    expect(offenders).toEqual([]);
  });

  it("are not listed as exceptions without being there", () => {
    for (const path of Object.keys(ALLOWED_ROLE_VALUES)) {
      expect(files.find((f) => f.path === path)?.text, path).toMatch(ROLE_VALUE);
    }
  });

  it("never name the system administrator role", () => {
    const offenders = files.filter((f) => /SystemAdministrator/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("mention sysadmin only as a local dev persona's name", () => {
    const offenders = files
      .filter((f) => /sysadmin/i.test(f.text))
      .map((f) => f.path)
      .filter((path) => path !== "lib/dev-personas.ts");
    expect(offenders).toEqual([]);
  });

  it("do not come back as an auto-enrol or judge/admin member vocabulary", () => {
    const offenders = files
      .filter((f) => /auto_enrol|AdminJurisdictionMember|MEMBER_ROLES/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
