/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { EFileAssetType } from "@plane/types";
import { FileService } from "@/services/file.service";

const fileService = new FileService();

export async function uploadWikiImage(workspaceSlug: string, nodeId: string, file: File): Promise<string> {
  const { asset_id } = await fileService.uploadWorkspaceAsset(
    workspaceSlug,
    { entity_type: EFileAssetType.WIKI_DESCRIPTION, entity_identifier: nodeId },
    file
  );
  return asset_id;
}
