/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@makeplane/propel/components/button";
import { useTranslation } from "@plane/i18n";
import type { JSONContent } from "@plane/types";
import type { EditorRefApi } from "@plane/editor";
import { DocumentEditor } from "@/components/editor/document/editor";
import { useWikiEditorRef } from "@/components/wiki/wiki-editor-toolbar";
import { usePageFilters } from "@/hooks/use-page-filters";
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
  onBeforeMerge?: () => Promise<void>;
  onMerged: () => Promise<void>;
  onMergeSettled?: () => void;
  onActiveEditor?: (editor: EditorRefApi | null) => void;
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
            <Button
              variant={choices[conflict.id] === "current" ? "primary" : "secondary"}
              size="sm"
              stretch="auto"
              label={t("workspace_wiki.keep_current")}
              onClick={() => setChoices({ ...choices, [conflict.id]: "current" })}
            />
            <Button
              variant={choices[conflict.id] === "draft" ? "primary" : "secondary"}
              size="sm"
              stretch="auto"
              label={t("workspace_wiki.take_submitted")}
              onClick={() => setChoices({ ...choices, [conflict.id]: "draft" })}
            />
            <Button
              variant={choices[conflict.id] === "custom" ? "primary" : "secondary"}
              size="sm"
              stretch="auto"
              label={t("workspace_wiki.edit_block")}
              onClick={() => setChoices({ ...choices, [conflict.id]: "custom" })}
            />
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
      <Button
        variant="primary"
        size="sm"
        stretch="auto"
        disabled={!ready}
        label={t("workspace_wiki.confirm_merge")}
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
      />
    </div>
  );
}

export function WikiChanges({
  workspaceSlug,
  node,
  publishedHtml,
  onBeforeMerge,
  onMerged,
  onMergeSettled,
  onActiveEditor,
}: Props) {
  const { t } = useTranslation();
  const draftEditor = useWikiEditorRef();
  const { fontSize, fontStyle } = usePageFilters();
  const { getWorkspaceBySlug } = useWorkspace();
  const workspaceId = getWorkspaceBySlug(workspaceSlug)?.id ?? "";
  const [changes, setChanges] = useState<TWikiChange[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");
  const saveTimer = useRef<number | null>(null);
  const pendingDraft = useRef<{ html: string; json: object } | null>(null);
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

  useEffect(() => {
    onActiveEditor?.(active?.can_edit ? draftEditor.editor : null);
    return () => onActiveEditor?.(null);
  }, [active?.can_edit, draftEditor.editor, onActiveEditor]);

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

  const flushDraft = async () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const pending = pendingDraft.current;
    if (!pending || !active?.can_edit) return;
    pendingDraft.current = null;
    await wikiService.saveChange(workspaceSlug, node.id, active.id, {
      description_html: pending.html,
      description_json: pending.json,
    });
  };

  const mergeChange = (payload?: Parameters<WikiService["actOnChange"]>[4]) => {
    if (!active) return;
    const changeId = active.id;
    void run(async () => {
      try {
        await onBeforeMerge?.();
        await wikiService.actOnChange(workspaceSlug, node.id, changeId, "merge", payload);
        await onMerged();
      } finally {
        onMergeSettled?.();
      }
    });
  };

  if (!node.is_creator && openChanges.length === 0 && !canStart) return null;
  if (node.is_creator && openChanges.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-subtle p-3">
      <p className="text-caption-sm-medium">{t("workspace_wiki.change_request")}</p>
      {node.is_creator ? (
        <div className="flex flex-wrap gap-2">
          {openChanges.map((change) => (
            <Button
              key={change.id}
              variant={active?.id === change.id ? "secondary" : "ghost"}
              size="sm"
              stretch="auto"
              label={`${change.author_name} · ${t(`workspace_wiki.change_status.${change.status}`)}`}
              onClick={() => setSelectedId(change.id)}
            />
          ))}
        </div>
      ) : (
        openChanges.length === 0 && (
          <Button
            variant="primary"
            size="sm"
            stretch="auto"
            label={t("workspace_wiki.start_change")}
            onClick={() => void run(() => wikiService.openChange(workspaceSlug, node.id).then(() => undefined))}
          />
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
              <Button
                variant="primary"
                size="sm"
                stretch="auto"
                label={t("workspace_wiki.submit_change")}
                onClick={() =>
                  void run(async () => {
                    await flushDraft();
                    await wikiService.actOnChange(workspaceSlug, node.id, active.id, "submit");
                  })
                }
              />
            )}
            {active.can_withdraw && (
              <Button
                variant="secondary"
                size="sm"
                stretch="auto"
                label={t("workspace_wiki.withdraw_change")}
                onClick={() =>
                  void run(() =>
                    wikiService.actOnChange(workspaceSlug, node.id, active.id, "withdraw").then(() => undefined)
                  )
                }
              />
            )}
            {active.can_close && (
              <Button
                variant="secondary"
                size="sm"
                stretch="auto"
                label={t("workspace_wiki.close_change")}
                onClick={() =>
                  void run(() =>
                    wikiService.actOnChange(workspaceSlug, node.id, active.id, "close").then(() => undefined)
                  )
                }
              />
            )}
            {active.can_merge && !active.merge_plan?.conflicts.length && (
              <Button
                variant="primary"
                size="sm"
                stretch="auto"
                label={t("workspace_wiki.merge_change")}
                onClick={() => mergeChange()}
              />
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
              <Button
                variant="secondary"
                size="sm"
                stretch="auto"
                type="submit"
                label={t("workspace_wiki.return_change")}
              />
            </form>
          )}
          {active.can_merge && active.merge_plan && active.merge_plan.conflicts.length > 0 && (
            <WikiConflictResolve
              workspaceId={workspaceId}
              workspaceSlug={workspaceSlug}
              plan={active.merge_plan}
              onConfirm={(payload) => mergeChange(payload)}
            />
          )}
          <div className="min-h-40">
            {active.can_edit ? (
              <DocumentEditor
                key={`${active.id}-edit`}
                ref={draftEditor.ref}
                handleEditorReady={draftEditor.handleEditorReady}
                editable
                id={active.id}
                value={editorValue(active.description_json, active.description_html)}
                workspaceId={workspaceId}
                workspaceSlug={workspaceSlug}
                displayConfig={{ fontSize, fontStyle, wideLayout: Boolean(node.view_props?.full_width) }}
                searchMentionCallback={async (payload) => workspaceService.searchEntity(workspaceSlug, payload)}
                uploadFile={async () => ""}
                duplicateFile={async () => ""}
                onChange={(description, html, options) => {
                  if (options?.isMigrationUpdate) return;
                  pendingDraft.current = { html: html || "<p></p>", json: description };
                  if (saveTimer.current) window.clearTimeout(saveTimer.current);
                  saveTimer.current = window.setTimeout(() => {
                    const pending = pendingDraft.current;
                    pendingDraft.current = null;
                    if (!pending) return;
                    void wikiService
                      .saveChange(workspaceSlug, node.id, active.id, {
                        description_html: pending.html,
                        description_json: pending.json,
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
                displayConfig={{ fontSize, fontStyle, wideLayout: Boolean(node.view_props?.full_width) }}
              />
            )}
          </div>
        </>
      )}
      {message && <p className="text-caption-sm-medium text-tertiary">{message}</p>}
    </div>
  );
}
