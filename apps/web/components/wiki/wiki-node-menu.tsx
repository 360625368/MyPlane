/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { DeleteOutline, MoreHorizontalOutline } from "@makeplane/propel/icons";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSubmenu,
  MenuSubmenuContent,
  MenuSubmenuTrigger,
  MenuTrigger,
} from "@makeplane/propel/components/menu";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
import type { TWikiNode } from "@/services/wiki.service";

type Props = {
  node: TWikiNode;
  destinations: { id: string; name: string }[];
  revealed: boolean;
  hoverGroup: "list-item" | "wiki-node";
  onMove: (parentId: string) => void;
  onSort: (direction: -1 | 1) => void;
  onPermissions: () => void;
  onDelete: () => void;
};

export function WikiNodeMenu(props: Props) {
  const { node, destinations, revealed, hoverGroup, onMove, onSort, onPermissions, onDelete } = props;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const canMove = node.can_move && destinations.length > 0;
  const canSort = node.can_rename;
  const canPermissions = node.can_manage_access;
  const canDelete = node.can_delete;
  if (!canMove && !canSort && !canPermissions && !canDelete) return null;

  return (
    <div
      className={cn(
        "pointer-events-none relative z-10 w-fit shrink-0 opacity-0 group-focus-within/wiki-node:pointer-events-auto group-focus-within/wiki-node:opacity-100 group-hover/wiki-node:pointer-events-auto group-hover/wiki-node:opacity-100",
        hoverGroup === "list-item" &&
          "group-focus-within/list-item:pointer-events-auto group-focus-within/list-item:opacity-100 group-hover/list-item:pointer-events-auto group-hover/list-item:opacity-100",
        (open || revealed) && "pointer-events-auto opacity-100"
      )}
    >
      <Menu onOpenChange={setOpen}>
        <MenuTrigger
          render={
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t("aria_labels.common.more_actions")}
              icon={<Icon icon={MoreHorizontalOutline} />}
              render={<button type="button" className="text-placeholder" />}
            />
          }
        />
        <MenuContent side="bottom" align="end">
          {canMove && (
            <MenuSubmenu>
              <MenuSubmenuTrigger label={t("workspace_wiki.move")} />
              <MenuSubmenuContent>
                {destinations.map((destination) => (
                  <MenuItem key={destination.id} label={destination.name} onClick={() => onMove(destination.id)} />
                ))}
              </MenuSubmenuContent>
            </MenuSubmenu>
          )}
          {canSort && <MenuItem label={t("workspace_wiki.sort_up")} onClick={() => onSort(-1)} />}
          {canSort && <MenuItem label={t("workspace_wiki.sort_down")} onClick={() => onSort(1)} />}
          {canPermissions && <MenuItem label={t("workspace_wiki.permissions")} onClick={onPermissions} />}
          {canDelete && (
            <MenuItem
              variant="danger"
              label={t("workspace_wiki.delete")}
              icon={<Icon icon={DeleteOutline} />}
              onClick={onDelete}
            />
          )}
        </MenuContent>
      </Menu>
    </div>
  );
}
