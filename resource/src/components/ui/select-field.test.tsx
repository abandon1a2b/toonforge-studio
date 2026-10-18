// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SelectField, SelectOption } from "./select-field";
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(cleanup);
function Filter() {
  const [value, setValue] = useState("");
  return (
    <>
      <SelectField aria-label="分类筛选" value={value} onValueChange={setValue}>
        <SelectOption value="">全部分类</SelectOption>
        <SelectOption value="scene">场景</SelectOption>
      </SelectField>
      <output aria-label="当前筛选">{value || "未筛选"}</output>
    </>
  );
}
describe("shared shadcn select", () => {
  it("supports selecting an item and returning to the empty filter", async () => {
    render(<Filter />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "分类筛选" }));
    await user.click(await screen.findByRole("option", { name: "场景" }));
    expect(screen.getByLabelText("当前筛选").textContent).toBe("scene");
    await user.click(screen.getByRole("combobox", { name: "分类筛选" }));
    await user.click(await screen.findByRole("option", { name: "全部分类" }));
    expect(screen.getByLabelText("当前筛选").textContent).toBe("未筛选");
  });
  it("supports keyboard selection", async () => {
    render(<Filter />);
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    await user.keyboard("{End}{Enter}");
    expect(screen.getByLabelText("当前筛选").textContent).toBe("scene");
  });
});
