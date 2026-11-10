/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
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
import { renderFormattedDate, renderFormattedTime } from "@plane/utils";
import type { TWikiChange, TWikiMergeBlock, TWikiMergeChange } from "@/services/wiki.service";

const PAGE_SIZE = 8;

type Choice = "current" | "draft" | "baseline" | "custom";

type MergeRow = {
  id: string;
  change: TWikiMergeChange;
  baseText: string;
  currentText: string;
  draftText: string;
  baseBlock: object | null;
  currentBlock: object | null;
  draftBlock: object | null;
  autoBlock: object | null;
};

type ApplyPayload = {
  resolutions: { id: string; choice: "current" | "draft" | "custom"; block?: object }[];
  description_html: string;
  description_json: object;
};

type Props = {
  open: boolean;
  changes: TWikiChange[];
  onClose: () => void;
  onApply: (changeId: string, payload: ApplyPayload) => Promise<void>;
};

const plainText = (node: unknown): string => {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return "";
  const record = node as { type?: string; html?: string; text?: string; content?: unknown[] };
  if (record.type === "html") return record.html || "";
  if (record.text) return String(record.text);
  return (record.content || []).map((child) => plainText(child)).join("");
};

const blockOf = (value: object | null | undefined): object | null =>
  value && typeof value === "object" ? value : null;

const buildRows = (change: TWikiChange): MergeRow[] => {
  const blocks = change.merge_plan?.blocks ?? [];
  if (blocks.length === 0) {
    const currentText = plainText(change.description_json) || change.description_html || "";
    return [
      {
        id: "document",
        change: currentText ? "draft" : "same",
        baseText: "",
        currentText: "",
        draftText: currentText,
        baseBlock: null,
        currentBlock: null,
        draftBlock: blockOf(change.description_json),
        autoBlock: blockOf(change.description_json),
      },
    ];
  }
  return blocks.map((entry) => rowFromBlock(entry));
};

const rowFromBlock = (entry: TWikiMergeBlock): MergeRow => {
  const baseText = entry.baseline_text ?? plainText(entry.baseline);
  const currentText = entry.current_text ?? plainText(entry.current);
  const draftText = entry.draft_text ?? plainText(entry.draft ?? entry.block);
  let change = entry.change;
  if (!change) change = entry.conflict ? "conflict" : currentText === draftText ? "same" : "draft";
  return {
    id: entry.id,
    change,
    baseText,
    currentText,
    draftText,
    baseBlock: blockOf(entry.baseline),
    currentBlock: blockOf(entry.current),
    draftBlock: blockOf(entry.draft),
    autoBlock: blockOf(entry.block),
  };
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const textBlock = (row: MergeRow, text: string): object | null => {
  if (!text) return null;
  const source = row.autoBlock || row.currentBlock || row.draftBlock || row.baseBlock;
  const record = (source || {}) as { type?: string; attrs?: object };
  const type = record.type === "heading" ? "heading" : "paragraph";
  return {
    type,
    attrs: record.attrs || { id: row.id },
    content: [{ type: "text", text }],
  };
};

const chosenBlock = (row: MergeRow, choice: Choice | undefined, custom: string | undefined): object | null => {
  if (choice === "current") return row.currentBlock;
  if (choice === "draft") return row.draftBlock;
  if (choice === "baseline") return row.baseBlock;
  if (choice === "custom") return textBlock(row, custom || "");
  if (row.change === "draft") return row.draftBlock;
  if (row.change === "conflict") return null;
  return row.autoBlock ?? row.currentBlock ?? row.draftBlock;
};

const blockHtml = (block: object | null): string => {
  if (!block) return "";
  const record = block as { type?: string; html?: string; attrs?: { level?: number } };
  if (record.type === "html") return record.html || "";
  const text = escapeHtml(plainText(block));
  if (!text) return "";
  if (record.type === "heading") {
    const level = Math.min(6, Math.max(1, Number(record.attrs?.level) || 1));
    return `<h${level}>${text}</h${level}>`;
  }
  if (record.type === "blockquote") return `<blockquote><p>${text}</p></blockquote>`;
  return `<p>${text}</p>`;
};

const resultText = (row: MergeRow, choice: Choice | undefined, custom: string | undefined) => {
  if (choice === "custom") return custom || "";
  if (choice === "current") return row.currentText;
  if (choice === "draft") return row.draftText;
  if (choice === "baseline") return row.baseText;
  if (row.change === "conflict") return "";
  if (row.change === "draft") return row.draftText;
  return row.currentText;
};

const tokenize = (value: string) => {
  const words = value.split(/(\s+)/).filter((part) => part.length > 0);
  if (words.length > 1 && /\s/.test(value)) return words;
  return Array.from(value);
};

const diffTokens = (base: string, text: string) => {
  const left = tokenize(base);
  const right = tokenize(text);
  if (left.length * right.length > 20000) return [{ text, changed: text !== base }];
  const scores: number[][] = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      scores[i][j] = left[i] === right[j] ? scores[i + 1][j + 1] + 1 : Math.max(scores[i + 1][j], scores[i][j + 1]);
    }
  }
  const changed = new Set<number>();
  let i = 0;
  let j = 0;
  while (j < right.length) {
    if (i < left.length && left[i] === right[j]) {
      i += 1;
      j += 1;
    } else if (i < left.length && scores[i + 1][j] >= scores[i][j + 1]) i += 1;
    else {
      changed.add(j);
      j += 1;
    }
  }
  const tokens = right.map((part, index) => ({ text: part, changed: changed.has(index) }));
  const grouped: { text: string; changed: boolean }[] = [];
  for (const token of tokens) {
    const last = grouped[grouped.length - 1];
    if (last && last.changed === token.changed) last.text += token.text;
    else grouped.push({ text: token.text, changed: token.changed });
  }
  return grouped;
};

