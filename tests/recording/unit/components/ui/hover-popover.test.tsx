import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HoverPopover } from "@/components/recording/ui/hover-popover";

function renderInScrollingTable(onRowClick = vi.fn()) {
  render(
    <div data-testid="scroller" className="overflow-x-auto">
      <table>
        <tbody>
          <tr onClick={onRowClick}>
            <td>
              <HoverPopover ariaLabel="Details" trigger="3 days">
                <p>Day 1</p>
              </HoverPopover>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
  return onRowClick;
}

describe("HoverPopover", () => {
  // A table's overflow-x-auto wrapper clips anything positioned inside it.
  it("renders its panel outside any scrolling ancestor, fixed to the viewport", async () => {
    const user = userEvent.setup();
    renderInScrollingTable();

    await user.click(screen.getByRole("button", { name: "Details" }));

    const panel = screen.getByRole("dialog", { name: "Details" });
    expect(screen.getByTestId("scroller").contains(panel)).toBe(false);
    expect(panel.style.position).toBe("fixed");
  });

  it("keeps clicks inside the panel from reaching the row", async () => {
    const user = userEvent.setup();
    const onRowClick = renderInScrollingTable();

    await user.click(screen.getByRole("button", { name: "Details" }));
    await user.click(screen.getByText("Day 1"));

    expect(onRowClick).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Details" })).toBeDefined();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderInScrollingTable();

    await user.click(screen.getByRole("button", { name: "Details" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("HoverPopover keyboard access", () => {
  function renderWithLink() {
    render(
      <>
        <HoverPopover ariaLabel="Details" trigger="file.mp3">
          <a href="https://example.test/docs">About models</a>
        </HoverPopover>
        <a href="/next">Next link</a>
      </>
    );
  }

  it("tabs from the open trigger into the panel and back out after it", async () => {
    const user = userEvent.setup();
    renderWithLink();

    await user.tab();
    await user.keyboard("{Enter}");
    await user.tab();

    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "About models" })
    );
    expect(screen.getByRole("dialog", { name: "Details" })).toBeDefined();

    await user.tab();

    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Next link" })
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("returns to the trigger on Shift+Tab or Escape from the panel", async () => {
    const user = userEvent.setup();
    renderWithLink();
    const trigger = screen.getByRole("button", { name: "Details" });

    await user.tab();
    await user.keyboard("{Enter}");
    await user.tab();
    await user.tab({ shift: true });

    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole("dialog", { name: "Details" })).toBeDefined();

    await user.tab();
    await user.keyboard("{Escape}");

    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("HoverPopover with text only", () => {
  it("lets the keyboard into a panel with nothing focusable, and on past it", async () => {
    const user = userEvent.setup();
    render(
      <>
        <HoverPopover ariaLabel="Days" trigger="3 days">
          <p>Day 1</p>
        </HoverPopover>
        <a href="/next">Next link</a>
      </>
    );
    const trigger = screen.getByRole("button", { name: "Days" });

    await user.tab();
    await user.keyboard("{Enter}");
    await user.tab();

    const panel = screen.getByRole("dialog", { name: "Days" });
    expect(document.activeElement).toBe(panel);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(trigger);

    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Next link" })
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
