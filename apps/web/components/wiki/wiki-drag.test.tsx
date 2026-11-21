import { expect, it } from "vitest";
import type { TWikiNode } from "@/services/wiki.service";
import { wikiDropUpdate } from "./wiki-drag";

const node = (id: string, parent: string | null, order: number, folder = false) =>
  ({
    id,
    parent_id: parent,
    sort_order: order,
    name: id,
    node_type: folder ? "folder" : "file",
    can_move: true,
    can_create_child: folder,
  }) as TWikiNode;

it("moves files into folders and before or after sibling nodes", () => {
  const root = node("root", null, 0, true);
  const folder = node("folder", "root", 10, true);
  const a = node("a", "root", 20);
  const b = node("b", "root", 30);
  const nodes = [root, folder, a, b];
  expect(wikiDropUpdate(b, folder, "inside", nodes)?.parent_id).toBe("folder");
  expect(wikiDropUpdate(b, a, "before", nodes)?.sort_order).toBe(15);
  expect(wikiDropUpdate(folder, a, "after", nodes)?.sort_order).toBe(25);
});

it("rejects cycles, hidden destinations, self drops and files as parents", () => {
  const root = node("root", null, 0, true);
  const folder = node("folder", "root", 10, true);
  const child = node("child", "folder", 20, true);
  const file = node("file", "root", 30);
  const nodes = [root, folder, child, file];
  expect(wikiDropUpdate(folder, child, "inside", nodes)).toBeNull();
  expect(wikiDropUpdate(file, file, "before", nodes)).toBeNull();
  expect(wikiDropUpdate(folder, file, "inside", nodes)).toBeNull();
  expect(wikiDropUpdate(file, { ...child, can_create_child: false }, "inside", nodes)).toBeNull();
  expect(wikiDropUpdate({ ...file, can_move: false }, folder, "inside", nodes)).toBeNull();
});

it("accepts a file inside a nested folder", () => {
  const root = node("root", null, 0, true);
  const parent = node("parent", "root", 10, true);
  const nested = node("nested", "parent", 20, true);
  const file = node("file", "root", 30);
  expect(wikiDropUpdate(file, nested, "inside", [root, parent, nested, file])?.parent_id).toBe("nested");
});