function HighlightedText({ text, base, conflict }: { text: string; base: string; conflict: boolean }) {
  if (!text) return <span className="text-placeholder">—</span>;
  const parts = text === base ? [{ text, changed: false }] : diffTokens(base, text);
  let cursor = 0;
  return (
    <>
      {parts.map((part) => {
        const key = `${cursor}-${part.changed ? "c" : "s"}`;
        cursor += part.text.length + 1;
        return part.changed ? (
          <mark
            key={key}
            className={
              conflict
                ? "rounded-sm bg-danger-subtle px-0.5 text-danger-primary"
                : "rounded-sm bg-label-yellow-bg px-0.5 text-label-yellow-text"
            }
          >
            {part.text}
          </mark>
        ) : (
          <span key={key}>{part.text}</span>
        );
      })}
    </>
  );
}

function SidePane({ text, base, conflict }: { text: string; base: string; conflict: boolean }) {
  return (
    <div
      className={`min-h-9 px-3 py-2 text-body-sm-regular leading-6 break-words whitespace-pre-wrap ${
        conflict ? "bg-danger-subtle/40" : ""
      }`}
    >
      <HighlightedText text={text} base={base} conflict={conflict} />
    </div>
  );
}

function GutterButton({
  symbol,
  label,
  pressed,
  onClick,
}: {
  symbol: string;
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`font-mono flex h-6 min-w-6 items-center justify-center rounded-md border px-1 text-[11px] leading-none transition-colors ${
        pressed
          ? "border-accent-strong bg-accent-primary text-on-color"
          : "border-subtle bg-surface-1 text-secondary hover:bg-layer-1"
      }`}
      onClick={onClick}
    >
      {symbol}
    </button>
  );
}

