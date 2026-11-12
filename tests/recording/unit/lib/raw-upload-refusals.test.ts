import { describe, expect, it } from "vitest";
import { BackendApiError } from "@/lib/recording/api-client";
import { backendFailed } from "@/lib/recording/raw-upload";

// DIAAT-373: an upload the API refused because of who the user is (another tab switched context, the
// account was deactivated) reaches the browser with its status and code, so the stale-tab or account
// notice shows. Any other failure keeps its fixed message.

describe("backendFailed", () => {
  it.each([
    [409, "context_changed"],
    [403, "context_required"],
    [403, "user_deactivated"],
  ])("passes a %s %s refusal on with its status and code", async (status, code) => {
    const response = backendFailed(
      new BackendApiError("refused", status, undefined, code),
      "Failed to submit audio"
    );

    expect(response.status).toBe(status);
    expect((await response.json()).detail.code).toBe(code);
  });

  it("leaves a plain 401 to the upload route's own mapping (same status, fixed message)", async () => {
    const response = backendFailed(new BackendApiError("no token", 401), "x");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "x" });
  });

  it("keeps the fixed message for every other failure", async () => {
    const refused = backendFailed(new BackendApiError("bad file", 422), "Failed to submit audio");
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: "Failed to submit audio" });
    expect(backendFailed(new Error("down"), "Failed to submit audio").status).toBe(502);
  });
});
