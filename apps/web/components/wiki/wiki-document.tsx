/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { CloseOutline, ShowOutline } from "@makeplane/propel/icons";
import { Badge } from "@makeplane/propel/components/badge";
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { useTranslation } from "@plane/i18n";
import type { JSONContent, TLogoProps } from "@plane/types";
import { cn, renderFormattedDate, renderFormattedTime } from "@plane/utils";
import type { EditorRefApi } from "@plane/editor";
import { DocumentEditor } from "@/components/editor/document/editor";
import { WikiChanges } from "@/components/wiki/wiki-changes";
import { useWikiEditorRef, WikiEditorToolbar } from "@/components/wiki/wiki-editor-toolbar";
import { usePageFilters } from "@/hooks/use-page-filters";
import { WikiFileActions } from "@/components/wiki/wiki-file-actions";
import { useSetWikiHeaderActions } from "@/components/wiki/wiki-header-actions";
import { WikiLogoControl } from "@/components/wiki/wiki-logo";
import { useFavorite } from "@/hooks/store/use-favorite";
import { useWorkspace } from "@/hooks/store/use-workspace";
import type { TWikiChange, TWikiNode, TWikiVersion } from "@/services/wiki.service";
import { WikiService } from "@/services/wiki.service";
import { WorkspaceService } from "@/services/workspace.service";

const wikiService = new WikiService();
const workspaceService = new WorkspaceService();

const editorValue = (json?: object, html?: string): JSONContent | string =>
  json && Object.keys(json).length > 0 ? (json as JSONContent) : html || "";

type Props = {
  workspaceSlug: string;
  nodeId: string;
  onChanged: () => Promise<void>;
};

