/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@makeplane/propel/components/avatar";
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
import {
  ChatOutline,
  ChevronDownOutline,
  ChevronUpOutline,
  CloseOutline,
  DeleteOutline,
  EditOutline,
} from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
import { cn, getFileURL } from "@plane/utils";
import type { TWikiComment } from "@/services/wiki.service";
import { WikiService } from "@/services/wiki.service";

const wikiService = new WikiService();

type Props = {
  workspaceSlug: string;
  nodeId: string;
  nodeName: string;
  targetId: string | null;
  onClose: () => void;
};

type Action = { type: "edit" | "reply"; comment: TWikiComment };

function groupThreads(comments: TWikiComment[]) {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const children = new Map<string, TWikiComment[]>();
  const threads: { root: TWikiComment; replies: { comment: TWikiComment; replyTo?: TWikiComment }[] }[] = [];

  for (const comment of comments) {
    if (comment.parent_id && byId.has(comment.parent_id)) {
      const siblings = children.get(comment.parent_id) ?? [];
      siblings.push(comment);
      children.set(comment.parent_id, siblings);
    } else {
      threads.push({ root: comment, replies: [] });
    }
  }

  const order = new Map(comments.map((comment, index) => [comment.id, index]));
  for (const thread of threads) {
    const pending = [...(children.get(thread.root.id) ?? [])];
    for (let comment = pending.pop(); comment; comment = pending.pop()) {
      const replyTo =
        comment.parent_id && comment.parent_id !== thread.root.id ? byId.get(comment.parent_id) : undefined;
      thread.replies.push({ comment, replyTo });
      for (const reply of children.get(comment.id) ?? []) pending.push(reply);
    }
    thread.replies.sort((left, right) => (order.get(left.comment.id) ?? 0) - (order.get(right.comment.id) ?? 0));
  }
  return threads;
}

