/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { WikiExplorer } from "@/components/wiki/wiki-explorer";

type WikiPageProps = {
  params: {
    workspaceSlug: string;
    nodeId?: string;
  };
};

export default function WorkspaceWikiPage({ params }: WikiPageProps) {
  return <WikiExplorer workspaceSlug={params.workspaceSlug} nodeId={params.nodeId} />;
}
