import { describe, expect, it } from "vitest";
import {
  describeRefusal,
  OWN_REQUEST_NOTE,
  SELF_ASSIGNMENT_NOTE,
} from "@/lib/access/refusal-messages";
import { AdminApiError } from "@/lib/admin-api";
import { actorLabel, type RoleHistoryEntry } from "@/lib/admin-users-api";
import { submissionErrorResponseSchema } from "@/lib/editor-contracts";

// DIAAT-373: the refusal codes the API added in its review fixes, in plain words.

const refused = (code: string, message = "the API's own words", status = 403) =>
  new AdminApiError(message, status, code);

describe("describeRefusal", () => {
  it("says an own request is decided by someone else", () => {
    expect(describeRefusal(refused("own_request"))).toBe(OWN_REQUEST_NOTE);
  });

  it("says why giving yourself a role is refused, and otherwise keeps the API's words", () => {
    const error = refused("assignment_not_allowed", "Only a super administrator assigns that.");
    expect(describeRefusal(error, { self: true })).toBe(SELF_ASSIGNMENT_NOTE);
    expect(describeRefusal(error)).toBe("Only a super administrator assigns that.");
  });

  it("tells an ambiguous email to be picked from the list", () => {
    expect(describeRefusal(refused("ambiguous_email", "x", 409))).toMatch(
      /More than one person.*Choose the person from the list/
    );
  });

  it("tells a disabled jurisdiction apart, for assigning and for approving", () => {
    expect(describeRefusal(refused("jurisdiction_disabled", "x", 409))).toMatch(
      /switched off.*super administrator/
    );
  });

  it("tells a requester to withdraw one request when five are waiting", () => {
    expect(describeRefusal(refused("too_many_pending_requests", "x", 409))).toMatch(
      /Withdraw one of them/
    );
  });

  it("explains permission_denied as the rename rule only when saving a jurisdiction", () => {
    const error = refused("permission_denied", "Your role cannot do that.");
    expect(describeRefusal(error, { savingJurisdiction: true })).toMatch(
      /Only a super administrator can rename or switch off/
    );
    expect(describeRefusal(error)).toBe("Your role cannot do that.");
  });

  it("falls back to the API's message, then to the fallback, for any other code", () => {
    expect(describeRefusal(refused("something_new", "A new reason"))).toBe("A new reason");
    expect(describeRefusal("not an error", {}, "Not added")).toBe("Not added");
    expect(describeRefusal(undefined)).toBe("Something went wrong");
  });
});

describe("actorLabel (role history)", () => {
  const row = (actor: unknown) => ({ actor }) as Pick<RoleHistoryEntry, "actor">;

  it("is the email of a person", () => {
    expect(actorLabel(row({ id: "u-1", email: "bob@example.test" }))).toBe("bob@example.test");
  });

  it("is System administrator when the API names no person (actor.id null)", () => {
    expect(actorLabel(row({ id: null, email: "system administrator" }))).toBe("System administrator");
    expect(actorLabel(row({ id: null, email: "" }))).toBe("System administrator");
    expect(actorLabel(row(null))).toBe("System administrator");
    expect(actorLabel(row(undefined))).toBe("System administrator");
  });

  it("is the email the API gave, when it is an address, even with no id", () => {
    expect(actorLabel(row({ id: null, email: "sys@example.test" }))).toBe("sys@example.test");
  });

  it("does not invent a name for a person with no email", () => {
    expect(actorLabel(row({ id: "u-1", email: "" }))).toBe("Unknown user");
  });
});

describe("the dictation submission's error body", () => {
  it("reads the API's {code, message} detail (401, 409, 403) as its message", () => {
    expect(
      submissionErrorResponseSchema.parse({ detail: { code: "invalid_token", message: "Sign in again." } })
    ).toEqual({ error: "Sign in again." });
  });

  it("still reads a string detail and an error field", () => {
    expect(submissionErrorResponseSchema.parse({ detail: "down" })).toEqual({ error: "down" });
    expect(submissionErrorResponseSchema.parse({ error: "bad" })).toEqual({ error: "bad" });
  });
});