export function WikiCommentsDialog({ workspaceSlug, nodeId, nodeName, targetId, onClose }: Props) {
  const { t } = useTranslation();
  const [comments, setComments] = useState<TWikiComment[]>([]);
  const [action, setAction] = useState<Action | null>(null);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [request, setRequest] = useState<{ page: number; focus?: string | null }>({ page: 1 });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const focusId = request.focus === undefined ? targetId : request.focus;
  const targetRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const threads = useMemo(() => groupThreads(comments), [comments]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    const loadComments = async () => {
      try {
        const result = await wikiService.listComments(workspaceSlug, nodeId, request.page, focusId);
        if (active) {
          setComments(result.results);
          setPage(result.page);
          setTotalPages(result.total_pages);
        }
      } catch {
        if (active) setLoadFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadComments();
    return () => {
      active = false;
    };
  }, [workspaceSlug, nodeId, request.page, focusId, retry]);

  useEffect(() => {
    if (!loading && focusId) targetRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [loading, focusId]);

  const begin = (type: Action["type"], comment: TWikiComment) => {
    setAction({ type, comment });
    setBody(type === "edit" ? comment.body : "");
    setFailed(false);
    composerRef.current?.focus();
    composerRef.current?.scrollIntoView?.({ block: "nearest" });
  };

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if (action?.type === "edit") {
        const updated = await wikiService.editComment(workspaceSlug, nodeId, action.comment.id, body);
        setComments((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const created = await wikiService.addComment(workspaceSlug, nodeId, body, action?.comment.id);
        if (action?.type === "reply") {
          const thread = threads.find(
            ({ root, replies }) =>
              root.id === action.comment.id || replies.some(({ comment }) => comment.id === action.comment.id)
          );
          if (thread) setExpanded((current) => ({ ...current, [thread.root.id]: true }));
          setComments((items) => [...items, created]);
        } else {
          setRequest({ page, focus: created.id });
        }
      }
      setAction(null);
      setBody("");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (commentId: string) => {
    if (busy || !window.confirm(t("workspace_wiki.comments.confirm_delete"))) return;
    setBusy(true);
    setFailed(false);
    try {
      await wikiService.deleteComment(workspaceSlug, nodeId, commentId);
      if (action?.comment.id === commentId) {
        setAction(null);
        setBody("");
      }
      setRequest({ page, focus: null });
      setRetry((value) => value + 1);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const goToPage = (next: number) => {
    setExpanded({});
    setFailed(false);
    if (action) {
      setAction(null);
      setBody("");
    }
    setRequest({ page: next, focus: null });
  };

  const authorName = (comment: TWikiComment) => comment.author_name || t("workspace_wiki.comments.unknown_author");

  const renderComment = (comment: TWikiComment, replyTo?: TWikiComment, isReply = false) => (
    <article
      key={comment.id}
      ref={comment.id === focusId ? targetRef : undefined}
      className={cn("flex items-start gap-3 rounded-lg px-2 py-2.5", comment.id === focusId && "bg-layer-2")}
    >
      {!comment.deleted && (
        <Avatar
          alt={authorName(comment)}
          fallback={Array.from(authorName(comment))[0]?.toUpperCase()}
          src={comment.author_avatar_url ? getFileURL(comment.author_avatar_url) : undefined}
          size={isReply ? "sm" : "md"}
        />
      )}
      <div className="min-w-0 flex-1">
        {comment.deleted ? (
          <p className="text-body-sm-regular text-tertiary">{t("workspace_wiki.comments.deleted")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm-medium">
              <span className="break-words text-primary">{authorName(comment)}</span>
              {replyTo && (
                <span className="break-words text-tertiary">
                  → {replyTo.deleted ? t("workspace_wiki.comments.deleted_target") : authorName(replyTo)}
                </span>
              )}
              {comment.edited_at && (
                <span className="rounded-full bg-layer-2 px-2 py-0.5 text-caption-sm-regular text-tertiary">
                  {t("workspace_wiki.comments.edited")}
                </span>
              )}
            </div>
            <p className="mt-1 text-body-sm-regular break-words whitespace-pre-wrap text-primary">{comment.body}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <time className="text-caption-sm-regular text-tertiary" dateTime={comment.created_at}>
                {new Date(comment.created_at).toLocaleString()}
              </time>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  stretch="auto"
                  variant="secondary"
                  size="xs"
                  disabled={busy}
                  onClick={() => begin("reply", comment)}
                  icon={<Icon icon={ChatOutline} />}
                  label={t("workspace_wiki.comments.reply")}
                />
                {comment.can_edit && (
                  <IconButton
                    variant="secondary"
                    size="xs"
                    disabled={busy}
                    onClick={() => begin("edit", comment)}
                    icon={<Icon icon={EditOutline} />}
                    aria-label={t("workspace_wiki.comments.edit")}
                    title={t("workspace_wiki.comments.edit")}
                  />
                )}
                {comment.can_delete && (
                  <IconButton
                    variant="danger-outline"
                    size="xs"
                    disabled={busy}
                    onClick={() => void remove(comment.id)}
                    icon={<Icon icon={DeleteOutline} />}
                    aria-label={t("workspace_wiki.delete")}
                    title={t("workspace_wiki.delete")}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </article>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" aria-label={t("workspace_wiki.comments.title")}>
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
              <DialogTitle>
                {t("workspace_wiki.comments.title")} · {nodeName}
              </DialogTitle>
            </DialogHeading>
          </DialogHeader>
          <DialogBody>
            <div className="flex max-h-[65vh] min-h-0 flex-col">
              <div className="min-h-0 overflow-y-auto px-1 pb-3">
                {loading && <p role="status">{t("workspace_wiki.loading")}</p>}
                {loadFailed && (
                  <div className="flex items-center gap-2" role="alert">
                    {t("workspace_wiki.comments.error")}
                    <Button
                      stretch="auto"
                      variant="secondary"
                      size="sm"
                      onClick={() => setRetry((value) => value + 1)}
                      label={t("workspace_wiki.comments.retry")}
                    />
                  </div>
                )}
                {!loading && !loadFailed && threads.length === 0 && (
                  <p className="py-8 text-center text-body-sm-regular text-tertiary">
                    {t("workspace_wiki.comments.empty")}
                  </p>
                )}
                {!loading &&
                  !loadFailed &&
                  threads.map(({ root, replies }) => {
                    const isExpanded = expanded[root.id] ?? replies.some(({ comment }) => comment.id === focusId);
                    return (
                      <div key={root.id} className="border-b border-subtle py-2 first:pt-0 last:border-b-0">
                        {renderComment(root)}
                        {replies.length > 0 && (
                          <div className="ms-6 border-s border-subtle ps-2 sm:ms-12 sm:ps-3">
                            {isExpanded && replies.map(({ comment, replyTo }) => renderComment(comment, replyTo, true))}
                            <Button
                              type="button"
                              stretch="auto"
                              size="xs"
                              variant="secondary"
                              aria-expanded={isExpanded}
                              icon={<Icon icon={isExpanded ? ChevronUpOutline : ChevronDownOutline} />}
                              label={t(
                                isExpanded
                                  ? "workspace_wiki.comments.hide_replies"
                                  : "workspace_wiki.comments.show_replies",
                                { count: replies.filter(({ comment }) => !comment.deleted).length }
                              )}
                              onClick={() => setExpanded((current) => ({ ...current, [root.id]: !isExpanded }))}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
              {totalPages > 1 && !loadFailed && (
                <div className="flex shrink-0 items-center justify-end gap-2 pb-3 text-body-xs-regular text-tertiary">
                  <Button
                    type="button"
                    stretch="auto"
                    size="xs"
                    variant="secondary"
                    label={t("workspace_wiki.page_previous")}
                    disabled={loading || busy || page <= 1}
                    onClick={() => goToPage(page - 1)}
                  />
                  <span aria-live="polite">
                    {page} / {totalPages}
                  </span>
                  <Button
                    type="button"
                    stretch="auto"
                    size="xs"
                    variant="secondary"
                    label={t("workspace_wiki.page_next")}
                    disabled={loading || busy || page >= totalPages}
                    onClick={() => goToPage(page + 1)}
                  />
                </div>
              )}
              <form
                className="flex shrink-0 flex-col gap-2 border-t border-subtle pt-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <label className="text-body-sm-medium">
                  {action?.type === "reply"
                    ? t("workspace_wiki.comments.reply_to", { name: authorName(action.comment) })
                    : t(action?.type === "edit" ? "workspace_wiki.comments.edit" : "workspace_wiki.comments.add")}
                  <textarea
                    ref={composerRef}
                    className="mt-1 block w-full resize-none rounded-lg border border-subtle bg-layer-1 px-3 py-2 text-body-sm-regular focus-visible:ring-1 focus-visible:ring-accent-strong focus-visible:outline-none"
                    rows={3}
                    maxLength={10000}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    disabled={busy || loading || loadFailed}
                  />
                </label>
                {failed && (
                  <p role="alert" className="text-danger-primary">
                    {t("workspace_wiki.comments.error")}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  {action && (
                    <Button
                      stretch="auto"
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setAction(null);
                        setBody("");
                        setFailed(false);
                      }}
                      label={t("common.cancel")}
                    />
                  )}
                  <Button
                    stretch="auto"
                    type="submit"
                    size="sm"
                    variant="primary"
                    disabled={busy || loading || loadFailed || !body.trim()}
                    label={t(action?.type === "edit" ? "workspace_wiki.comments.save" : "workspace_wiki.comments.send")}
                  />
                </div>
              </form>
            </div>
          </DialogBody>
        </DialogMain>
      </DialogContent>
    </Dialog>
  );
}
