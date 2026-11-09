/**
 * Local development only (see isDevLoginMode): the personas transcribe-api
 * seeds when it runs with ENVIRONMENT=local (scripts-seed-personas.py). They
 * are test accounts at @localhost.test. The descriptions are for the person
 * picking one; the app decides nothing from them.
 */
export interface DevPersona {
  name: string;
  description: string;
}

export const DEV_PERSONAS: DevPersona[] = [
  { name: "judge-et", description: "Judge in ET: goes straight in" },
  { name: "judge-iac", description: "Judge in IAC: goes straight in" },
  { name: "multi", description: "Judge in ET and administrator in IAC: must choose" },
  { name: "jadmin-iac", description: "Administrator in IAC" },
  { name: "jadmin-et", description: "Administrator in ET" },
  { name: "legal-iac", description: "Legal text manager in IAC" },
  { name: "jsuper", description: "Super administrator, every jurisdiction" },
  { name: "sysadmin", description: "System administrator, no jurisdiction" },
  { name: "no-role", description: "Signed in, no access yet" },
];

export function devLoginUrl(persona: string, returnTo = "/"): string {
  const params = new URLSearchParams({ persona, returnTo });
  return `/auth/dev-login?${params}`;
}
