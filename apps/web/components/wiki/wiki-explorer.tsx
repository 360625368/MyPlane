/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Logo } from "@plane/blocks/emoji-icon-picker";
import { useTranslation } from "@plane/i18n";
import type { TTranslationKeys } from "@plane/i18n";
import { PageHead } from "@/components/core/page-title";
import { WikiDocument } from "@/components/wiki/wiki-document";
import { useWikiHeaderActions } from "@/components/wiki/wiki-header-actions";
import { WikiLogoControl, wikiLogo } from "@/components/wiki/wiki-logo";
import type { TWikiAccess, TWikiMemberAccess, TWikiNode, TWikiNodeType, TWikiTrashNode } from "@/services/wiki.service";
import { WikiService } from "@/services/wiki.service";

const wikiService = new WikiService();

type Props = {
  workspaceSlug: string;
  nodeId?: string;
};

const ERROR_KEYS: Record<string, TTranslationKeys> = {
  folder_has_other_creators: "workspace_wiki.delete_blocked",
  invalid_parent: "workspace_wiki.invalid_parent",
  cannot_elevate: "workspace_wiki.cannot_elevate",
  forbidden: "workspace_wiki.forbidden",
  parent_deleted: "workspace_wiki.parent_deleted",
  not_found: "workspace_wiki.not_found",
  locked: "workspace_wiki.locked",
  archived: "workspace_wiki.archived_banner",
};

function errorMessage(error: unknown, t: (key: TTranslationKeys) => string) {
  const code = error && typeof error === "object" && "error" in error ? String(error.error) : "";
  const key = ERROR_KEYS[code];
  return key ? t(key) : t("workspace_wiki.not_found");
}

function descendantIds(nodeId: string, nodes: TWikiNode[]) {
  const children = new Map<string, string[]>();
  nodes.forEach((node) => {
    if (!node.parent_id) return;
    const list = children.get(node.parent_id) ?? [];
    list.push(node.id);
    children.set(node.parent_id, list);
  });
  const pending = [...(children.get(nodeId) ?? [])];
  const found = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || found.has(current)) continue;
    found.add(current);
    pending.push(...(children.get(current) ?? []));
  }
  return found;
}

export function WikiHeader() {
  const { t } = useTranslation();
  const actions = useWikiHeaderActions();
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <span className="text-body-sm-medium">{t("sidebar.wiki")}</span>
      {actions}
    </div>
  );
}

