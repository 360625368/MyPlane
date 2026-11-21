import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { DragDropOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
import type { TWikiNode } from "@/services/wiki.service";
import { wikiDropUpdate } from "./wiki-drag";
import type { WikiDropPosition } from "./wiki-drag";

export function WikiDraggableRow({
  node,
  nodes,
  workspaceSlug,
  busy,
  onMove,
  children,
}: {
  node: TWikiNode;
  nodes: TWikiNode[];
  workspaceSlug: string;
  busy: boolean;
  onMove: (id: string, data: { parent_id: string; sort_order: number }) => Promise<void>;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<WikiDropPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    const element = row.current;
    const dragHandle = handle.current;
    if (!element) return;
    const positionAt = (y: number): WikiDropPosition => {
      if (node.is_root) return "inside";
      const rect = element.getBoundingClientRect();
      const fraction = (y - rect.top) / rect.height;
      if (node.node_type === "folder" && fraction > 0.25 && fraction < 0.75) return "inside";
      return fraction < 0.5 ? "before" : "after";
    };
    const sourceNode = (data: Record<string, unknown>) =>
      data.kind === "wiki-node" && data.workspace === workspaceSlug
        ? nodes.find((candidate) => candidate.id === data.id)
        : undefined;

    return combine(
      ...(dragHandle && node.can_move && !node.is_root && !node.archived_at
        ? [
            draggable({
              element,
              dragHandle,
              canDrag: () => !busy,
              getInitialData: () => ({ kind: "wiki-node", workspace: workspaceSlug, id: node.id }),
              onDragStart: () => setDragging(true),
              onDrop: () => setDragging(false),
            }),
          ]
        : []),
      dropTargetForElements({
        element,
        canDrop: ({ source, input }) => {
          const sourceItem = sourceNode(source.data);
          return !busy && !!sourceItem && !!wikiDropUpdate(sourceItem, node, positionAt(input.clientY), nodes);
        },
        onDrag: ({ location }) => setPosition(positionAt(location.current.input.clientY)),
        onDragEnter: ({ location }) => setPosition(positionAt(location.current.input.clientY)),
        onDragLeave: () => setPosition(null),
        onDrop: ({ source, location }) => {
          setPosition(null);
          const sourceItem = sourceNode(source.data);
          const update =
            sourceItem && wikiDropUpdate(sourceItem, node, positionAt(location.current.input.clientY), nodes);
          if (sourceItem && update) void onMove(sourceItem.id, update);
        },
      })
    );
  }, [node, nodes, workspaceSlug, busy, onMove]);

  return (
    <div
      ref={row}
      className={cn(
        "group/wiki-drag relative rounded-lg ps-4",
        dragging && "opacity-40",
        position === "inside" && "bg-layer-transparent-selected ring-1 ring-accent-strong"
      )}
    >
      {node.can_move && !node.is_root && !node.archived_at && (
        <span
          ref={handle}
          title={t("workspace_wiki.move")}
          className="absolute inset-y-0 start-0 flex w-4 cursor-grab items-center justify-center text-tertiary opacity-0 group-hover/wiki-drag:opacity-100 active:cursor-grabbing"
        >
          <DragDropOutline className="size-3" />
        </span>
      )}
      {position && position !== "inside" && (
        <span
          className={cn(
            "pointer-events-none absolute inset-x-0 h-0.5 bg-accent-primary",
            position === "before" ? "top-0" : "bottom-0"
          )}
        />
      )}
      {children}
    </div>
  );
}
