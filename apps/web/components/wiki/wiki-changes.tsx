/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@plane/i18n";
import type { JSONContent } from "@plane/types";
import { DocumentEditor } from "@/components/editor/document/editor";
import { useWorkspace } from "@/hooks/store/use-workspace";
import type { TWikiChange, TWikiNode } from "@/services/wiki.service";
import { WikiService } from "@/services/wiki.service";
import { WorkspaceService } from "@/services/workspace.service";

const wikiService = new WikiService();
const workspaceService = new WorkspaceService();
const OPEN_STATUSES = new Set(["draft", "in_review", "changes_requested", "conflict"]);

const editorValue = (json?: object, html?: string): JSONContent | string =>
  json && Object.keys(json).length > 0 ? (json as JSONContent) : html || "";

type Props = {
  workspaceSlug: string;
  node: TWikiNode;
  onMerged: () => Promise<void>;
};

export function WikiChanges({ workspaceSlug, node, onMerged }: Props) {
  const { t } = useTranslation();
  const { getWorkspaceBySlug } = useWorkspace();
  const workspaceId = getWorkspaceBySlug(workspaceSlug)?.id ?? "";
  const [changes, setChanges] = useState<TWikiChange[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");
  const saveTimer = useRef<number | null>(null);
  const canStart = node.access === "editable" && !node.is_creator && !node.is_locked && !node.archived_at;

  const load = async () => {
    const items = await wikiService.listChanges(workspaceSlug, node.id);
    setChanges(items);
    return items;
  };

  useEffect(() => {
    let cancelled = false;
    void wikiService.listChanges(workspaceSlug, node.id).then((items) => {
      if (!cancelled) setChanges(items);
      return undefined;
    });
    return () => {
      cancelled = true;
    };
  }, [node.id, workspaceSlug]);

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    [node.id]
  );

  const openChanges = changes.filter((change) => OPEN_STATUSES.has(change.status));
  const active = openChanges.find((change) => change.id === selectedId) ?? openChanges[0];

  const run = async (action: () => Promise<void>) => {
    setMessage("");
    try {
      await action();
      await load();
    } catch (error) {
      const code = error && typeof error === "object" && "error" in error ? String(error.error) : "";
      setMessage(code === "conflict" ? t("workspace_wiki.change_conflict") : t("workspace_wiki.forbidden"));
    }
  };

  if (!node.is_creator && openChanges.length === 0 && !canStart) return null;
  if (node.is_creator && openChanges.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-subtle p-3">
      <p className="text-caption-sm-medium">{t("workspace_wiki.change_request")}</p>
      {node.is_creator ? (
        <div className="flex flex-wrap gap-2">
          {openChanges.map((change) => (
            <button
              key={change.id}
              type="button"
              className="text-caption-sm-medium"
              onClick={() => setSelectedId(change.id)}
            >
              {change.author_name} · {t(`workspace_wiki.change_status.${change.status}`)}
            </button>
          ))}
        </div>
      ) : (
        openChanges.length === 0 && (
          <button
            type="button"
            className="w-fit text-caption-sm-medium"
            onClick={() => void run(() => wikiService.openChange(workspaceSlug, node.id).then(() => undefined))}
          >
            {t("workspace_wiki.start_change")}
          </button>
        )
      )}
      {active && (
        <>
          <p className="text-body-sm-regular text-tertiary">
            {t(`workspace_wiki.change_status.${active.status}`)}
            {active.review_comment ? ` — ${active.review_comment}` : ""}
          </p>
          <p className="text-caption-sm-medium text-tertiary">{t("workspace_wiki.published_unchanged")}</p>
          <div className="flex flex-wrap gap-2">
            {active.can_submit && (
              <button
                type="button"
                className="text-caption-sm-medium"
                onClick={() =>
                  void run(() =>
                    wikiService.actOnChange(workspaceSlug, node.id, active.id, "submit").then(() => undefined)
                  )
                }
              >
                {t("workspace_wiki.submit_change")}
              </button>
            )}
            {active.can_withdraw && (
              <button
                type="button"
                className="text-caption-sm-medium"
                onClick={() =>
                  void run(() =>
                    wikiService.actOnChange(workspaceSlug, node.id, active.id, "withdraw").then(() => undefined)
                  )
                }
              >
                {t("workspace_wiki.withdraw_change")}
              </button>
            )}
            {active.can_close && (
              <button
                type="button"
                className="text-caption-sm-medium"
                onClick={() =>
                  void run(() =>
                    wikiService.actOnChange(workspaceSlug, node.id, active.id, "close").then(() => undefined)
                  )
                }
              >
                {t("workspace_wiki.close_change")}
              </button>
            )}
            {active.can_merge && (
              <button
                type="button"
                className="text-caption-sm-medium"
                onClick={() =>
                  void run(async () => {
                    await wikiService.actOnChange(workspaceSlug, node.id, active.id, "merge");
                    await onMerged();
                  })
                }
              >
                {t("workspace_wiki.merge_change")}
              </button>
            )}
          </div>
          {active.can_return && (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!comment.trim()) return;
                void run(() =>
                  wikiService
                    .actOnChange(workspaceSlug, node.id, active.id, "return", comment.trim())
                    .then(() => undefined)
                );
                setComment("");
              }}
            >
              <input
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder={t("workspace_wiki.change_comment")}
                className="h-8 min-w-48 rounded-md border border-subtle bg-layer-1 px-2 text-body-sm-regular"
              />
              <button type="submit" className="text-caption-sm-medium">
                {t("workspace_wiki.return_change")}
              </button>
            </form>
          )}
          <div className="min-h-40">
            {active.can_edit ? (
              <DocumentEditor
                key={`${active.id}-edit`}
                editable
                id={active.id}
                value={editorValue(active.description_json, active.description_html)}
                workspaceId={workspaceId}
                workspaceSlug={workspaceSlug}
                displayConfig={{ wideLayout: Boolean(node.view_props?.full_width) }}
                searchMentionCallback={async (payload) => workspaceService.searchEntity(workspaceSlug, payload)}
                uploadFile={async () => ""}
                duplicateFile={async () => ""}
                onChange={(description, html) => {
                  if (saveTimer.current) window.clearTimeout(saveTimer.current);
                  saveTimer.current = window.setTimeout(() => {
                    void wikiService
                      .saveChange(workspaceSlug, node.id, active.id, {
                        description_html: html || "<p></p>",
                        description_json: description,
                      })
                      .then(() => setMessage(t("workspace_wiki.change_saved")))
                      .catch(() => setMessage(t("workspace_wiki.forbidden")));
                  }, 700);
                }}
              />
            ) : (
              <DocumentEditor
                key={`${active.id}-read`}
                editable={false}
                id={active.id}
                value={editorValue(active.description_json, active.description_html)}
                workspaceId={workspaceId}
                workspaceSlug={workspaceSlug}
                displayConfig={{ wideLayout: Boolean(node.view_props?.full_width) }}
              />
            )}
          </div>
        </>
      )}
      {message && <p className="text-caption-sm-medium text-tertiary">{message}</p>}
    </div>
  );
}
