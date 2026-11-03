/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type TWikiAccess = "invisible" | "visible" | "editable";
export type TWikiNodeType = "folder" | "file";

export type TWikiNode = {
  id: string;
  parent_id: string | null;
  name: string;
  node_type: TWikiNodeType;
  is_root: boolean;
  sort_order: number;
  owned_by: string | null;
  access: TWikiAccess;
  is_creator: boolean;
  can_delete: boolean;
  can_manage_access: boolean;
  can_rename: boolean;
  can_move: boolean;
  can_create_child: boolean;
  is_locked: boolean;
  archived_at: string | null;
  logo_props: Record<string, unknown>;
  color: string;
  view_props: { full_width?: boolean };
  can_edit_body: boolean;
  description_html?: string;
  description_json?: object;
};

export type TWikiTrashNode = {
  id: string;
  parent_id: string | null;
  name: string;
  node_type: TWikiNodeType;
  deleted_at: string;
};

export type TWikiMemberAccess = {
  id: string;
  display_name: string;
  email: string;
  explicit_access: TWikiAccess | null;
  effective_access: TWikiAccess;
};

export class WikiService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async list(workspaceSlug: string, archived = false): Promise<TWikiNode[]> {
    const suffix = archived ? "?archived=1" : "";
    return this.get(`/api/workspaces/${workspaceSlug}/wiki/nodes/${suffix}`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async retrieve(workspaceSlug: string, nodeId: string): Promise<TWikiNode> {
    return this.get(`/api/workspaces/${workspaceSlug}/wiki/nodes/${nodeId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async create(
    workspaceSlug: string,
    data: { parent_id: string; name: string; node_type: TWikiNodeType }
  ): Promise<TWikiNode> {
    return this.post(`/api/workspaces/${workspaceSlug}/wiki/nodes/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(
    workspaceSlug: string,
    nodeId: string,
    data: Partial<Pick<TWikiNode, "name" | "parent_id" | "sort_order" | "color" | "logo_props" | "view_props">>
  ): Promise<TWikiNode> {
    return this.patch(`/api/workspaces/${workspaceSlug}/wiki/nodes/${nodeId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async remove(workspaceSlug: string, nodeId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/wiki/nodes/${nodeId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async restore(workspaceSlug: string, nodeId: string): Promise<TWikiNode> {
    return this.post(`/api/workspaces/${workspaceSlug}/wiki/nodes/${nodeId}/restore/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async trash(workspaceSlug: string): Promise<TWikiTrashNode[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/wiki/trash/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async access(workspaceSlug: string, nodeId: string): Promise<TWikiMemberAccess[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/wiki/nodes/${nodeId}/access/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateAccess(
    workspaceSlug: string,
    nodeId: string,
    data: { member_id: string; access: TWikiAccess | null }
  ): Promise<void> {
    return this.put(`/api/workspaces/${workspaceSlug}/wiki/nodes/${nodeId}/access/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async saveDescription(
    workspaceSlug: string,
    nodeId: string,
    data: { description_html: string; description_json: object }
  ): Promise<TWikiNode> {
    return this.patch(`/api/workspaces/${workspaceSlug}/wiki/nodes/${nodeId}/description/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async versions(workspaceSlug: string, nodeId: string): Promise<TWikiVersion[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/wiki/nodes/${nodeId}/versions/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async restoreVersion(workspaceSlug: string, nodeId: string, versionId: string): Promise<TWikiNode> {
    return this.post(`/api/workspaces/${workspaceSlug}/wiki/nodes/${nodeId}/versions/`, { version_id: versionId })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateState(
    workspaceSlug: string,
    nodeId: string,
    data: { is_locked?: boolean; archived?: boolean }
  ): Promise<TWikiNode> {
    return this.post(`/api/workspaces/${workspaceSlug}/wiki/nodes/${nodeId}/state/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async duplicate(workspaceSlug: string, nodeId: string): Promise<TWikiNode> {
    return this.post(`/api/workspaces/${workspaceSlug}/wiki/nodes/${nodeId}/duplicate/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async search(workspaceSlug: string, query: string): Promise<TWikiNode[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/wiki/search/`, { params: { q: query } })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async recent(workspaceSlug: string): Promise<TWikiNode[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/wiki/recent/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async listChanges(workspaceSlug: string, nodeId: string): Promise<TWikiChange[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/wiki/nodes/${nodeId}/changes/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async openChange(workspaceSlug: string, nodeId: string): Promise<TWikiChange> {
    return this.post(`/api/workspaces/${workspaceSlug}/wiki/nodes/${nodeId}/changes/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async saveChange(
    workspaceSlug: string,
    nodeId: string,
    changeId: string,
    data: { description_html: string; description_json: object }
  ): Promise<TWikiChange> {
    return this.patch(`/api/workspaces/${workspaceSlug}/wiki/nodes/${nodeId}/changes/${changeId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async actOnChange(
    workspaceSlug: string,
    nodeId: string,
    changeId: string,
    action: "submit" | "withdraw" | "close" | "return" | "merge",
    extra?: {
      comment?: string;
      resolutions?: { id: string; choice: "current" | "draft" | "custom"; block?: object }[];
      description_html?: string;
      description_json?: object;
    }
  ): Promise<TWikiChange> {
    return this.post(`/api/workspaces/${workspaceSlug}/wiki/nodes/${nodeId}/changes/${changeId}/`, {
      action,
      ...extra,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}

export type TWikiVersion = {
  id: string;
  owned_by: string;
  last_saved_at: string;
  description_html: string;
  description_json: object;
  change_request?: string | null;
};

export type TWikiChangeStatus = "draft" | "in_review" | "changes_requested" | "conflict" | "merged" | "closed";

export type TWikiMergeBlock = {
  id: string;
  conflict: boolean;
  block: object | null;
  baseline?: object | null;
  current?: object | null;
  draft?: object | null;
  baseline_text?: string;
  current_text?: string;
  draft_text?: string;
};

export type TWikiMergePlan = {
  blocks: TWikiMergeBlock[];
  conflicts: TWikiMergeBlock[];
  json: object;
  html: string;
};

export type TWikiChange = {
  id: string;
  node_id: string;
  owned_by: string;
  author_name: string;
  status: TWikiChangeStatus;
  review_comment: string;
  description_html: string;
  description_json: object;
  can_edit: boolean;
  can_submit: boolean;
  can_withdraw: boolean;
  can_close: boolean;
  can_return: boolean;
  can_merge: boolean;
  merge_plan: TWikiMergePlan | null;
};
