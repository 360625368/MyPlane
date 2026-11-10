/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { NodeViewRendererProps } from "@tiptap/core";
import { CopyOutline, TickOutline } from "@makeplane/propel/icons";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
// ui
import { IconButton } from "@makeplane/propel/components/icon-button";

type CopyButtonProps = {
  getText: () => string;
};

function CodeBlockCopyButton({ getText }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async (event: React.MouseEvent<HTMLButtonElement>) => {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {
      setCopied(false);
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <IconButton
      aria-label={copied ? "Copied code" : "Copy code"}
      variant="secondary"
      size="lg"
      icon={copied ? <TickOutline className="text-success-primary" /> : <CopyOutline />}
      onClick={(event) => void copyToClipboard(event)}
    />
  );
}

/**
 * The node DOM is the pre itself. A wrapper div around pre makes the browser
 * turn the block into a plain paragraph on the first keystroke.
 * The copy button stays outside React's content tree so deleting the block
 * does not make React remove a DOM node ProseMirror already detached.
 */
export function codeBlockNodeView({ node }: NodeViewRendererProps) {
  let current = node;
  let root: Root | null = null;

  const dom = document.createElement("pre");
  dom.className = "code-block group/code relative my-2 rounded-lg bg-layer-3 p-4 text-primary whitespace-pre-wrap";

  const buttonHost = document.createElement("div");
  buttonHost.contentEditable = "false";
  buttonHost.className =
    "pointer-events-none absolute top-2 right-2 z-10 opacity-0 transition-opacity group-focus-within/code:pointer-events-auto group-focus-within/code:opacity-100 group-hover/code:pointer-events-auto group-hover/code:opacity-100";

  const contentDOM = document.createElement("code");
  contentDOM.className = "whitespace-pre-wrap";

  dom.append(buttonHost, contentDOM);

  const getText = () => current.textContent;
  root = createRoot(buttonHost);
  root.render(<CodeBlockCopyButton getText={getText} />);

  return {
    dom,
    contentDOM,
    update(updated: typeof node) {
      if (updated.type !== current.type) return false;
      current = updated;
      return true;
    },
    ignoreMutation(mutation: MutationRecord | { target: Node }) {
      return mutation.target === buttonHost || buttonHost.contains(mutation.target);
    },
    stopEvent(event: Event) {
      const target = event.target;
      return target instanceof globalThis.Node && (target === buttonHost || buttonHost.contains(target));
    },
    destroy() {
      root?.unmount();
      root = null;
    },
  };
}
