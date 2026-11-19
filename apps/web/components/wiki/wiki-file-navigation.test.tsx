import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { TWikiNode } from "@/services/wiki.service";
import { useWikiFileNavigation } from "./use-wiki-file-navigation";

const { retrieve } = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock("@/services/wiki.service", () => ({
  WikiService: class {
    retrieve = retrieve;
  },
}));

function deferred() {
  let resolve!: (node: TWikiNode) => void;
  const promise = new Promise<TWikiNode>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("keeps the current file on cancel and ignores the late response", async () => {
  const request = deferred();
  const navigate = vi.fn();
  retrieve.mockReturnValue(request.promise);
  const { result } = renderHook(() => useWikiFileNavigation("team", "A", navigate));
  const node = { id: "B", name: "File B" } as TWikiNode;
  act(() => {
    void result.current.openFile(node);
  });
  expect(result.current.loadingName).toBe("File B");
  expect(navigate).not.toHaveBeenCalled();
  act(() => result.current.cancel());
  await act(async () => request.resolve(node));
  expect(result.current.loadingName).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});

it("navigates only after loading and ignores an earlier cancelled request", async () => {
  const first = deferred();
  const second = deferred();
  const navigate = vi.fn();
  retrieve.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result } = renderHook(() => useWikiFileNavigation("team", "A", navigate));
  const b = { id: "B", name: "B" } as TWikiNode;
  const c = { id: "C", name: "C" } as TWikiNode;
  act(() => {
    void result.current.openFile(b);
  });
  act(() => result.current.cancel());
  act(() => {
    void result.current.openFile(c);
  });
  await act(async () => first.resolve(b));
  expect(result.current.loadingName).toBe("C");
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => second.resolve(c));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/team/wiki/C"));
  expect(result.current.loaded?.node).toEqual(c);
});

it("stays on the current file if loading fails", async () => {
  retrieve.mockRejectedValue(new Error("Network error"));
  const navigate = vi.fn();
  const { result } = renderHook(() => useWikiFileNavigation("team", "A", navigate));
  await act(async () => result.current.openFile({ id: "B", name: "B" } as TWikiNode));
  expect(result.current.failed).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
});
