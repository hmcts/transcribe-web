export const TEST_URL = (
  process.env.TEST_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

export function get(
  path: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${TEST_URL}${path}`, { redirect: "manual", headers });
}

export function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${TEST_URL}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
