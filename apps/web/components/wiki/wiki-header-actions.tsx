/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

const WikiHeaderActionsContext = createContext<ReactNode>(null);
const SetWikiHeaderActionsContext = createContext<(actions: ReactNode) => void>(() => undefined);

export function WikiHeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  return (
    <SetWikiHeaderActionsContext.Provider value={setActions}>
      <WikiHeaderActionsContext.Provider value={actions}>{children}</WikiHeaderActionsContext.Provider>
    </SetWikiHeaderActionsContext.Provider>
  );
}

export function useWikiHeaderActions() {
  return useContext(WikiHeaderActionsContext);
}

export function useSetWikiHeaderActions() {
  return useContext(SetWikiHeaderActionsContext);
}
