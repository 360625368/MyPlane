/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Outlet } from "react-router";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { WikiHeader } from "@/components/wiki/wiki-explorer";
import { WikiHeaderActionsProvider } from "@/components/wiki/wiki-header-actions";

export default function WorkspaceWikiLayout() {
  return (
    <WikiHeaderActionsProvider>
      <AppHeader header={<WikiHeader />} />
      <ContentWrapper>
        <Outlet />
      </ContentWrapper>
    </WikiHeaderActionsProvider>
  );
}
