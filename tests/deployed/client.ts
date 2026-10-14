export const TEST_URL = (
  process.env.TEST_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

// No redirect following: tests assert on where the app sends an anonymous user.
export function get(path: string): Promise<Response> {
  return fetch(`${TEST_URL}${path}`, { redirect: "manual" });
}