export const WikiDocument = observer(function WikiDocument({ workspaceSlug, nodeId, onChanged }: Props) {
  const { t } = useTranslation();
  const setHeaderActions = useSetWikiHeaderActions();
  const { getWorkspaceBySlug } = useWorkspace();
  const { entityMap, addFavorite, deleteFavorite } = useFavorite();
  const workspaceId = getWorkspaceBySlug(workspaceSlug)?.id ?? "";
  const [node, setNode] = useState<TWikiNode | null>(null);
  const [versions, setVersions] = useState<TWikiVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [preview, setPreview] = useState<TWikiVersion | null>(null);
  const [message, setMessage] = useState("");
  const [publishedHtml, setPublishedHtml] = useState("");
  const [title, setTitle] = useState("");
  const [draftEditor, setDraftEditor] = useState<EditorRefApi | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [ownChange, setOwnChange] = useState<TWikiChange | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const handleOwnOpenChange = useCallback((change: TWikiChange | null) => {
    setOwnChange((current) =>
      current?.id === change?.id && current?.status === change?.status && current?.can_edit === change?.can_edit
        ? current
        : change
    );
  }, []);
  const handleReviewCount = useCallback((count: number) => {
    setReviewCount((current) => (current === count ? current : count));
  }, []);
  const publishedEditor = useWikiEditorRef();
  const { fontSize, fontStyle } = usePageFilters();
  const favorite = entityMap[nodeId];

  const serverHtml = useRef("");
  const pendingSave = useRef<{ html: string; json: object; base: string } | null>(null);
  const saveInFlight = useRef<Promise<void> | null>(null);
  const ignorePublish = useRef(false);
  const refresh = useCallback(async () => {
    const detail = await wikiService.retrieve(workspaceSlug, nodeId);
    serverHtml.current = detail.description_html || "";
    setNode(detail);
    setPublishedHtml(detail.description_html || "");
    setTitle(detail.name);
    await onChanged();
  }, [nodeId, onChanged, workspaceSlug]);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setShowVersions(false);
    setSuggestOpen(false);
    setOwnChange(null);
    setReviewOpen(false);
    setReviewCount(0);
    void wikiService.retrieve(workspaceSlug, nodeId).then((detail) => {
      if (!cancelled) {
        serverHtml.current = detail.description_html || "";
        setNode(detail);
        setPublishedHtml(detail.description_html || "");
        setTitle(detail.name);
      }
      return undefined;
    });
    return () => {
      cancelled = true;
    };
  }, [nodeId, workspaceSlug]);

  const saveTimer = useRef<number | null>(null);
  const flushPendingPublish = useCallback(async () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (saveInFlight.current) await saveInFlight.current;
    const pending = pendingSave.current;
    if (!pending || ignorePublish.current) return;
    pendingSave.current = null;
    const request = wikiService
      .saveDescription(workspaceSlug, nodeId, {
        description_html: pending.html,
        description_json: pending.json,
        base_html: pending.base,
      })
      .then((saved) => {
        serverHtml.current = saved.description_html || "";
        if (pendingSave.current) pendingSave.current.base = serverHtml.current;
        setPublishedHtml(saved.description_html || "");
        setMessage("");
        return undefined;
      })
      .catch((error: { error?: string } | undefined) => {
        pendingSave.current = null;
        if (error?.error === "conflict") return refresh();
        setMessage(t("workspace_wiki.read_only"));
        return undefined;
      })
      .finally(() => {
        saveInFlight.current = null;
      });
    saveInFlight.current = request;
    await request;
    if (pendingSave.current && !ignorePublish.current) await flushPendingPublish();
  }, [nodeId, refresh, t, workspaceSlug]);
  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    [nodeId]
  );
  const releasePublish = useCallback(() => {
    window.setTimeout(() => {
      ignorePublish.current = false;
    }, 0);
  }, []);
  const prepareMerge = useCallback(async () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    await flushPendingPublish();
    ignorePublish.current = true;
  }, [flushPendingPublish]);

  const openVersions = useCallback(() => {
    void wikiService.versions(workspaceSlug, nodeId).then((items) => {
      setVersions(items);
      setShowVersions(true);
      return undefined;
    });
  }, [nodeId, workspaceSlug]);

  const saveTitle = () => {
    if (!node?.can_rename) return;
    const next = title.trim();
    if (!next || next === node.name) {
      setTitle(node.name);
      return;
    }
    void wikiService.update(workspaceSlug, nodeId, { name: next }).then(() => refresh());
  };

  useEffect(() => {
    if (!node) {
      setHeaderActions(null);
      return;
    }
    setHeaderActions(
      <WikiFileActions
        node={node}
        favorite={Boolean(favorite)}
        onLock={() => void wikiService.updateState(workspaceSlug, nodeId, { is_locked: !node.is_locked }).then(refresh)}
        onArchive={() =>
          void wikiService.updateState(workspaceSlug, nodeId, { archived: !node.archived_at }).then(refresh)
        }
        onFavorite={() => {
          if (favorite?.id) void deleteFavorite(workspaceSlug, favorite.id);
          else
            void addFavorite(workspaceSlug, {
              entity_type: "wiki",
              entity_identifier: nodeId,
              entity_data: { name: node.name },
            });
        }}
        onDuplicate={() => void wikiService.duplicate(workspaceSlug, nodeId).then(() => onChanged())}
        onVersions={openVersions}
        onWide={(wide) => {
          const view_props = { ...node.view_props, full_width: wide };
          setNode({ ...node, view_props });
          void wikiService.update(workspaceSlug, nodeId, { view_props }).then(refresh);
        }}
        onColor={(color) => {
          setNode({ ...node, color });
          void wikiService.update(workspaceSlug, nodeId, { color }).then(refresh);
        }}
        suggestLabel={
          !node.is_creator && (ownChange || (node.access === "editable" && !node.is_locked && !node.archived_at))
            ? ownChange
              ? `${t("workspace_wiki.change_request")} · ${t(`workspace_wiki.change_status.${ownChange.status}`)}`
              : t("workspace_wiki.start_change")
            : undefined
        }
        onSuggest={!node.is_creator ? () => setSuggestOpen(true) : undefined}
        reviewLabel={node.is_creator && reviewCount > 0 ? t("workspace_wiki.change_request") : undefined}
        onReview={node.is_creator ? () => setReviewOpen(true) : undefined}
      />
    );
    return () => setHeaderActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    addFavorite,
    deleteFavorite,
    favorite,
    node,
    ownChange,
    reviewCount,
    nodeId,
    onChanged,
    openVersions,
    refresh,
    setHeaderActions,
    workspaceSlug,
  ]);

  if (!node) return <p className="px-8 py-6 text-body-sm-regular text-tertiary">{t("workspace_wiki.loading")}</p>;

  const value = preview
    ? editorValue(preview.description_json, preview.description_html)
    : editorValue(node.description_json, node.description_html);
  const editable = node.can_edit_body && preview === null;
  const wide = Boolean(node.view_props?.full_width);
  const toolbarEditor = editable ? publishedEditor.editor : draftEditor;

  return (
    <div className="relative flex size-full min-h-0 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <WikiEditorToolbar editorRef={toolbarEditor} />
        {preview && (
          <div className="flex min-h-14 items-center justify-between gap-2 border-b border-subtle px-5 py-3">
            <div className="flex items-center gap-4">
              <h6 className="text-body-sm-medium text-primary">
                {renderFormattedDate(preview.last_saved_at)} {renderFormattedTime(preview.last_saved_at)}
              </h6>
              <Badge
                variant="brand"
                size="sm"
                startIcon={<Icon icon={ShowOutline} />}
                label={t("page_navigation_pane.tabs.version_history.view_only")}
              />
            </div>
            <div className="flex items-center gap-2">
              {node.can_edit_body && (
                <Button
                  variant="primary"
                  size="sm"
                  stretch="auto"
                  label={t("workspace_wiki.restore_version")}
                  onClick={() =>
                    void wikiService.restoreVersion(workspaceSlug, nodeId, preview.id).then(async (restored) => {
                      setNode(restored);
                      setPreview(null);
                      setPublishedHtml(restored.description_html || "");
                      await onChanged();
                      return undefined;
                    })
                  }
                />
              )}
              <Button
                variant="secondary"
                size="sm"
                stretch="auto"
                label={t("page_navigation_pane.tabs.info.version_history.current_version")}
                onClick={() => setPreview(null)}
              />
            </div>
          </div>
        )}
        <div className="vertical-scrollbar scrollbar-md flex-1 overflow-y-auto">
          <div
            className={cn("mx-auto w-full px-8 pb-16 transition-all duration-200", {
              "max-w-[1152px]": wide,
              "max-w-[720px]": !wide,
            })}
          >
            <div className="group/page-header">
              <WikiLogoControl
                variant="document"
                logo={node.logo_props}
                editable={node.is_creator}
                onChange={(logo_props: TLogoProps) => {
                  setNode({ ...node, logo_props });
                  void wikiService.update(workspaceSlug, nodeId, { logo_props }).then(() => refresh());
                }}
              />
              {node.can_rename ? (
                <input
                  value={title}
                  aria-label={t("workspace_wiki.rename")}
                  onChange={(event) => setTitle(event.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  className="w-full bg-transparent text-[2rem] leading-[2.375rem] font-bold tracking-[-0.02em] text-primary outline-none"
                />
              ) : (
                <h1 className="text-[2rem] leading-[2.375rem] font-bold tracking-[-0.02em] text-primary">
                  {node.name}
                </h1>
              )}
            </div>
            <div className="min-h-64" style={{ color: node.color || undefined }}>
              {editable ? (
                <DocumentEditor
                  key={`${nodeId}-edit-${node.description_html ?? ""}`}
                  ref={publishedEditor.ref}
                  handleEditorReady={publishedEditor.handleEditorReady}
                  editable
                  id={nodeId}
                  value={value}
                  workspaceId={workspaceId}
                  workspaceSlug={workspaceSlug}
                  containerClassName="h-full p-0 pb-64 border-none"
                  displayConfig={{ fontSize, fontStyle, wideLayout: wide }}
                  searchMentionCallback={async (payload) => workspaceService.searchEntity(workspaceSlug, payload)}
                  uploadFile={async () => ""}
                  duplicateFile={async () => ""}
                  onChange={(description, html, options) => {
                    if (options?.isMigrationUpdate || ignorePublish.current) return;
                    pendingSave.current = {
                      html: html || "<p></p>",
                      json: description,
                      base: serverHtml.current,
                    };
                    if (saveTimer.current) window.clearTimeout(saveTimer.current);
                    saveTimer.current = window.setTimeout(() => {
                      void flushPendingPublish();
                    }, 700);
                  }}
                />
              ) : (
                <DocumentEditor
                  key={`${nodeId}-${preview?.id ?? "read"}`}
                  editable={false}
                  id={nodeId}
                  value={value}
                  workspaceId={workspaceId}
                  workspaceSlug={workspaceSlug}
                  containerClassName="h-full p-0 pb-64 border-none"
                  displayConfig={{ fontSize, fontStyle, wideLayout: wide }}
                />
              )}
            </div>
            <div className="mt-8">
              <WikiChanges
                workspaceSlug={workspaceSlug}
                node={node}
                publishedHtml={publishedHtml}
                suggestOpen={suggestOpen}
                onSuggestOpenChange={setSuggestOpen}
                onOwnOpenChange={handleOwnOpenChange}
                reviewOpen={reviewOpen}
                onReviewOpenChange={setReviewOpen}
                onReviewCount={handleReviewCount}
                onBeforeMerge={prepareMerge}
                onMerged={refresh}
                onMergeSettled={releasePublish}
                onActiveEditor={setDraftEditor}
              />
            </div>
            {message && <p className="mt-3 text-caption-sm-medium text-tertiary">{message}</p>}
          </div>
        </div>
      </div>
      {showVersions && (
        <aside className="flex w-[294px] shrink-0 flex-col border-l border-subtle bg-surface-1">
          <div className="flex h-6 shrink-0 items-center justify-between gap-2 px-3.5 pt-3">
            <h2 className="text-body-sm-medium text-primary">{t("workspace_wiki.versions")}</h2>
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              icon={<Icon icon={CloseOutline} />}
              aria-label={t("page_navigation_pane.tabs.info.version_history.current_version")}
              onClick={() => {
                setShowVersions(false);
                setPreview(null);
              }}
            />
          </div>
          <div className="vertical-scrollbar mt-4 scrollbar-sm flex-1 overflow-y-auto px-3.5 pb-4">
            <ul className="flex flex-col gap-1">
              <li>
                <button
                  type="button"
                  className={cn("flex w-full flex-col gap-1 rounded-md p-1.5 text-left transition-colors", {
                    "bg-layer-transparent-selected": preview === null,
                    "hover:bg-layer-transparent-hover": preview !== null,
                  })}
                  onClick={() => setPreview(null)}
                >
                  <p className="text-body-sm-medium text-primary">
                    {t("page_navigation_pane.tabs.info.version_history.current_version")}
                  </p>
                </button>
              </li>
              {versions.map((version) => (
                <li key={version.id}>
                  <button
                    type="button"
                    className={cn("flex w-full flex-col gap-1 rounded-md p-1.5 text-left transition-colors", {
                      "bg-layer-transparent-selected": preview?.id === version.id,
                      "hover:bg-layer-transparent-hover": preview?.id !== version.id,
                    })}
                    onClick={() => setPreview(version)}
                  >
                    <p className="text-body-sm-medium text-primary">
                      {renderFormattedDate(version.last_saved_at)}, {renderFormattedTime(version.last_saved_at)}
                    </p>
                    {version.change_request && (
                      <span className="truncate text-caption-sm-regular text-secondary">
                        {t("workspace_wiki.from_change")}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </div>
  );
});
