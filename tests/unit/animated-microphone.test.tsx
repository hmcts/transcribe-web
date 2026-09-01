import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AnimatedMicrophone from "@/components/audio/animated-microphone";

describe("AnimatedMicrophone", () => {
  it("renders an SVG element", () => {
    const { container } = render(<AnimatedMicrophone />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("applies the given size to width and height", () => {
    const { container } = render(<AnimatedMicrophone size={64} />);
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("width")).toBe("64");
    expect(svg.getAttribute("height")).toBe("64");
  });

  it("shows strike-through lines when inactive", () => {
    const { container } = render(<AnimatedMicrophone isActive={false} />);
    const lines = container.querySelectorAll("line");
    expect(lines.length).toBe(2);
  });

  it("does not show strike-through lines when active", () => {
    const { container } = render(<AnimatedMicrophone isActive={true} />);
    const lines = container.querySelectorAll("line");
    expect(lines.length).toBe(0);
  });

  it("renders the mic outline path", () => {
    const { container } = render(<AnimatedMicrophone />);
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThan(0);
  });

  it("uses a clipPath for the fill rects", () => {
    const { container } = render(<AnimatedMicrophone />);
    expect(container.querySelector("clipPath")).toBeTruthy();
  });

  it("applies a custom className to the SVG", () => {
    const { container } = render(<AnimatedMicrophone className="my-class" />);
    expect(container.querySelector("svg")?.className.baseVal).toContain(
      "my-class"
    );
  });
});
