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
import type { TWikiChange, TWikiMergePlan, TWikiNode } from "@/services/wiki.service";
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
  publishedHtml: string;
  onMerged: () => Promise<void>;
};

function composedDocument(
  plan: TWikiMergePlan,
  choices: Record<string, "current" | "draft" | "custom">,
  customText: Record<string, string>
) {
  const content = plan.blocks.flatMap((entry) => {
    if (!entry.conflict) return entry.block ? [entry.block] : [];
    if (choices[entry.id] === "current") return entry.current ? [entry.current] : [];
    if (choices[entry.id] === "draft") return entry.draft ? [entry.draft] : [];
    if (choices[entry.id] === "custom") {
      const text = customText[entry.id] || "";
      return [
        {
          type: "paragraph",
          attrs: { id: entry.id },
          content: text ? [{ type: "text", text }] : [],
        },
      ];
    }
    return entry.current ? [entry.current] : [];
  });
  return { type: "doc", content };
}

function WikiConflictResolve({
  workspaceId,
  workspaceSlug,
  plan,
  onConfirm,
}: {
  workspaceId: string;
  workspaceSlug: string;
  plan: TWikiMergePlan;
  onConfirm: (payload: {
    resolutions: { id: string; choice: "current" | "draft" | "custom"; block?: object }[];
    description_html?: string;
    description_json?: object;
  }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [choices, setChoices] = useState<Record<string, "current" | "draft" | "custom">>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});
  const latest = useRef<{ json: object; html: string } | null>(null);
  const document = composedDocument(plan, choices, customText);
  const ready = plan.conflicts.every((conflict) => choices[conflict.id]);
  const choiceKey = plan.conflicts
    .map((conflict) => `${conflict.id}:${choices[conflict.id] || ""}:${customText[conflict.id] || ""}`)
    .join("|");

  useEffect(() => {
    latest.current = null;
  }, [choiceKey]);

  return (
    <div className="flex flex-col gap-3">
      {plan.conflicts.map((conflict) => (
        <div key={conflict.id} className="grid gap-2 md:grid-cols-3">
          <div className="rounded-md border border-subtle p-2">
            <p className="text-caption-sm-medium text-tertiary">{t("workspace_wiki.conflict_baseline")}</p>
            <p className="text-body-sm-regular">{conflict.baseline_text || t("workspace_wiki.conflict_empty")}</p>
          </div>
          <div className="rounded-md border border-subtle p-2">
            <p className="text-caption-sm-medium text-tertiary">{t("workspace_wiki.conflict_current")}</p>
            <p className="text-body-sm-regular">{conflict.current_text || t("workspace_wiki.conflict_empty")}</p>
          </div>
          <div className="rounded-md border border-subtle p-2">
            <p className="text-caption-sm-medium text-tertiary">{t("workspace_wiki.conflict_submitted")}</p>
            <p className="text-body-sm-regular">{conflict.draft_text || t("workspace_wiki.conflict_empty")}</p>
          </div>
          <div className="flex flex-wrap gap-2 md:col-span-3">
            <button
              type="button"
              className="text-caption-sm-medium"
              onClick={() => setChoices({ ...choices, [conflict.id]: "current" })}
            >
              {t("workspace_wiki.keep_current")}
            </button>
            <button
              type="button"
              className="text-caption-sm-medium"
              onClick={() => setChoices({ ...choices, [conflict.id]: "draft" })}
            >
              {t("workspace_wiki.take_submitted")}
            </button>
            <button
              type="button"
              className="text-caption-sm-medium"
              onClick={() => setChoices({ ...choices, [conflict.id]: "custom" })}
            >
              {t("workspace_wiki.edit_block")}
            </button>
            {choices[conflict.id] === "custom" && (
              <input
                value={customText[conflict.id] || ""}
                onChange={(event) => setCustomText({ ...customText, [conflict.id]: event.target.value })}
                className="h-8 min-w-48 rounded-md border border-subtle bg-layer-1 px-2 text-body-sm-regular"
              />
            )}
          </div>
        </div>
      ))}
      <DocumentEditor
        key={choiceKey}
        editable
        id={`merge-${choiceKey}`}
        value={document}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        uploadFile={async () => ""}
        duplicateFile={async () => ""}
        searchMentionCallback={async () => ({})}
        onChange={(description, html) => {
          latest.current = { json: description, html: html || "<p></p>" };
        }}
      />
      <button
        type="button"
        className="w-fit text-caption-sm-medium"
        disabled={!ready}
        onClick={() => {
          if (!ready) return;
          const result = latest.current;
          void onConfirm({
            resolutions: plan.conflicts.map((conflict) => ({
              id: conflict.id,
              choice: choices[conflict.id],
              block:
                choices[conflict.id] === "custom"
                  ? {
                      type: "paragraph",
                      attrs: { id: conflict.id },
                      content: customText[conflict.id] ? [{ type: "text", text: customText[conflict.id] }] : [],
                    }
                  : undefined,
            })),
            ...(result ? { description_json: result.json, description_html: result.html } : {}),
          });
        }}
      >
        {t("workspace_wiki.confirm_merge")}
      </button>
    </div>
  );
}

export function WikiChanges({ workspaceSlug, node, publishedHtml, onMerged }: Props) {
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
  }, [node.id, publishedHtml, workspaceSlug]);

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
            {active.can_merge && !active.merge_plan?.conflicts.length && (
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
                    .actOnChange(workspaceSlug, node.id, active.id, "return", { comment: comment.trim() })
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
          {active.can_merge && active.merge_plan && active.merge_plan.conflicts.length > 0 && (
            <WikiConflictResolve
              workspaceId={workspaceId}
              workspaceSlug={workspaceSlug}
              plan={active.merge_plan}
              onConfirm={(payload) =>
                run(async () => {
                  await wikiService.actOnChange(workspaceSlug, node.id, active.id, "merge", payload);
                  await onMerged();
                })
              }
            />
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
