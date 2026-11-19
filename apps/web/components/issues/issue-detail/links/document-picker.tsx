/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Select, SelectTrigger, SelectContent, SelectList, SelectItem } from "@makeplane/propel/components/select";
import { InputField } from "@makeplane/propel/components/input-field";
import { useTranslation } from "@plane/i18n";
import { useProject } from "@/hooks/store/use-project";
import { WikiService } from "@/services/wiki.service";
import { ProjectPageService } from "@/services/page/project-page.service";

const wikiService = new WikiService();
const pageService = new ProjectPageService();

export const DocumentLinkPicker = observer(function DocumentLinkPicker({
  kind,
  onSelect,
}: {
  kind: "wiki" | "page";
  onSelect: (title: string, url: string) => void;
}) {
  const { workspaceSlug, projectId } = useParams();
  const workspace = workspaceSlug?.toString() ?? "";
  const { t } = useTranslation();
  const { workspaceProjectIds, getProjectById } = useProject();
  const [project, setProject] = useState(projectId?.toString() ?? "");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setItems([]);
    setLoading(false);
    setFailed(false);
    if (!workspace || (kind === "page" && !project)) return;
    setLoading(true);
    const load = async () => {
      try {
        const results =
          kind === "wiki"
            ? (await wikiService.list(workspace)).filter((node) => node.node_type === "file" && !node.archived_at)
            : await pageService.fetchAll(workspace, project);
        if (active) setItems(results.flatMap((item) => (item.id ? [{ id: item.id, name: item.name || "" }] : [])));
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [kind, workspace, project, retry]);

  const visible = items.filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return (
    <div className="space-y-3">
      {kind === "page" && (
        <div className="flex flex-col gap-1 text-body-sm-medium">
          <label htmlFor="link-document-project">{t("common.project")}</label>
          <Select<string>
            value={project || null}
            onValueChange={(value) => setProject(value ?? "")}
            items={workspaceProjectIds?.map((id) => ({ value: id, label: getProjectById(id)?.name ?? id }))}
          >
            <SelectTrigger id="link-document-project" size="md" placeholder={t("common.select")} />
            <SelectContent>
              <SelectList>
                {workspaceProjectIds?.map((id) => (
                  <SelectItem key={id} value={id} size="md" label={getProjectById(id)?.name ?? id} />
                ))}
              </SelectList>
            </SelectContent>
          </Select>
        </div>
      )}
      <InputField
        size="md"
        orientation="vertical"
        label={t("search")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="max-h-56 overflow-y-auto rounded-md border border-subtle p-1">
        {loading && (
          <p role="status" className="p-2 text-body-sm-regular text-tertiary">
            {t("workspace_wiki.loading")}
          </p>
        )}
        {failed && (
          <button
            type="button"
            className="w-full rounded p-2 text-left text-danger-primary"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("workspace_wiki.comments.error")} {t("workspace_wiki.comments.retry")}
          </button>
        )}
        {!loading && !failed && visible.length === 0 && (
          <p className="p-2 text-body-sm-regular text-tertiary">{t("workspace_wiki.no_results")}</p>
        )}
        {!loading &&
          !failed &&
          visible.map((item) => (
            <button
              key={item.id}
              type="button"
              className="block w-full truncate rounded px-3 py-2 text-left text-body-sm-regular hover:bg-layer-transparent-hover"
              onClick={() => {
                const path =
                  kind === "wiki"
                    ? `/${workspace}/wiki/${item.id}`
                    : `/${workspace}/projects/${project}/pages/${item.id}`;
                onSelect(item.name, new URL(path, window.location.origin).href);
              }}
            >
              {item.name}
            </button>
          ))}
      </div>
    </div>
  );
});
