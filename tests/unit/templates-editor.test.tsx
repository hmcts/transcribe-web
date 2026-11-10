import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TemplatesEditor } from "@/components/admin/templates-editor";
import { apiClient } from "@/lib/api-client";
import type { AdminTemplate, TemplateField } from "@/lib/templates-api";

// DIAAT-344: a SystemAdministrator uploads a jurisdiction's Word template, gets a
// field for each of its fill-in boxes, and sets their labels, types, whether they are
// required and their options. Fields cannot be added; saving with a box unlinked says
// which box.

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ apiClient: { request: vi.fn() } }));

const request = vi.mocked(apiClient.request);

// Radix Select uses DOM APIs jsdom does not have.
Element.prototype.scrollIntoView ??= vi.fn();
Element.prototype.hasPointerCapture ??= vi.fn(() => false);
Element.prototype.releasePointerCapture ??= vi.fn();
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {
      // No-op for jsdom.
    }
    unobserve() {
      // No-op for jsdom.
    }
    disconnect() {
      // No-op for jsdom.
    }
  }
);

const field = (
  tag: string,
  change: Partial<TemplateField> = {}
): TemplateField => ({
  tag,
  label: tag,
  type: "text",
  required: true,
  options: [],
  source: null,
  ...change,
});

const UPLOADED: AdminTemplate = {
  id: "t1",
  name: "ET judgment",
  service: null,
  file_name: "ET judgment.docx",
  enabled: false,
  boxes: [
    {
      key: "Reference",
      label: "Reference",
      kind: "text",
      options: [],
      count: 2,
    },
    {
      key: "Party1Title",
      label: "Party1Title",
      kind: "dropdown",
      options: ["Claimant", "Respondent"],
      count: 1,
    },
    {
      key: "JudgmentText",
      label: "Judgment text",
      kind: "text",
      options: [],
      count: 1,
    },
  ],
  fields: [
    field("Reference"),
    field("Party1Title", {
      type: "dropdown",
      options: ["Claimant", "Respondent"],
    }),
    field("JudgmentText", {
      label: "Judgment text",
      type: "dictated",
      required: false,
    }),
  ],
  problems: [],
  version: "v1",
};

/** A small fake of the API's template routes. */
function serve(templates: AdminTemplate[] = [], refuse?: string[]) {
  let list = [...templates];
  request.mockImplementation(
    async (endpoint: string, options?: RequestInit) => {
      const method = options?.method ?? "GET";
      if (endpoint === "/admin/jurisdictions/ET/templates" && method === "GET")
        return { data: list };
      if (
        endpoint.startsWith("/admin/jurisdictions/ET/templates") &&
        method === "POST"
      ) {
        list = [UPLOADED];
        return { data: UPLOADED, status: 201 };
      }
      const one = endpoint.match(
        /^\/admin\/jurisdictions\/ET\/templates\/(\w+)$/
      );
      if (one && method === "PUT") {
        if (refuse)
          return {
            error: "The template cannot be saved yet.",
            problems: refuse,
            status: 400,
          };
        const body = JSON.parse(String(options?.body));
        const existing = list.find((t) => t.id === one[1]);
        if (!existing) return { error: "Not found", status: 404 };
        const saved = {
          ...existing,
          ...body,
          problems: [],
          version: "v2",
        };
        list = list.map((t) => (t.id === saved.id ? saved : t));
        return { data: saved };
      }
      if (one && method === "DELETE") {
        list = list.filter((t) => t.id !== one[1]);
        return { data: undefined, status: 204 };
      }
      throw new Error(`Unexpected ${method} ${endpoint}`);
    }
  );
}

const puts = () =>
  request.mock.calls
    .filter(([, o]) => o?.method === "PUT")
    .map(([, o]) => JSON.parse(String(o?.body)));

async function open(
  user: ReturnType<typeof userEvent.setup>,
  name = "ET judgment"
) {
  render(<TemplatesEditor code="ET" />);
  await user.click(await screen.findByRole("button", { name }));
  return screen.findByRole("region", { name: `Fields of ${name}` });
}

