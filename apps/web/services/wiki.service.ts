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
}

export type TWikiVersion = {
  id: string;
  owned_by: string;
  last_saved_at: string;
  description_html: string;
  description_json: object;
};
