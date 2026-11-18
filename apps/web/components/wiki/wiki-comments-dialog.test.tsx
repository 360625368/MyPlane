/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { TWikiComment } from "@/services/wiki.service";
import { WikiCommentsDialog } from "./wiki-comments-dialog";

const { listComments, editComment, addComment } = vi.hoisted(() => ({
  listComments: vi.fn(),
  editComment: vi.fn(),
  addComment: vi.fn(),
}));

vi.mock("@/services/wiki.service", () => ({
  WikiService: class {
    listComments = listComments;
    editComment = editComment;
    addComment = addComment;
  },
}));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it("allows replies and shows the edited label after saving a comment", async () => {
  const own: TWikiComment = {
    id: "own",
    parent_id: null,
    author_name: "Alice",
    body: "Original",
    created_at: "2026-01-01T00:00:00Z",
    edited_at: null,
    deleted: false,
    can_edit: true,
    can_delete: true,
  };
  const other = { ...own, id: "other", body: "Other comment", can_edit: false };
  listComments.mockResolvedValue({ page: 1, total_pages: 1, results: [own, other] });
  editComment.mockResolvedValue({ ...own, body: "Updated", edited_at: "2026-01-02T00:00:00Z" });
  addComment.mockResolvedValue({ ...own, id: "reply", parent_id: "other", body: "A reply" });

  render(<WikiCommentsDialog workspaceSlug="team" nodeId="file" nodeName="Notes" targetId={null} onClose={vi.fn()} />);
  const user = userEvent.setup();
  const [ownRow, otherRow] = await screen.findAllByRole("article");
  expect(within(otherRow).queryByRole("button", { name: "workspace_wiki.comments.edit" })).toBeNull();
  expect(within(otherRow).getByRole("button", { name: "workspace_wiki.delete" })).not.toBeNull();

  await user.click(within(ownRow).getByRole("button", { name: "workspace_wiki.comments.edit" }));
  await user.clear(screen.getByRole("textbox"));
  await user.type(screen.getByRole("textbox"), "Updated");
  await user.click(screen.getByRole("button", { name: "workspace_wiki.comments.save" }));
  expect(editComment).toHaveBeenCalledWith("team", "file", "own", "Updated");
  expect(await within(ownRow).findByText("workspace_wiki.comments.edited")).not.toBeNull();

  await user.click(within(otherRow).getByRole("button", { name: "workspace_wiki.comments.reply" }));
  await user.type(screen.getByRole("textbox"), "A reply");
  await user.click(screen.getByRole("button", { name: "workspace_wiki.comments.send" }));
  expect(addComment).toHaveBeenCalledWith("team", "file", "A reply", "other");
  expect(await screen.findByText("A reply")).not.toBeNull();
});

it("keeps replies to replies at the same level and names the actual recipient", async () => {
  const root: TWikiComment = {
    id: "root",
    parent_id: null,
    author_name: "Alice",
    body: "Root comment",
    created_at: "2026-01-01T00:00:00Z",
    edited_at: null,
    deleted: false,
    can_edit: false,
    can_delete: false,
  };
  const reply = { ...root, id: "reply", parent_id: root.id, author_name: "Bob", body: "First reply" };
  const sibling = { ...reply, id: "sibling", body: "Another reply" };
  const nested = { ...reply, id: "nested", parent_id: reply.id, author_name: "Carol", body: "Reply to Bob" };
  listComments.mockResolvedValue({ page: 1, total_pages: 1, results: [root, reply, sibling] });
  addComment.mockResolvedValue(nested);

  render(<WikiCommentsDialog workspaceSlug="team" nodeId="file" nodeName="Notes" targetId={null} onClose={vi.fn()} />);
  const user = userEvent.setup();
  expect(await screen.findAllByRole("article")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "workspace_wiki.comments.show_replies" }));
  const [rootRow, replyRow, siblingRow] = await screen.findAllByRole("article");
  expect(within(replyRow).queryByText("→ Alice")).toBeNull();

  await user.click(within(replyRow).getByRole("button", { name: "workspace_wiki.comments.reply" }));
  await user.type(screen.getByRole("textbox"), "Reply to Bob");
  await user.click(screen.getByRole("button", { name: "workspace_wiki.comments.send" }));

  const nestedRow = (await screen.findByText("Reply to Bob")).closest("article");
  expect(addComment).toHaveBeenLastCalledWith("team", "file", "Reply to Bob", reply.id);
  expect(nestedRow?.parentElement).toBe(replyRow.parentElement);
  expect(await screen.findAllByRole("article")).toEqual([rootRow, replyRow, siblingRow, nestedRow]);
  expect(screen.getByText("→ Bob")).not.toBeNull();
  await user.click(screen.getByRole("button", { name: "workspace_wiki.comments.hide_replies" }));
  expect(screen.getAllByRole("article")).toEqual([rootRow]);
});

it("opens the notified reply on its page and loads the previous page on demand", async () => {
  const first: TWikiComment = {
    id: "first",
    parent_id: null,
    author_name: "Alice",
    body: "First page",
    created_at: "2026-01-01T00:00:00Z",
    edited_at: null,
    deleted: false,
    can_edit: false,
    can_delete: false,
  };
  const second = { ...first, id: "second", body: "Second page" };
  const reply = { ...first, id: "target", parent_id: second.id, body: "Notified reply" };
  listComments.mockImplementation(async (_workspace, _file, _page, focus) =>
    focus ? { page: 2, total_pages: 2, results: [second, reply] } : { page: 1, total_pages: 2, results: [first] }
  );

  render(
    <WikiCommentsDialog workspaceSlug="team" nodeId="file" nodeName="Notes" targetId="target" onClose={vi.fn()} />
  );
  expect(await screen.findByText("Notified reply")).not.toBeNull();
  expect(screen.getByText("2 / 2")).not.toBeNull();
  expect(listComments).toHaveBeenLastCalledWith("team", "file", 1, "target");

  await userEvent.setup().click(screen.getByRole("button", { name: "workspace_wiki.page_previous" }));
  expect(await screen.findByText("First page")).not.toBeNull();
  expect(screen.queryByText("Notified reply")).toBeNull();
  expect(listComments).toHaveBeenLastCalledWith("team", "file", 1, null);
});
