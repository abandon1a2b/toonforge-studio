// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EntityAssets } from "./entity-assets";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("lists all character audio with inline players and pauses the previous player", async () => {
  const items = ["a", "b"].map((id) => ({
    id,
    entity_id: "character:test",
    revision_id: "rev:" + id,
    relative_path: id + ".wav",
    media_type: "audio",
    role: id === "a" ? "source_audio" : "voice",
    metadata: { technical: { duration_seconds: 2 } },
    status: "pending_review",
  }));
  const fetch = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ items, total: 2, offset: 0, limit: 24 }),
    });
  vi.stubGlobal("fetch", fetch);
  const pause = vi
    .spyOn(HTMLMediaElement.prototype, "pause")
    .mockImplementation(() => {});
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <EntityAssets entity="character:test" mediaType="audio" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const a = await screen.findByLabelText("播放 a.wav");
  const b = screen.getByLabelText("播放 b.wav");
  expect(a.tagName).toBe("AUDIO");
  expect(a.hasAttribute("controls")).toBe(true);
  expect(a.getAttribute("src")).toContain("audio-preview");
  expect(fetch.mock.calls[0][0]).toContain("type=audio");
  fireEvent.play(a);
  fireEvent.play(b);
  expect(pause).toHaveBeenCalledTimes(1);
});
