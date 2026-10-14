export const TEST_URL = (
  process.env.TEST_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

export function get(path: string): Promise<Response> {
  return fetch(`${TEST_URL}${path}`, { redirect: "manual" });
}
