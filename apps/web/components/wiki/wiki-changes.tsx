/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { CloseOutline } from "@makeplane/propel/icons";
import { Button } from "@makeplane/propel/components/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogCloseGroup,
  DialogContent,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { useTranslation } from "@plane/i18n";
import type { JSONContent } from "@plane/types";
import type { EditorRefApi } from "@plane/editor";
import { DocumentEditor } from "@/components/editor/document/editor";
import { useWikiEditorRef, WikiEditorToolbar } from "@/components/wiki/wiki-editor-toolbar";
import { WikiReviewDialog } from "@/components/wiki/wiki-review-dialog";
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
  suggestOpen: boolean;
  onSuggestOpenChange: (open: boolean) => void;
  onOwnOpenChange: (change: TWikiChange | null) => void;
  reviewOpen: boolean;
  reviewRefresh: number;
  onReviewOpenChange: (open: boolean) => void;
  onReviewCount: (count: number) => void;
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
  suggestOpen,
  onSuggestOpenChange,
  onOwnOpenChange,
  reviewOpen,
  reviewRefresh,
  onReviewOpenChange,
  onReviewCount,
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
  const [seenNodeId, setSeenNodeId] = useState(node.id);
  const saveTimer = useRef<number | null>(null);
  const pendingDraft = useRef<{ html: string; json: object } | null>(null);
  if (seenNodeId !== node.id) {
    setSeenNodeId(node.id);
    setChanges([]);
    setSelectedId(null);
    setComment("");
    setMessage("");
    pendingDraft.current = null;
  }
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

  useEffect(() => {
    if (!reviewOpen || !node.is_creator || reviewRefresh === 0) return;
    let cancelled = false;
    void wikiService.listChanges(workspaceSlug, node.id).then((items) => {
      if (!cancelled) setChanges(items);
      return undefined;
    });
    return () => {
      cancelled = true;
    };
  }, [node.id, node.is_creator, reviewOpen, reviewRefresh, workspaceSlug]);

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    [node.id]
  );

  const openChanges = changes.filter((change) => OPEN_STATUSES.has(change.status));
  const active = openChanges.find((change) => change.id === selectedId) ?? openChanges[0];
  const ownOpen = node.is_creator ? null : (openChanges[0] ?? null);

  useEffect(() => {
    if (node.is_creator) onActiveEditor?.(active?.can_edit ? draftEditor.editor : null);
    else onActiveEditor?.(null);
    return () => onActiveEditor?.(null);
  }, [active?.can_edit, draftEditor.editor, node.is_creator, onActiveEditor]);

  useEffect(() => {
    onOwnOpenChange(ownOpen);
  }, [onOwnOpenChange, ownOpen]);

  useEffect(() => {
    onReviewCount(node.is_creator ? changes.length : 0);
  }, [changes.length, node.is_creator, onReviewCount]);

  useEffect(() => {
    if (!suggestOpen || node.is_creator) return;
    let cancelled = false;
    void wikiService
      .listChanges(workspaceSlug, node.id)
      .then(async (items) => {
        if (cancelled) return undefined;
        const open = items.filter((item) => OPEN_STATUSES.has(item.status));
        if (open.length > 0 || !canStart) {
          setChanges(items);
          return undefined;
        }
        const created = await wikiService.openChange(workspaceSlug, node.id);
        if (cancelled) return undefined;
        setChanges([created, ...items.filter((item) => item.id !== created.id)]);
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setMessage(t("workspace_wiki.forbidden"));
        return undefined;
      });
    return () => {
      cancelled = true;
    };
    // `t` is a new function every render; depending on it retriggers this effect forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canStart, node.id, node.is_creator, suggestOpen, workspaceSlug]);

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

  if (node.is_creator) {
    return (
      <WikiReviewDialog
        open={reviewOpen}
        changes={changes}
        workspaceSlug={workspaceSlug}
        workspaceId={workspaceId}
        onClose={() => onReviewOpenChange(false)}
        onApply={async (changeId, payload) => {
          try {
            await onBeforeMerge?.();
            await wikiService.actOnChange(workspaceSlug, node.id, changeId, "merge", payload);
            await onMerged();
            await load();
          } finally {
            onMergeSettled?.();
          }
        }}
      />
    );
  }

  const suggestTitle = active
    ? `${t("workspace_wiki.change_request")} · ${t(`workspace_wiki.change_status.${active.status}`)}`
    : t("workspace_wiki.start_change");
  const messageIsError = message === t("workspace_wiki.forbidden") || message === t("workspace_wiki.change_conflict");

  if (!node.is_creator) {
    return (
      <Dialog
        open={suggestOpen}
        onOpenChange={(next) => {
          if (!next) {
            void flushDraft();
            onSuggestOpenChange(false);
          }
        }}
      >
        <DialogContent size="xl" height="fixed" aria-label={suggestTitle}>
          <DialogCloseGroup>
            <IconButton
              variant="ghost"
              size="xs"
              aria-label={t("close")}
              icon={<Icon icon={CloseOutline} />}
              render={<DialogClose />}
            />
          </DialogCloseGroup>
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{suggestTitle}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0} className="flex flex-col overflow-hidden">
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                {!active && !message && (
                  <p className="text-body-sm-regular text-tertiary">{t("workspace_wiki.loading")}</p>
                )}
                {suggestOpen && active && (
                  <>
                    <p className="text-caption-sm-medium text-tertiary">{t("workspace_wiki.published_unchanged")}</p>
                    {active.review_comment && (
                      <p className="rounded-md border border-subtle bg-layer-1 px-3 py-2 text-body-sm-regular">
                        {active.review_comment}
                      </p>
                    )}
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
                          className="h-8 min-w-48 flex-1 rounded-md border border-subtle bg-layer-1 px-2 text-body-sm-regular"
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
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-subtle">
                      {active.can_edit && <WikiEditorToolbar editorRef={draftEditor.editor} />}
                      <div className="vertical-scrollbar scrollbar-sm min-h-0 flex-1 overflow-y-auto px-3 py-2">
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
                            containerClassName="border-none p-0"
                            displayConfig={{ fontSize, fontStyle, wideLayout: Boolean(node.view_props?.full_width) }}
                            searchMentionCallback={async (payload) =>
                              workspaceService.searchEntity(workspaceSlug, payload)
                            }
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
                            containerClassName="border-none p-0"
                            displayConfig={{ fontSize, fontStyle, wideLayout: Boolean(node.view_props?.full_width) }}
                          />
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </DialogBody>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-subtle pt-3">
              {message && (
                <p
                  className={`mr-auto min-w-0 truncate text-caption-sm-medium ${
                    messageIsError ? "text-danger-primary" : "text-tertiary"
                  }`}
                >
                  {message}
                </p>
              )}
              {active?.can_withdraw && (
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
              {active?.can_close && (
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
              {active?.can_merge && !active.merge_plan?.conflicts.length && (
                <Button
                  variant="primary"
                  size="sm"
                  stretch="auto"
                  label={t("workspace_wiki.merge_change")}
                  onClick={() => mergeChange()}
                />
              )}
              {active?.can_submit && (
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
            </div>
          </DialogMain>
        </DialogContent>
      </Dialog>
    );
  }
}
