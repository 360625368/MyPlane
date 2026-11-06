/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import {
  ArchiveOutline,
  CopyOutline,
  HistoryOutline,
  LinkOutline,
  LockedOutline,
  MoreHorizontalOutline,
  RestoreOutline,
  StarFilled,
  StarOutline,
  TickOutline,
  UnlockedOutline,
} from "@makeplane/propel/icons";
import { Badge } from "@makeplane/propel/components/badge";
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import { Switch } from "@makeplane/propel/components/switch";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { useTranslation } from "@plane/i18n";
import { renderFormattedDate } from "@plane/utils";
import type { TWikiNode } from "@/services/wiki.service";

type LockDisplayState = "neutral" | "locked" | "unlocked";

const hexColor = (value: string) => (/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000");

type Props = {
  node: TWikiNode;
  favorite: boolean;
  onLock: () => void;
  onArchive: () => void;
  onFavorite: () => void;
  onDuplicate: () => void;
  onVersions: () => void;
  onWide: (wide: boolean) => void;
  onColor: (color: string) => void;
  onSort: (direction: -1 | 1) => void;
};

export function WikiFileActions(props: Props) {
  const { node, favorite, onLock, onArchive, onFavorite, onDuplicate, onVersions, onWide, onColor, onSort } = props;
  const { t } = useTranslation();
  const [displayState, setDisplayState] = useState<LockDisplayState>(node.is_locked ? "locked" : "neutral");
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousLockedRef = useRef(node.is_locked);
  const wide = Boolean(node.view_props?.full_width);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (node.is_locked) setDisplayState("locked");
    else if (previousLockedRef.current) {
      setDisplayState("unlocked");
      timerRef.current = setTimeout(() => {
        setDisplayState("neutral");
        timerRef.current = null;
      }, 600);
    } else setDisplayState("neutral");
    previousLockedRef.current = node.is_locked;
  }, [node.is_locked]);

  const copyLink = () => {
    void navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => {
        setCopied(false);
        copiedTimerRef.current = null;
      }, 1000);
      return undefined;
    });
  };

  return (
    <div className="flex items-center gap-1">
      {node.archived_at && (
        <Badge
          variant="brand"
          size="sm"
          startIcon={<Icon icon={ArchiveOutline} />}
          label={`${t("wiki_collections.predefined.archived")} · ${renderFormattedDate(node.archived_at) ?? ""}`}
        />
      )}
      {node.is_creator && displayState === "neutral" && (
        <Tooltip label={t("workspace_wiki.lock")} side="bottom">
          <IconButton
            type="button"
            variant="ghost"
            size="md"
            showTooltip={false}
            aria-label={t("workspace_wiki.lock")}
            icon={<Icon icon={LockedOutline} />}
            onClick={onLock}
          />
        </Tooltip>
      )}
      {node.is_creator && displayState === "locked" && (
        <Tooltip label={t("workspace_wiki.unlock")} side="bottom">
          <Button
            variant="secondary"
            size="md"
            stretch="auto"
            icon={<Icon icon={LockedOutline} />}
            label={t("common.locked")}
            onClick={onLock}
          />
        </Tooltip>
      )}
      {node.is_creator && displayState === "unlocked" && (
        <Button
          variant="ghost"
          size="md"
          stretch="auto"
          disabled
          icon={<Icon icon={UnlockedOutline} />}
          label={t("workspace_wiki.unlock")}
        />
      )}
      <Tooltip label={copied ? t("common.copied") : t("copy_link")} side="bottom">
        <IconButton
          type="button"
          variant="ghost"
          size="md"
          showTooltip={false}
          aria-label={copied ? t("common.copied") : t("copy_link")}
          icon={copied ? <Icon icon={<TickOutline className="text-success-primary" />} /> : <Icon icon={LinkOutline} />}
          onClick={copyLink}
        />
      </Tooltip>
      <IconButton
        type="button"
        variant="ghost"
        size="md"
        aria-label={favorite ? t("workspace_wiki.unfavorite") : t("workspace_wiki.favorite")}
        icon={<Icon icon={favorite ? <StarFilled className="text-label-yellow-icon-strong" /> : <StarOutline />} />}
        onClick={onFavorite}
      />
      <Menu>
        <MenuTrigger
          render={
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("aria_labels.common.more_actions")}
              icon={<Icon icon={MoreHorizontalOutline} />}
            />
          }
        />
        <MenuContent side="bottom" align="end">
          {node.is_creator && (
            <MenuItem
              label={t("workspace_wiki.wide")}
              closeOnClick={false}
              trailing={
                <span className="pointer-events-none">
                  <Switch size="sm" checked={wide} aria-hidden tabIndex={-1} />
                </span>
              }
              onClick={() => onWide(!wide)}
            />
          )}
          {node.is_creator && node.can_edit_body && (
            <MenuItem
              label={t("workspace_wiki.color")}
              closeOnClick={false}
              trailing={
                <input
                  type="color"
                  aria-label={t("workspace_wiki.color")}
                  value={hexColor(node.color)}
                  className="size-5 cursor-pointer border-0 bg-transparent p-0"
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onColor(event.target.value)}
                />
              }
            />
          )}
          <MenuItem label={t("workspace_wiki.versions")} icon={<Icon icon={HistoryOutline} />} onClick={onVersions} />
          <MenuItem label={t("workspace_wiki.duplicate")} icon={<Icon icon={CopyOutline} />} onClick={onDuplicate} />
          {node.is_creator && (
            <MenuItem
              label={node.archived_at ? t("workspace_wiki.unarchive") : t("workspace_wiki.archive")}
              icon={<Icon icon={node.archived_at ? RestoreOutline : ArchiveOutline} />}
              onClick={onArchive}
            />
          )}
          {node.can_rename && <MenuItem label={t("workspace_wiki.sort_up")} onClick={() => onSort(-1)} />}
          {node.can_rename && <MenuItem label={t("workspace_wiki.sort_down")} onClick={() => onSort(1)} />}
        </MenuContent>
      </Menu>
    </div>
  );
}
