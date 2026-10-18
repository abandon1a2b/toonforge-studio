// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EntityEditor } from "./entity-editor";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <MemoryRouter>
        <EntityEditor open onOpenChange={() => {}} type="character" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe("Character editing", () => {
  it("preserves unknown height as explicit null with unit and provenance", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "character:test" }),
    });
    vi.stubGlobal("fetch", fetch);
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("名称 *"), "新角色");
    await user.click(screen.getByRole("button", { name: "保存资料" }));
    await waitFor(() => {
      if (!fetch.mock.calls.length)
        throw Error(screen.getByRole("alert").textContent || "no call");
    });
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.metadata.physical.height_cm).toEqual({
      value: null,
      unit: "cm",
      status: "unknown",
      source: "",
    });
  });
  it("requires a source before saving a numeric height", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("名称 *"), "新角色");
    await user.click(screen.getByRole("tab", { name: "物理信息" }));
    await user.type(
      screen.getByLabelText("赤脚制作身高（cm，未知留空）"),
      "170",
    );
    await user.click(screen.getByRole("button", { name: "保存资料" }));
    expect(await screen.findByText("填写身高数值时需要说明依据")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