export function WikiExplorer({ workspaceSlug, nodeId }: Props) {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<TWikiNode[]>([]);
  const [trash, setTrash] = useState<TWikiTrashNode[]>([]);
  const [members, setMembers] = useState<TWikiMemberAccess[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [archivedNodes, setArchivedNodes] = useState<TWikiNode[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TWikiNode[] | null>(null);
  const [directNode, setDirectNode] = useState<TWikiNode | null>(null);
  const [showAccess, setShowAccess] = useState(false);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [draftName, setDraftName] = useState("");
  const [rename, setRename] = useState("");
  const [moveTarget, setMoveTarget] = useState("");

  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const root = nodes.find((node) => node.is_root);
  const selected = nodeId ? (nodesById.get(nodeId) ?? (directNode?.id === nodeId ? directNode : undefined)) : root;

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const nextNodes = await wikiService.list(workspaceSlug);
      setNodes(nextNodes);
      setMissing(false);
      if (nodeId && !nextNodes.some((node) => node.id === nodeId)) {
        try {
          setDirectNode(await wikiService.retrieve(workspaceSlug, nodeId));
          setMissing(false);
        } catch {
          setDirectNode(null);
          setMissing(true);
        }
      } else setDirectNode(null);
    } catch {
      setNodes([]);
      setMissing(true);
    } finally {
      setLoading(false);
    }
  }, [nodeId, workspaceSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setRename(selected?.name ?? "");
    setShowAccess(false);
    setMembers([]);
    setMoveTarget("");
  }, [selected?.id, selected?.name]);

  const childrenOf = useCallback(
    (parentId: string) =>
      nodes
        .filter((node) => {
          if (node.is_root) return false;
          const parent = nodesById.get(node.parent_id ?? "");
          const anchor = parent ? node.parent_id : root?.id;
          return anchor === parentId;
        })
        .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name)),
    [nodes, nodesById, root?.id]
  );

  const run = async (action: () => Promise<void>) => {
    setMessage("");
    try {
      await action();
      await load();
    } catch (error) {
      setMessage(errorMessage(error, t));
    }
  };

  const createNode = (nodeType: TWikiNodeType) => {
    const parent = selected?.node_type === "folder" && selected.can_create_child ? selected : root;
    if (!parent || !draftName.trim()) return;
    void run(async () => {
      await wikiService.create(workspaceSlug, { parent_id: parent.id, name: draftName.trim(), node_type: nodeType });
      setDraftName("");
    });
  };

  const openAccess = async () => {
    if (!selected) return;
    setShowAccess(true);
    try {
      setMembers(await wikiService.access(workspaceSlug, selected.id));
    } catch (error) {
      setMessage(errorMessage(error, t));
    }
  };

  const openTrash = async () => {
    setShowTrash(true);
    setShowArchive(false);
    setSearchResults(null);
    try {
      setTrash(await wikiService.trash(workspaceSlug));
    } catch (error) {
      setMessage(errorMessage(error, t));
    }
  };

  const renderNode = (node: TWikiNode, depth: number) => {
    const logo = wikiLogo(node.logo_props);
    return (
      <div key={node.id}>
        <Link
          to={`/${workspaceSlug}/wiki/${node.id}`}
          className={`flex items-center gap-2 rounded-md px-2 py-1 text-body-sm-regular hover:bg-layer-2 ${
            selected?.id === node.id ? "bg-layer-2" : ""
          }`}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          {logo && <Logo logo={logo} size={14} type="lucide" />}
          <span className="text-caption-sm-medium text-tertiary">
            {node.node_type === "folder" ? t("workspace_wiki.folder") : t("workspace_wiki.file")}
          </span>
          <span className="truncate">{node.name}</span>
        </Link>
        {childrenOf(node.id).map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  const destinations = selected
    ? nodes.filter(
        (node) =>
          node.node_type === "folder" &&
          node.can_create_child &&
          node.id !== selected.id &&
          !descendantIds(selected.id, nodes).has(node.id)
      )
    : [];

  return (
    <>
      <PageHead title={t("sidebar.wiki")} />
      <div className="flex h-full min-h-0 w-full">
        <aside className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-r border-subtle p-3">
          <div className="flex gap-2">
            <button
              type="button"
              className="text-caption-sm-medium text-tertiary"
              onClick={() => {
                setShowTrash(false);
                setShowArchive(false);
                setSearchResults(null);
              }}
            >
              {t("sidebar.wiki")}
            </button>
            <button type="button" className="text-caption-sm-medium text-tertiary" onClick={() => void openTrash()}>
              {t("workspace_wiki.trash")}
            </button>
            <button
              type="button"
              className="text-caption-sm-medium text-tertiary"
              onClick={() =>
                void wikiService.list(workspaceSlug, true).then((items) => {
                  setArchivedNodes(items);
                  setShowArchive(true);
                  setShowTrash(false);
                  setSearchResults(null);
                  return undefined;
                })
              }
            >
              {t("workspace_wiki.archive")}
            </button>
            <button
              type="button"
              className="text-caption-sm-medium text-tertiary"
              onClick={() =>
                void wikiService.recent(workspaceSlug).then((items) => {
                  setShowArchive(false);
                  setShowTrash(false);
                  setSearchResults(items);
                  return undefined;
                })
              }
            >
              {t("workspace_wiki.recent")}
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void wikiService.search(workspaceSlug, searchQuery).then((items) => {
                setSearchResults(items);
                setShowTrash(false);
                setShowArchive(false);
                return undefined;
              });
            }}
          >
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("workspace_wiki.search_placeholder")}
              className="h-8 w-full rounded-md border border-subtle bg-layer-1 px-2 text-body-sm-regular"
            />
          </form>
          {searchResults && (
            <div className="flex flex-col gap-1">
              {searchResults.length === 0 && (
                <p className="text-body-sm-regular text-tertiary">{t("workspace_wiki.no_results")}</p>
              )}
              {searchResults.map((node) => (
                <Link key={node.id} to={`/${workspaceSlug}/wiki/${node.id}`} className="truncate text-body-sm-regular">
                  {node.name}
                </Link>
              ))}
            </div>
          )}
          {showArchive ? (
            <div className="flex flex-col gap-2">
              {archivedNodes.map((node) => (
                <div key={node.id} className="flex items-center justify-between gap-2">
                  <Link to={`/${workspaceSlug}/wiki/${node.id}`} className="truncate text-body-sm-regular">
                    {node.name}
                  </Link>
                  {node.is_creator && (
                    <button
                      type="button"
                      className="text-caption-sm-medium"
                      onClick={() =>
                        void wikiService.updateState(workspaceSlug, node.id, { archived: false }).then(() => load())
                      }
                    >
                      {t("workspace_wiki.unarchive")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : showTrash ? (
            <div className="flex flex-col gap-2">
              {trash.length === 0 && (
                <p className="text-body-sm-regular text-tertiary">{t("workspace_wiki.no_trash")}</p>
              )}
              {trash.map((node) => (
                <div key={node.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-body-sm-regular">{node.name}</span>
                  <button
                    type="button"
                    className="text-caption-sm-medium"
                    onClick={() =>
                      void run(async () => {
                        await wikiService.restore(workspaceSlug, node.id);
                        setTrash(await wikiService.trash(workspaceSlug));
                      })
                    }
                  >
                    {t("workspace_wiki.restore")}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            root && renderNode(root, 0)
          )}
        </aside>
        <section
          className={`flex min-h-0 min-w-0 flex-1 flex-col ${
            selected && !missing && selected.node_type === "file" ? "overflow-hidden" : "gap-4 overflow-y-auto p-6"
          }`}
        >
          {loading && <p className="text-body-sm-regular text-tertiary">{t("workspace_wiki.loading")}</p>}
          {!loading && (missing || !selected) && (
            <p className="text-body-sm-regular">{t("workspace_wiki.not_found")}</p>
          )}
          {selected && !missing && selected.node_type === "file" && (
            <WikiDocument
              workspaceSlug={workspaceSlug}
              nodeId={selected.id}
              destinations={destinations.map((node) => ({ id: node.id, name: node.name }))}
              onChanged={load}
            />
          )}
          {selected && !missing && selected.node_type !== "file" && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {selected.is_creator && !selected.is_root && (
                  <WikiLogoControl
                    logo={selected.logo_props}
                    editable
                    onChange={(logo_props) => {
                      void run(() =>
                        wikiService.update(workspaceSlug, selected.id, { logo_props }).then(() => undefined)
                      );
                    }}
                  />
                )}
                <h1 className="text-heading-sm-medium">{selected.name}</h1>
                <span className="text-caption-sm-medium text-tertiary">
                  {selected.node_type === "folder" ? t("workspace_wiki.folder") : t("workspace_wiki.file")}
                </span>
              </div>
              {selected.archived_at && (
                <p className="text-body-sm-regular text-tertiary">{t("workspace_wiki.archived_banner")}</p>
              )}
              {selected.node_type === "folder" && selected.is_creator && !selected.is_root && (
                <button
                  type="button"
                  className="w-fit text-caption-sm-medium"
                  onClick={() =>
                    void run(() =>
                      wikiService
                        .updateState(workspaceSlug, selected.id, { archived: !selected.archived_at })
                        .then(() => undefined)
                    )
                  }
                >
                  {selected.archived_at ? t("workspace_wiki.unarchive") : t("workspace_wiki.archive")}
                </button>
              )}
              {selected.can_create_child && (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    createNode("folder");
                  }}
                >
                  <input
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    placeholder={t("workspace_wiki.name_placeholder")}
                    maxLength={255}
                    className="h-8 rounded-md border border-subtle bg-layer-1 px-2 text-body-sm-regular"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-accent-primary px-2 py-1 text-caption-sm-medium text-on-color"
                  >
                    {t("workspace_wiki.new_folder")}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-subtle px-2 py-1 text-caption-sm-medium"
                    onClick={() => createNode("file")}
                  >
                    {t("workspace_wiki.new_file")}
                  </button>
                </form>
              )}
              {selected.can_rename && (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!rename.trim()) return;
                    void run(() =>
                      wikiService.update(workspaceSlug, selected.id, { name: rename.trim() }).then(() => undefined)
                    );
                  }}
                >
                  <input
                    value={rename}
                    onChange={(event) => setRename(event.target.value)}
                    maxLength={255}
                    className="h-8 rounded-md border border-subtle bg-layer-1 px-2 text-body-sm-regular"
                  />
                  <button type="submit" className="text-caption-sm-medium">
                    {t("workspace_wiki.rename")}
                  </button>
                </form>
              )}
              {selected.can_move && (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!moveTarget) return;
                    void run(() =>
                      wikiService.update(workspaceSlug, selected.id, { parent_id: moveTarget }).then(() => undefined)
                    );
                  }}
                >
                  <select
                    value={moveTarget}
                    onChange={(event) => setMoveTarget(event.target.value)}
                    className="h-8 rounded-md border border-subtle bg-layer-1 px-2 text-body-sm-regular"
                  >
                    <option value="">{t("workspace_wiki.move_destination")}</option>
                    {destinations.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="text-caption-sm-medium">
                    {t("workspace_wiki.move")}
                  </button>
                </form>
              )}
              {selected.can_rename && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-caption-sm-medium"
                    onClick={() =>
                      void run(() =>
                        wikiService
                          .update(workspaceSlug, selected.id, { sort_order: selected.sort_order - 1 })
                          .then(() => undefined)
                      )
                    }
                  >
                    {t("workspace_wiki.sort_up")}
                  </button>
                  <button
                    type="button"
                    className="text-caption-sm-medium"
                    onClick={() =>
                      void run(() =>
                        wikiService
                          .update(workspaceSlug, selected.id, { sort_order: selected.sort_order + 1 })
                          .then(() => undefined)
                      )
                    }
                  >
                    {t("workspace_wiki.sort_down")}
                  </button>
                </div>
              )}
              {selected.can_delete && (
                <button
                  type="button"
                  className="w-fit text-caption-sm-medium text-danger-primary"
                  onClick={() => {
                    if (!window.confirm(t("workspace_wiki.delete"))) return;
                    void run(() => wikiService.remove(workspaceSlug, selected.id));
                  }}
                >
                  {t("workspace_wiki.delete")}
                </button>
              )}
              {selected.can_manage_access && (
                <div className="flex flex-col gap-2">
                  <button type="button" className="w-fit text-caption-sm-medium" onClick={() => void openAccess()}>
                    {t("workspace_wiki.permissions")}
                  </button>
                  {showAccess &&
                    members.map((member) => (
                      <label key={member.id} className="flex items-center justify-between gap-3">
                        <span className="truncate text-body-sm-regular">{member.display_name || member.email}</span>
                        <select
                          value={member.explicit_access ?? "inherit"}
                          className="h-8 rounded-md border border-subtle bg-layer-1 px-2 text-body-sm-regular"
                          onChange={(event) => {
                            const value = event.target.value;
                            const access = value === "inherit" ? null : (value as TWikiAccess);
                            void run(async () => {
                              await wikiService.updateAccess(workspaceSlug, selected.id, {
                                member_id: member.id,
                                access,
                              });
                              setMembers(await wikiService.access(workspaceSlug, selected.id));
                            });
                          }}
                        >
                          <option value="inherit">{t("workspace_wiki.access.inherit")}</option>
                          <option value="invisible">{t("workspace_wiki.access.invisible")}</option>
                          <option value="visible">{t("workspace_wiki.access.visible")}</option>
                          <option value="editable">{t("workspace_wiki.access.editable")}</option>
                        </select>
                      </label>
                    ))}
                </div>
              )}
              {selected.is_root && (
                <p className="text-body-sm-regular text-tertiary">{t("workspace_wiki.root_permissions")}</p>
              )}
              {selected.node_type === "folder" && childrenOf(selected.id).length === 0 && (
                <p className="text-body-sm-regular text-tertiary">{t("workspace_wiki.empty")}</p>
              )}
            </>
          )}
          {message && <p className="text-body-sm-regular text-danger-primary">{message}</p>}
        </section>
      </div>
    </>
  );
}
