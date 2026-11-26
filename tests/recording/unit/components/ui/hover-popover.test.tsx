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
