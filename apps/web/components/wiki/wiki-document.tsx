/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import type { JSONContent } from "@plane/types";
import { DocumentEditor } from "@/components/editor/document/editor";
import { useFavorite } from "@/hooks/store/use-favorite";
import { useWorkspace } from "@/hooks/store/use-workspace";
import type { TWikiNode, TWikiVersion } from "@/services/wiki.service";
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
  const { getWorkspaceBySlug } = useWorkspace();
  const { entityMap, addFavorite, deleteFavorite } = useFavorite();
  const workspaceId = getWorkspaceBySlug(workspaceSlug)?.id ?? "";
  const [node, setNode] = useState<TWikiNode | null>(null);
  const [versions, setVersions] = useState<TWikiVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [preview, setPreview] = useState<TWikiVersion | null>(null);
  const [message, setMessage] = useState("");
  const favorite = entityMap[nodeId];

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setShowVersions(false);
    void wikiService.retrieve(workspaceSlug, nodeId).then((detail) => {
      if (!cancelled) setNode(detail);
      return undefined;
    });
    return () => {
      cancelled = true;
    };
  }, [nodeId, workspaceSlug]);

  const saveTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    [nodeId]
  );

  if (!node) return <p className="text-body-sm-regular text-tertiary">{t("workspace_wiki.loading")}</p>;

  const value = preview
    ? editorValue(preview.description_json, preview.description_html)
    : editorValue(node.description_json, node.description_html);
  const editable = node.can_edit_body && preview === null;

  const refresh = async () => {
    setNode(await wikiService.retrieve(workspaceSlug, nodeId));
    await onChanged();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {node.is_locked && <p className="text-body-sm-regular text-tertiary">{t("workspace_wiki.locked")}</p>}
      {!editable && !node.is_locked && !node.archived_at && (
        <p className="text-body-sm-regular text-tertiary">{t("workspace_wiki.read_only")}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {node.is_creator && (
          <>
            <button
              type="button"
              className="text-caption-sm-medium"
              onClick={() =>
                void wikiService.updateState(workspaceSlug, nodeId, { is_locked: !node.is_locked }).then(refresh)
              }
            >
              {node.is_locked ? t("workspace_wiki.unlock") : t("workspace_wiki.lock")}
            </button>
            <button
              type="button"
              className="text-caption-sm-medium"
              onClick={() =>
                void wikiService.updateState(workspaceSlug, nodeId, { archived: !node.archived_at }).then(refresh)
              }
            >
              {node.archived_at ? t("workspace_wiki.unarchive") : t("workspace_wiki.archive")}
            </button>
            {node.can_edit_body && (
              <>
                <input
                  value={node.color}
                  placeholder={t("workspace_wiki.color")}
                  className="h-8 w-28 rounded-md border border-subtle bg-layer-1 px-2 text-body-sm-regular"
                  onChange={(event) => setNode({ ...node, color: event.target.value })}
                  onBlur={(event) =>
                    void wikiService.update(workspaceSlug, nodeId, { color: event.target.value }).then(refresh)
                  }
                />
                <label className="flex items-center gap-1 text-caption-sm-medium">
                  <input
                    type="checkbox"
                    checked={Boolean(node.view_props?.full_width)}
                    onChange={(event) => {
                      const view_props = { ...node.view_props, full_width: event.target.checked };
                      setNode({ ...node, view_props });
                      void wikiService.update(workspaceSlug, nodeId, { view_props }).then(refresh);
                    }}
                  />
                  {t("workspace_wiki.wide")}
                </label>
              </>
            )}
          </>
        )}
        <button
          type="button"
          className="text-caption-sm-medium"
          onClick={() => void wikiService.duplicate(workspaceSlug, nodeId).then(() => onChanged())}
        >
          {t("workspace_wiki.duplicate")}
        </button>
        <button
          type="button"
          className="text-caption-sm-medium"
          onClick={() => {
            if (favorite?.id) void deleteFavorite(workspaceSlug, favorite.id);
            else
              void addFavorite(workspaceSlug, {
                entity_type: "wiki",
                entity_identifier: nodeId,
                entity_data: { name: node.name },
              });
          }}
        >
          {favorite ? t("workspace_wiki.unfavorite") : t("workspace_wiki.favorite")}
        </button>
        <button
          type="button"
          className="text-caption-sm-medium"
          onClick={() =>
            void wikiService.versions(workspaceSlug, nodeId).then((items) => {
              setVersions(items);
              setShowVersions(true);
              return undefined;
            })
          }
        >
          {t("workspace_wiki.versions")}
        </button>
      </div>
      {showVersions && (
        <div className="flex flex-col gap-1">
          {versions.map((version) => (
            <div key={version.id} className="flex items-center gap-2">
              <button type="button" className="text-caption-sm-medium" onClick={() => setPreview(version)}>
                {new Date(version.last_saved_at).toLocaleString()}
              </button>
              {node.can_edit_body && (
                <button
                  type="button"
                  className="text-caption-sm-medium"
                  onClick={() =>
                    void wikiService.restoreVersion(workspaceSlug, nodeId, version.id).then(async (restored) => {
                      setNode(restored);
                      setPreview(null);
                      await onChanged();
                      return undefined;
                    })
                  }
                >
                  {t("workspace_wiki.restore_version")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="min-h-64" style={{ color: node.color || undefined }}>
        {editable ? (
          <DocumentEditor
            key={`${nodeId}-edit`}
            editable
            id={nodeId}
            value={value}
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
                  .saveDescription(workspaceSlug, nodeId, {
                    description_html: html || "<p></p>",
                    description_json: description,
                  })
                  .then(() => setMessage(t("workspace_wiki.saved")))
                  .catch(() => setMessage(t("workspace_wiki.read_only")));
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
            displayConfig={{ wideLayout: Boolean(node.view_props?.full_width) }}
          />
        )}
      </div>
      {message && <p className="text-caption-sm-medium text-tertiary">{message}</p>}
    </div>
  );
});
