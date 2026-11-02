import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("openid-client", () => ({}));

import CookiesPage from "@/app/cookies/page";
import { CONSENT_COOKIE_NAME } from "@/lib/analytics-consent";
import { getAuthConfig } from "@/lib/auth/config";
import { LOGIN_STATE_COOKIE, SESSION_COOKIE } from "@/lib/auth/session";

describe("cookie settings page", () => {
  it("lists the cookies this app actually sets, with their lifetimes", () => {
    render(<CookiesPage />);
    const rows = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => {
        const [name, , expires] = Array.from(row.querySelectorAll("td")).map(
          (cell) => cell.textContent
        );
        return [name, expires];
      });
    const sessionHours = getAuthConfig().sessionTtlSeconds / 3600;
    expect(rows).toEqual([
      [SESSION_COOKIE, `${sessionHours} hours`],
      [LOGIN_STATE_COOKIE, "10 minutes"],
      [CONSENT_COOKIE_NAME, "1 year"],
    ]);
  });
});
