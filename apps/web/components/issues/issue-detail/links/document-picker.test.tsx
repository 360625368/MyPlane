import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DocumentLinkPicker } from "./document-picker";

const { list, fetchAll } = vi.hoisted(() => ({ list: vi.fn(), fetchAll: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "team", projectId: "project" }) }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({ workspaceProjectIds: ["project"], getProjectById: () => ({ name: "Project" }) }),
}));
vi.mock("@/services/wiki.service", () => ({
  WikiService: class {
    list = list;
  },
}));
vi.mock("@/services/page/project-page.service", () => ({
  ProjectPageService: class {
    fetchAll = fetchAll;
  },
}));

it("selects a Wiki file with its title and URL while excluding folders and archived files", async () => {
  list.mockResolvedValue([
    { id: "folder", name: "Folder", node_type: "folder" },
    { id: "file", name: "Architecture", node_type: "file" },
    { id: "old", name: "Archived", node_type: "file", archived_at: "2026-01-01" },
  ]);
  const select = vi.fn();
  render(<DocumentLinkPicker kind="wiki" onSelect={select} />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Architecture" }));
  expect(select).toHaveBeenCalledWith("Architecture", new URL("/team/wiki/file", window.location.origin).href);
  expect(screen.queryByText("Folder")).toBeNull();
  expect(screen.queryByText("Archived")).toBeNull();
});

it("selects a project Page using the project-specific URL", async () => {
  fetchAll.mockResolvedValue([{ id: "page", name: "Specification" }]);
  const select = vi.fn();
  render(<DocumentLinkPicker kind="page" onSelect={select} />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Specification" }));
  expect(fetchAll).toHaveBeenCalledWith("team", "project");
  expect(select).toHaveBeenCalledWith(
    "Specification",
    new URL("/team/projects/project/pages/page", window.location.origin).href
  );
});
