/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { CopyOutline, TickOutline } from "@makeplane/propel/icons";
import { useState } from "react";
import { createRoot } from "react-dom/client";
// ui
import { IconButton } from "@makeplane/propel/components/icon-button";

export const CODE_BLOCK_CLASS_NAME = "code-block my-2 rounded-lg bg-layer-3 p-4 text-primary whitespace-pre-wrap";

function CodeBlockCopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <IconButton
      aria-label={copied ? "Copied code" : "Copy code"}
      variant="secondary"
      size="lg"
      icon={copied ? <TickOutline className="text-success-primary" /> : <CopyOutline />}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => void copyToClipboard(event)}
    />
  );
}

/**
 * The copy button floats over the code block from outside the editable DOM.
 * Anything rendered inside the pre (React node views, non-editable widgets)
 * lets IME composition text escape the code element, so typing Chinese
 * leaves the pinyin behind next to the committed characters.
 */
export const CodeBlockCopyButtonPlugin = (nodeName: string) =>
  new Plugin({
    key: new PluginKey("codeBlockCopyButton"),
    view(view) {
      const host = document.createElement("div");
      host.className = "absolute z-10 hidden";
      let target: HTMLElement | null = null;
      let hovering = false;

      const root = createRoot(host);
      root.render(<CodeBlockCopyButton getText={() => target?.textContent ?? ""} />);

      const parent = view.dom.parentElement;
      if (parent && getComputedStyle(parent).position === "static") parent.style.position = "relative";
      parent?.append(host);

      const selectedPre = (current: EditorView) => {
        const { $from } = current.state.selection;
        if ($from.parent.type.name !== nodeName) return null;
        const dom = current.nodeDOM($from.before());
        return dom instanceof HTMLElement ? dom : null;
      };

      const place = (pre: HTMLElement | null) => {
        target = pre;
        if (!pre || !parent || !view.dom.contains(pre)) {
          host.classList.add("hidden");
          return;
        }
        const box = parent.getBoundingClientRect();
        const rect = pre.getBoundingClientRect();
        host.style.top = `${rect.top - box.top + parent.scrollTop + 8}px`;
        host.style.left = `${rect.right - box.left + parent.scrollLeft - 8}px`;
        host.style.transform = "translateX(-100%)";
        host.classList.remove("hidden");
      };

      const onMove = (event: MouseEvent) => {
        if (hovering) return;
        const pre = event.target instanceof Element ? event.target.closest("pre") : null;
        place(pre instanceof HTMLElement && view.dom.contains(pre) ? pre : selectedPre(view));
      };
      const onLeave = (event: MouseEvent) => {
        if (event.relatedTarget instanceof Node && host.contains(event.relatedTarget)) return;
        place(selectedPre(view));
      };
      const onHostEnter = () => {
        hovering = true;
      };
      const onHostLeave = () => {
        hovering = false;
        place(selectedPre(view));
      };

      view.dom.addEventListener("mousemove", onMove);
      view.dom.addEventListener("mouseleave", onLeave);
      host.addEventListener("mouseenter", onHostEnter);
      host.addEventListener("mouseleave", onHostLeave);

      return {
        update(current) {
          if (hovering) return;
          if (target && current.dom.contains(target) && target.matches(":hover")) {
            place(target);
            return;
          }
          place(selectedPre(current));
        },
        destroy() {
          view.dom.removeEventListener("mousemove", onMove);
          view.dom.removeEventListener("mouseleave", onLeave);
          host.removeEventListener("mouseenter", onHostEnter);
          host.removeEventListener("mouseleave", onHostLeave);
          queueMicrotask(() => root.unmount());
          host.remove();
        },
      };
    },
  });
