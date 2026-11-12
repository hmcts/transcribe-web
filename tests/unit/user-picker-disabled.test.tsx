import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOBODY, UserPicker } from "@/components/admin/user-picker";

// While a role is being assigned the whole picker is off: the suggestions too, so the person it
// will assign to cannot change under the request (the finished assignment clears the selection).

vi.mock("@/lib/admin-users-api", () => ({
  fetchAdminUsers: vi.fn(async () => ({
    items: [
      { id: "u-1", email: "judge.one@localhost.test", name: "Judge One", pending: false },
      { id: "u-2", email: "judge.two@localhost.test", name: "Judge Two", pending: false },
    ],
    total: 2,
  })),
}));

beforeEach(() => vi.clearAllMocks());

describe("UserPicker suggestions", () => {
  it.each([[false], [true]])("are clickable only when the picker is not disabled (disabled: %s)", async (disabled) => {
    render(<UserPicker id="who" value={{ ...NOBODY, email: "judge" }} onChange={() => undefined} disabled={disabled} />);
    const suggestion = await screen.findByRole("button", { name: /judge\.one@localhost\.test/ });
    expect((suggestion as HTMLButtonElement).disabled).toBe(disabled);
  });
});