function MergePane({
  change,
  onClose,
  onApply,
}: {
  change: TWikiChange;
  onClose: () => void;
  onApply: (changeId: string, payload: ApplyPayload) => Promise<void>;
}) {
  const { t } = useTranslation();
  const rows = useMemo(() => buildRows(change), [change]);
  const [choices, setChoices] = useState<Record<string, Choice | undefined>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const initial: Record<string, Choice | undefined> = {};
    for (const row of buildRows(change)) {
      initial[row.id] = row.change === "conflict" ? undefined : row.change === "draft" ? "draft" : "current";
    }
    setChoices(initial);
    setCustom({});
    setMessage("");
    // Reset only when a different request is opened. `change` is read for its blocks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change.id]);

  const conflicts = rows.filter((row) => row.change === "conflict");
  const changed = rows.filter((row) => row.change !== "same").length;
  const unresolved = conflicts.filter((row) => !choices[row.id]).length;
  const ready = unresolved === 0 && !applying;

  const setChoice = (id: string, choice: Choice) => {
    setChoices((current) => ({ ...current, [id]: choice }));
    setCustom((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const applySide = (changeKind: "current" | "draft", includeConflicts: boolean) => {
    const ids = rows
      .filter((row) => includeConflicts || row.change === changeKind || row.change === "both")
      .map((row) => row.id);
    setChoices((current) => {
      const next = { ...current };
      for (const id of ids) next[id] = changeKind;
      return next;
    });
    setCustom((current) => {
      const next = { ...current };
      for (const id of ids) delete next[id];
      return next;
    });
  };

  const applyMerge = () => {
    if (!ready) return;
    const content = rows
      .map((row) => chosenBlock(row, choices[row.id], custom[row.id]))
      .filter((block): block is object => block !== null);
    const resolutions = conflicts.map((row) => {
      const choice = choices[row.id];
      if (choice === "current" || choice === "draft") return { id: row.id, choice };
      return {
        id: row.id,
        choice: "custom" as const,
        block: chosenBlock(row, choice, custom[row.id]) ?? {
          type: "paragraph",
          attrs: { id: row.id },
          content: [],
        },
      };
    });
    setApplying(true);
    setMessage("");
    void onApply(change.id, {
      resolutions,
      description_json: { type: "doc", content },
      description_html: content.map((block) => blockHtml(block)).join("") || "<p></p>",
    })
      .then(() => {
        onClose();
        return undefined;
      })
      .catch((error: unknown) => {
        const code = error && typeof error === "object" && "error" in error ? String(error.error) : "";
        setMessage(code === "conflict" ? t("workspace_wiki.change_conflict") : t("workspace_wiki.forbidden"));
        return undefined;
      })
      .finally(() => setApplying(false));
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          forceRender
          className="fixed inset-0 z-50 bg-backdrop transition-opacity duration-200 data-closed:pointer-events-none data-ending-style:pointer-events-none data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none"
          style={(state) => (state.open ? undefined : { pointerEvents: "none" })}
        />
        <BaseDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <BaseDialog.Popup
            aria-label={t("workspace_wiki.merge_change")}
            className="relative flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none origin-(--transform-origin) flex-col overflow-clip rounded-xl border-sm border-subtle bg-surface-1 shadow-raised-300 transition-[opacity,transform] duration-200 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none"
          >
            <DialogCloseGroup>
              <IconButton
                variant="ghost"
                size="xs"
                aria-label={t("common.cancel")}
                icon={<Icon icon={CloseOutline} />}
                render={<DialogClose />}
              />
            </DialogCloseGroup>
            <DialogMain>
              <DialogHeader>
                <DialogHeading>
                  <DialogTitle>
                    {change.author_name} · {t("workspace_wiki.merge_change")}
                  </DialogTitle>
                </DialogHeading>
              </DialogHeader>
              <DialogBody tabIndex={0}>
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-caption-sm-medium text-tertiary">
                        {t("workspace_wiki.apply_nonconflicting")}
                      </span>
                      <GutterButton
                        symbol=">>"
                        label={t("workspace_wiki.accept_left")}
                        pressed={false}
                        onClick={() => applySide("current", false)}
                      />
                      <GutterButton
                        symbol="<<"
                        label={t("workspace_wiki.accept_right")}
                        pressed={false}
                        onClick={() => applySide("draft", false)}
                      />
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-caption-sm-medium ${
                        unresolved > 0 ? "bg-danger-subtle text-danger-primary" : "bg-layer-2 text-tertiary"
                      }`}
                    >
                      {t("workspace_wiki.merge_summary", { changes: changed, conflicts: unresolved })}
                    </span>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-subtle">
                    <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_4.25rem_minmax(0,1fr)_4.25rem_minmax(0,1fr)] border-b border-subtle bg-layer-1 text-caption-sm-medium text-tertiary">
                      <span className="px-3 py-2">{t("workspace_wiki.merge_before")}</span>
                      <span />
                      <span className="px-3 py-2">{t("workspace_wiki.merge_result")}</span>
                      <span />
                      <span className="px-3 py-2">{t("workspace_wiki.merge_after")}</span>
                    </div>
                    <div className="vertical-scrollbar scrollbar-sm min-h-0 flex-1 overflow-y-auto">
                      {rows
                        .filter((row) => row.currentText || row.draftText || row.baseText || row.change === "conflict")
                        .map((row) => {
                          const choice = choices[row.id];
                          const unresolvedRow = row.change === "conflict" && !choice;
                          const center = resultText(row, choice, custom[row.id]);
                          const changedRow = row.change !== "same";
                          return (
                            <div
                              key={row.id}
                              className={`grid grid-cols-[minmax(0,1fr)_4.25rem_minmax(0,1fr)_4.25rem_minmax(0,1fr)] border-b border-subtle last:border-b-0 ${
                                unresolvedRow ? "bg-danger-subtle/30" : ""
                              }`}
                            >
                              <SidePane text={row.currentText} base={row.baseText} conflict={unresolvedRow} />
                              <div className="flex items-center justify-center gap-1 border-x border-subtle bg-layer-1 px-1">
                                {changedRow && (
                                  <>
                                    <GutterButton
                                      symbol="×"
                                      label={t("workspace_wiki.ignore_change")}
                                      pressed={choice === "baseline"}
                                      onClick={() => setChoice(row.id, "baseline")}
                                    />
                                    <GutterButton
                                      symbol=">>"
                                      label={t("workspace_wiki.accept_left")}
                                      pressed={choice === "current"}
                                      onClick={() => setChoice(row.id, "current")}
                                    />
                                  </>
                                )}
                              </div>
                              <textarea
                                value={center}
                                aria-label={t("workspace_wiki.merge_result")}
                                rows={Math.max(1, center.split("\n").length)}
                                className={`min-h-9 w-full resize-none bg-transparent px-3 py-2 text-body-sm-regular leading-6 outline-none focus:bg-layer-1 ${
                                  unresolvedRow ? "placeholder:text-danger-primary" : ""
                                }`}
                                placeholder="—"
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setChoices((currentChoices) => ({ ...currentChoices, [row.id]: "custom" }));
                                  setCustom((currentCustom) => ({ ...currentCustom, [row.id]: value }));
                                }}
                              />
                              <div className="flex items-center justify-center border-x border-subtle bg-layer-1 px-1">
                                {changedRow && (
                                  <GutterButton
                                    symbol="<<"
                                    label={t("workspace_wiki.accept_right")}
                                    pressed={choice === "draft"}
                                    onClick={() => setChoice(row.id, "draft")}
                                  />
                                )}
                              </div>
                              <SidePane text={row.draftText} base={row.baseText} conflict={unresolvedRow} />
                            </div>
                          );
                        })}
                    </div>
                  </div>
                  {message && <p className="text-caption-sm-medium text-danger-primary">{message}</p>}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle pt-3">
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        stretch="auto"
                        label={t("workspace_wiki.accept_left")}
                        onClick={() => applySide("current", true)}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        stretch="auto"
                        label={t("workspace_wiki.accept_right")}
                        onClick={() => applySide("draft", true)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        stretch="auto"
                        label={t("common.cancel")}
                        onClick={onClose}
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        stretch="auto"
                        disabled={!ready}
                        label={t("common.apply")}
                        onClick={applyMerge}
                      />
                    </div>
                  </div>
                </div>
              </DialogBody>
            </DialogMain>
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </Dialog>
  );
}

function MergeDetail({ change, onClose }: { change: TWikiChange; onClose: () => void }) {
  const { t } = useTranslation();
  const rows = (change.merge_detail?.blocks ?? []).filter(
    (entry) => entry.current_text || entry.draft_text || entry.change !== "same"
  );

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="full" density="compact" aria-label={t("workspace_wiki.merge_change")}>
        <DialogCloseGroup>
          <IconButton
            variant="ghost"
            size="xs"
            aria-label={t("common.cancel")}
            icon={<Icon icon={CloseOutline} />}
            render={<DialogClose />}
          />
        </DialogCloseGroup>
        <DialogMain>
          <DialogHeader>
            <DialogHeading>
              <DialogTitle>
                {change.author_name} · {t("workspace_wiki.change_status.merged")}
              </DialogTitle>
            </DialogHeading>
          </DialogHeader>
          <DialogBody tabIndex={0}>
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-subtle">
              <div className="grid shrink-0 grid-cols-2 border-b border-subtle bg-layer-1 text-caption-sm-medium text-tertiary">
                <span className="px-3 py-2">{t("workspace_wiki.merge_before")}</span>
                <span className="border-l border-subtle px-3 py-2">{t("workspace_wiki.merge_after")}</span>
              </div>
              <div className="vertical-scrollbar scrollbar-sm min-h-0 flex-1 overflow-y-auto">
                {rows.length === 0 ? (
                  <p className="px-3 py-4 text-body-sm-regular text-tertiary">{t("workspace_wiki.no_results")}</p>
                ) : (
                  rows.map((entry) => {
                    const changed = entry.change !== "same";
                    const tone = changed ? "bg-accent-subtle" : "";
                    return (
                      <div key={entry.id} className="grid grid-cols-2 border-b border-subtle last:border-b-0">
                        <div className={`min-h-9 px-3 py-2 text-body-sm-regular leading-6 break-words ${tone}`}>
                          <HighlightedText
                            text={entry.current_text || ""}
                            base={entry.draft_text || ""}
                            conflict={false}
                          />
                        </div>
                        <div
                          className={`min-h-9 border-l border-subtle px-3 py-2 text-body-sm-regular leading-6 break-words ${tone}`}
                        >
                          <HighlightedText
                            text={entry.draft_text || ""}
                            base={entry.current_text || ""}
                            conflict={false}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </DialogBody>
        </DialogMain>
      </DialogContent>
    </Dialog>
  );
}

export function WikiReviewDialog({ open, changes, onClose, onApply }: Props) {
  const { t } = useTranslation();
  const [merging, setMerging] = useState<TWikiChange | null>(null);
  const [detail, setDetail] = useState<TWikiChange | null>(null);
  const [page, setPage] = useState(1);
  const [jumpValue, setJumpValue] = useState("1");
  const [jumping, setJumping] = useState(false);
  const listed = [...changes].toSorted((left, right) =>
    (right.submitted_at || right.updated_at || "").localeCompare(left.submitted_at || left.updated_at || "")
  );
  const pageCount = Math.max(1, Math.ceil(listed.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = listed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (!open) {
      setMerging(null);
      setDetail(null);
      setPage(1);
      setJumping(false);
    }
  }, [open]);

  const goTo = (next: number) => {
    const clamped = Math.min(pageCount, Math.max(1, Math.trunc(next)));
    setPage(clamped);
    setJumpValue(String(clamped));
    setJumping(false);
  };

  const commitJump = () => {
    const parsed = Number.parseInt(jumpValue, 10);
    if (Number.isFinite(parsed)) goTo(parsed);
    else setJumping(false);
  };

  const submittedLabel = (change: TWikiChange) => {
    const value = change.submitted_at || change.updated_at;
    if (!value) return "—";
    return [renderFormattedDate(value), renderFormattedTime(value)].filter(Boolean).join(" ");
  };

  const openMerge = (change: TWikiChange) => {
    if (change.can_merge) setMerging(change);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <DialogContent size="lg" aria-label={t("workspace_wiki.change_request")}>
          <DialogCloseGroup>
            <IconButton
              variant="ghost"
              size="xs"
              aria-label={t("common.cancel")}
              icon={<Icon icon={CloseOutline} />}
              render={<DialogClose />}
            />
          </DialogCloseGroup>
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{t("workspace_wiki.change_request")}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0}>
              {listed.length === 0 ? (
                <p className="text-body-sm-regular text-tertiary">{t("workspace_wiki.no_results")}</p>
              ) : (
                <div className="flex flex-col">
                  <div className="grid grid-cols-[minmax(0,1fr)_11rem_auto] gap-3 px-3 py-2 text-caption-sm-medium text-tertiary">
                    <span>{t("workspace_wiki.request_author")}</span>
                    <span>{t("workspace_wiki.request_submitted")}</span>
                    <span />
                  </div>
                  <div className="overflow-hidden rounded-lg border border-subtle">
                    <div className="h-[26rem]">
                      {pageItems.map((change) => (
                        <div
                          key={change.id}
                          className="grid h-[3.25rem] cursor-pointer grid-cols-[minmax(0,1fr)_11rem_auto] items-center gap-3 border-b border-subtle px-3 last:border-b-0 hover:bg-layer-1"
                          onDoubleClick={() => openMerge(change)}
                        >
                          <button
                            type="button"
                            className="contents text-left"
                            onClick={() => {
                              if (change.status === "merged") setDetail(change);
                            }}
                          >
                            <span className="min-w-0 truncate text-body-sm-regular">
                              {change.author_name}
                              <span className="ml-2 text-caption-sm-medium text-tertiary">
                                {t(`workspace_wiki.change_status.${change.status}`)}
                              </span>
                            </span>
                            <span className="text-body-sm-regular text-tertiary">{submittedLabel(change)}</span>
                          </button>
                          <div className={change.status === "merged" ? "pointer-events-none" : undefined}>
                            <Button
                              variant={change.can_merge ? "primary" : "secondary"}
                              size="sm"
                              stretch="auto"
                              disabled={!change.can_merge}
                              label={t("workspace_wiki.merge_change")}
                              onClick={() => openMerge(change)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      stretch="auto"
                      disabled={safePage <= 1}
                      label={t("workspace_wiki.page_first")}
                      onClick={() => goTo(1)}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      stretch="auto"
                      disabled={safePage <= 1}
                      label={t("workspace_wiki.page_previous")}
                      onClick={() => goTo(safePage - 1)}
                    />
                    <input
                      value={jumping ? jumpValue : String(safePage)}
                      aria-label={t("workspace_wiki.page_jump")}
                      inputMode="numeric"
                      className="h-8 w-14 rounded-md border border-subtle bg-surface-1 text-center text-body-sm-regular outline-none focus:border-accent-strong"
                      onFocus={() => {
                        setJumpValue(String(safePage));
                        setJumping(true);
                      }}
                      onChange={(event) => setJumpValue(event.target.value.replace(/\D/g, ""))}
                      onBlur={commitJump}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitJump();
                        }
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      stretch="auto"
                      disabled={safePage >= pageCount}
                      label={t("workspace_wiki.page_next")}
                      onClick={() => goTo(safePage + 1)}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      stretch="auto"
                      disabled={safePage >= pageCount}
                      label={t("workspace_wiki.page_last")}
                      onClick={() => goTo(pageCount)}
                    />
                  </div>
                </div>
              )}
            </DialogBody>
          </DialogMain>
        </DialogContent>
      </Dialog>
      {merging && <MergePane change={merging} onClose={() => setMerging(null)} onApply={onApply} />}
      {detail && <MergeDetail change={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
