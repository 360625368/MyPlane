import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WikiDocument } from "./wiki-document";

const { retrieve, saveDescription, editors } = vi.hoisted(() => ({
  retrieve: vi.fn(),
  saveDescription: vi.fn(),
  editors: new Map<string, { onChange: (json: object, html: string, options: object) => void }>(),
}));
vi.mock("mobx-react", () => ({ observer: (component: unknown) => component }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/use-workspace", () => ({
  useWorkspace: () => ({ getWorkspaceBySlug: () => ({ id: "workspace" }) }),
}));
vi.mock("@/hooks/store/use-favorite", () => ({ useFavorite: () => ({ entityMap: {} }) }));
vi.mock("@/hooks/use-page-filters", () => ({ usePageFilters: () => ({}) }));
vi.mock("@/components/wiki/wiki-header-actions", () => ({ useSetWikiHeaderActions: () => () => {} }));
vi.mock("@/components/wiki/wiki-editor-toolbar", () => ({
  useWikiEditorRef: () => ({}),
  WikiEditorToolbar: () => null,
}));
vi.mock("@/components/wiki/wiki-logo", () => ({ WikiLogoControl: () => null }));
vi.mock("@/components/wiki/wiki-changes", () => ({ WikiChanges: () => null }));
vi.mock("@/components/wiki/wiki-file-actions", () => ({ WikiFileActions: () => null }));
vi.mock("@/services/wiki.service", () => ({
  WikiService: class {
    retrieve = retrieve;
    saveDescription = saveDescription;
  },
}));
vi.mock("@/components/editor/document/editor", () => ({
  DocumentEditor: (props: {
    id: string;
    value: string;
    onChange: (json: object, html: string, options: object) => void;
  }) => {
    editors.set(props.id, props);
    return <div data-testid="editor">{props.value}</div>;
  },
}));

const file = (id: string) => ({
  id,
  name: id,
  description_html: id,
  can_edit_body: true,
  view_props: {},
  is_creator: true,
});

it("isolates pending edits, late loads and stale editor callbacks when switching files", async () => {
  let resolveB!: (value: object) => void;
  retrieve.mockImplementation((_workspace, id) =>
    id === "B"
      ? new Promise((resolve) => {
          resolveB = resolve;
        })
      : Promise.resolve(file(id))
  );
  saveDescription.mockImplementation((_workspace, id, data) =>
    Promise.resolve({ ...file(id), description_html: data.description_html })
  );
  const onChanged = vi.fn(async () => {});
  const { rerender } = render(<WikiDocument workspaceSlug="team" nodeId="A" onChanged={onChanged} />);
  await screen.findByTestId("editor");
  const stale = editors.get("A")!;
  act(() => stale.onChange({}, "Edited A", {}));
  rerender(<WikiDocument workspaceSlug="team" nodeId="B" onChanged={onChanged} />);
  expect(screen.queryByTestId("editor")).toBeNull();
  await waitFor(() =>
    expect(saveDescription).toHaveBeenCalledWith(
      "team",
      "A",
      expect.objectContaining({
        description_html: "Edited A",
        base_html: "A",
      })
    )
  );
  rerender(<WikiDocument workspaceSlug="team" nodeId="C" onChanged={onChanged} />);
  await screen.findByTestId("editor");
  await act(async () => resolveB(file("B")));
  expect(screen.getByTestId("editor").textContent).toBe("C");
  act(() => stale.onChange({}, "Late A", {}));
  expect(saveDescription).toHaveBeenCalledTimes(1);
  expect(editors.has("B")).toBe(false);
});
