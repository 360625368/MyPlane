/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useRef, useState } from "react";
import type { EditorRefApi } from "@plane/editor";
import { PageToolbar } from "@/components/pages/editor/toolbar";
import { usePageFilters } from "@/hooks/use-page-filters";

type Props = {
  editorRef: EditorRefApi | null;
};

export function WikiEditorToolbar({ editorRef }: Props) {
  const { isStickyToolbarEnabled } = usePageFilters();
  if (!editorRef || !isStickyToolbarEnabled) return null;

  return (
    <div className="max-h-[52px] overflow-hidden border-b border-subtle">
      <div className="relative hidden min-h-[52px] items-center px-page-x md:flex">
        <div className="flex w-full max-w-full items-center">
          <div className="flex-1">
            <PageToolbar editorRef={editorRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function useWikiEditorRef() {
  const ref = useRef<EditorRefApi | null>(null);
  const [editor, setEditor] = useState<EditorRefApi | null>(null);
  const bindRef = useCallback((instance: EditorRefApi | null) => {
    ref.current = instance;
  }, []);
  const handleEditorReady = useCallback((ready: boolean) => {
    if (!ready) {
      setEditor(null);
      return;
    }
    window.setTimeout(() => setEditor((current) => current ?? ref.current), 0);
  }, []);

  return { editor, ref: bindRef, handleEditorReady };
}
