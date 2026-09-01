import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useWhatsNewModal,
  WhatsNewModal,
} from "@/components/ui/whats-new-modal";

describe("WhatsNewModal", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <WhatsNewModal isOpen={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders dialog when isOpen is true", () => {
    const { getByRole } = render(
      <WhatsNewModal isOpen={true} onClose={vi.fn()} />
    );
    expect(getByRole("dialog")).toBeTruthy();
  });

  it("shows the 'What's New' heading", () => {
    const { getByText } = render(
      <WhatsNewModal isOpen={true} onClose={vi.fn()} />
    );
    expect(getByText("What's New")).toBeTruthy();
  });

  it("calls onClose when 'Got It' button is clicked", () => {
    let closed = false;
    const { getByText } = render(
      <WhatsNewModal
        isOpen={true}
        onClose={() => {
          closed = true;
        }}
      />
    );
    fireEvent.click(getByText("Got It"));
    expect(closed).toBe(true);
  });

  it("calls onClose when close (X) button is clicked", () => {
    let closed = false;
    const { getByLabelText } = render(
      <WhatsNewModal
        isOpen={true}
        onClose={() => {
          closed = true;
        }}
      />
    );
    fireEvent.click(getByLabelText("Close"));
    expect(closed).toBe(true);
  });

  it("calls onClose when backdrop is clicked", () => {
    let closed = false;
    const { getByLabelText } = render(
      <WhatsNewModal
        isOpen={true}
        onClose={() => {
          closed = true;
        }}
      />
    );
    fireEvent.click(getByLabelText("Close modal"));
    expect(closed).toBe(true);
  });
});

describe("useWhatsNewModal", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows modal when not previously dismissed", () => {
    const { result } = renderHook(() => useWhatsNewModal());
    expect(result.current.showModal).toBe(true);
  });

  it("hides modal when previously dismissed", () => {
    localStorage.setItem("whats_new_modal_dismissed", "true");
    const { result } = renderHook(() => useWhatsNewModal());
    expect(result.current.showModal).toBe(false);
  });

  it("handleDismiss hides modal and persists to localStorage", () => {
    const { result } = renderHook(() => useWhatsNewModal());
    act(() => {
      result.current.handleDismiss();
    });
    expect(result.current.showModal).toBe(false);
    expect(localStorage.getItem("whats_new_modal_dismissed")).toBe("true");
  });

  it("resetModal shows modal again and clears localStorage", () => {
    localStorage.setItem("whats_new_modal_dismissed", "true");
    const { result } = renderHook(() => useWhatsNewModal());
    act(() => {
      result.current.resetModal();
    });
    expect(result.current.showModal).toBe(true);
    expect(localStorage.getItem("whats_new_modal_dismissed")).toBeNull();
  });
});