describe("TemplatesEditor", () => {
  beforeEach(() => {
    request.mockReset();
  });

  it("uploads a Word template as the raw file and lists its boxes as fields", async () => {
    serve();
    render(<TemplatesEditor code="ET" />);
    expect(await screen.findByText("No templates yet.")).toBeTruthy();

    const file = new File(["docx bytes"], "ET judgment.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(screen.getByLabelText("Word template to upload"), {
      target: { files: [file] },
    });

    const fields = await screen.findByRole("region", {
      name: "Fields of ET judgment",
    });
    const post = request.mock.calls.find(([, o]) => o?.method === "POST");
    expect(post?.[0]).toBe("/admin/jurisdictions/ET/templates");
    expect(post?.[1]?.body).toBe(file);
    expect(post?.[1]?.headers).toEqual({
      "Content-Type": "application/octet-stream",
      "X-Upload-Filename": "ET%20judgment.docx",
    });
    expect(
      (
        within(fields).getByLabelText(
          "Label of box Reference"
        ) as HTMLInputElement
      ).value
    ).toBe("Reference");
    expect(within(fields).getByText("Box Reference, 2 places")).toBeTruthy();
    expect(
      within(fields).getByText("The judge's dictated judgment")
    ).toBeTruthy();
    expect(
      (
        within(fields).getByLabelText(
          "Options for Party1Title"
        ) as HTMLTextAreaElement
      ).value
    ).toBe("Claimant\nRespondent");
    expect(screen.getByText("Off")).toBeTruthy();
    // Only the template's boxes: there is no way to add a field.
    expect(
      screen.queryByRole("button", { name: /add (a )?field/i })
    ).toBeNull();
  });

  it("saves relabelled, retyped and reordered fields and makes it available to judges", async () => {
    serve([UPLOADED]);
    const user = userEvent.setup();
    const fields = await open(user);

    const label = within(fields).getByLabelText("Label of box Reference");
    await user.clear(label);
    await user.type(label, "Case number");
    await user.click(
      within(fields).getByRole("combobox", { name: "Is Case number required" })
    );
    await user.click(await screen.findByRole("option", { name: "Optional" }));
    const options = within(fields).getByLabelText("Options for Party1Title");
    await user.clear(options);
    await user.type(
      options,
      "Claimant{Enter}  {Enter}Respondent{Enter}Intervenor"
    );
    await user.click(
      within(fields).getByRole("button", { name: "Move Case number down" })
    );
    await user.click(within(fields).getByLabelText("Available to judges"));
    await user.click(within(fields).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Saved ET judgment")
    );
    const [saved] = puts();
    expect(saved).toMatchObject({
      name: "ET judgment",
      service: null,
      enabled: true,
      version: "v1",
    });
    expect(saved.fields.map((f: TemplateField) => f.tag)).toEqual([
      "Party1Title",
      "Reference",
      "JudgmentText",
    ]);
    expect(saved.fields[0].options).toEqual([
      "Claimant",
      "Respondent",
      "Intervenor",
    ]);
    expect(saved.fields[1]).toMatchObject({
      label: "Case number",
      required: false,
      options: [],
    });
  });

  it("names the box that has no field when it cannot be saved", async () => {
    const replaced: AdminTemplate = {
      ...UPLOADED,
      boxes: [
        ...UPLOADED.boxes,
        { key: "Costs", label: "Costs", kind: "text", options: [], count: 1 },
      ],
      problems: ["The box “Costs” (Costs) has no field linked to it."],
    };
    serve([replaced]);
    const user = userEvent.setup();
    const fields = await open(user);

    const missing = within(fields).getByRole("region", {
      name: "Before it can be saved:",
    });
    expect(
      within(missing).getByText(
        "The box “Costs” (Costs) has no field linked to it."
      )
    ).toBeTruthy();
    expect(screen.getByText("Incomplete")).toBeTruthy();

    await user.click(
      within(fields).getByRole("button", { name: "Link a field" })
    );
    expect(within(fields).getByLabelText("Label of box Costs")).toBeTruthy();
    await user.click(within(fields).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].fields.map((f: TemplateField) => f.tag)).toContain(
      "Costs"
    );
  });

  it("shows what the API says is missing when a save is refused", async () => {
    serve([UPLOADED], ["“Party1Title” needs at least one option."]);
    const user = userEvent.setup();
    const fields = await open(user);

    await user.clear(within(fields).getByLabelText("Options for Party1Title"));
    await user.click(within(fields).getByRole("button", { name: "Save" }));

    const missing = await within(fields).findByRole("region", {
      name: "Before it can be saved:",
    });
    expect(
      within(missing).getByText("“Party1Title” needs at least one option.")
    ).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith(
      "The template cannot be saved yet: see what is missing."
    );
  });

  it("asks what BenchNotes fills a field with", async () => {
    serve([UPLOADED]);
    const user = userEvent.setup();
    const fields = await open(user);

    await user.click(
      within(fields).getByRole("combobox", { name: "Type of Reference" })
    );
    await user.click(
      await screen.findByRole("option", { name: "Filled by BenchNotes" })
    );
    // Like the dictated judgment, it is no longer asked of the judge.
    expect(within(fields).getAllByText("Not asked")).toHaveLength(2);
    await user.click(
      within(fields).getByRole("combobox", {
        name: "What BenchNotes fills Reference with",
      })
    );
    await user.click(await screen.findByRole("option", { name: "The year" }));
    await user.click(within(fields).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].fields[0]).toMatchObject({
      type: "benchnotes",
      source: "year",
    });
  });

  it("edits the options of a box tagged like one of Object's own properties", async () => {
    const odd: AdminTemplate = {
      ...UPLOADED,
      boxes: [
        {
          key: "__proto__",
          label: "Outcome",
          kind: "dropdown",
          options: ["Allowed"],
          count: 1,
        },
      ],
      fields: [
        field("__proto__", {
          label: "Outcome",
          type: "dropdown",
          options: ["Allowed"],
        }),
      ],
    };
    serve([odd]);
    const user = userEvent.setup();
    const fields = await open(user);

    const options = within(fields).getByLabelText(
      "Options for Outcome"
    ) as HTMLTextAreaElement;
    expect(options.value).toBe("Allowed");
    await user.type(options, "{Enter}Dismissed");
    await user.click(within(fields).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].fields[0]).toMatchObject({
      tag: "__proto__",
      options: ["Allowed", "Dismissed"],
    });
  });

  it("allows no edits while a save is under way, which the saved copy would drop", async () => {
    serve([UPLOADED]);
    const fake = request.getMockImplementation();
    let finish: () => void = () => undefined;
    request.mockImplementation(
      async (endpoint: string, options?: RequestInit) => {
        if (options?.method === "PUT")
          await new Promise<void>((resolve) => (finish = resolve));
        return fake?.(endpoint, options) as ReturnType<
          typeof apiClient.request
        >;
      }
    );
    const user = userEvent.setup();
    const fields = await open(user);
    const label = () =>
      within(screen.getByRole("region", { name: /Fields of/ })).getByLabelText(
        "Label of box Reference"
      );

    await user.click(within(fields).getByRole("button", { name: "Save" }));

    expect(label().matches(":disabled")).toBe(true);
    expect(
      within(fields)
        .getByRole("combobox", { name: "Type of Reference" })
        .matches(":disabled")
    ).toBe(true);
    expect(
      (
        within(fields).getByRole("button", {
          name: "Save",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    finish();
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Saved ET judgment")
    );
    await waitFor(() => expect(label().matches(":disabled")).toBe(false));
  });

  it("deletes a template only once confirmed", async () => {
    serve([UPLOADED]);
    const user = userEvent.setup();
    const fields = await open(user);

    await user.click(
      within(fields).getByRole("button", { name: "Delete template" })
    );
    expect(request.mock.calls.some(([, o]) => o?.method === "DELETE")).toBe(
      false
    );
    await user.click(
      within(fields).getByRole("button", { name: "Confirm delete" })
    );

    expect(await screen.findByText("No templates yet.")).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith("Deleted ET judgment");
  });

  it("says when the API is too old to have templates", async () => {
    request.mockResolvedValue({ error: "Not Found", status: 404 });
    render(<TemplatesEditor code="ET" />);
    expect(
      await screen.findByText("Templates need the latest version of the API.")
    ).toBeTruthy();
  });
});
