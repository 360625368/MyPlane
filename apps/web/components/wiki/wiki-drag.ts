import type { TWikiNode } from "@/services/wiki.service";

export type WikiDropPosition = "before" | "inside" | "after";

export function wikiDropUpdate(
  source: TWikiNode,
  target: TWikiNode,
  position: WikiDropPosition,
  nodes: TWikiNode[]
): { parent_id: string; sort_order: number; relative_to?: string; position?: "before" | "after" } | null {
  if (!source.can_move || source.is_root || source.archived_at || source.id === target.id) return null;
  const parentId = position === "inside" ? target.id : target.parent_id;
  const parent = position === "inside" ? target : nodes.find((node) => node.id === parentId);
  if (!parent || parent.node_type !== "folder" || !parent.can_create_child || parent.archived_at) return null;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  for (let ancestor: TWikiNode | undefined = parent; ancestor; ancestor = byId.get(ancestor.parent_id ?? "")) {
    if (ancestor.id === source.id || visited.has(ancestor.id)) return null;
    visited.add(ancestor.id);
  }
  // The filtered array is new; ES2022 targets do not include toSorted.
  const siblings = nodes
    .filter((node) => node.parent_id === parent.id && node.id !== source.id)
    // oxlint-disable-next-line unicorn/no-array-sort
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
  if (position === "inside") {
    return { parent_id: parent.id, sort_order: (siblings.at(-1)?.sort_order ?? 0) + 65535 };
  }
  const index = siblings.findIndex((node) => node.id === target.id);
  if (index < 0) return null;
  const previous = position === "before" ? siblings[index - 1] : target;
  const next = position === "before" ? target : siblings[index + 1];
  const sortOrder =
    previous && next
      ? (previous.sort_order + next.sort_order) / 2
      : previous
        ? previous.sort_order + 65535
        : next!.sort_order - 65535;
  return { parent_id: parent.id, sort_order: sortOrder, relative_to: target.id, position };
}
