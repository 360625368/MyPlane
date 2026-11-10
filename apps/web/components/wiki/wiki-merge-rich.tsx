/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ImageOutline } from "@makeplane/propel/icons";
import { getDocumentEditorHTMLFromJSON } from "@plane/editor";

type Range = { start: number; end: number };
type Cursor = { offset: number };

const TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "col",
  "colgroup",
  "del",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "label",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
const VOID_TAGS = new Set(["br", "col", "hr"]);
const IMAGE_TAGS = new Set(["img", "image-component"]);
const TEXT_ALIGN = new Set(["left", "center", "right", "justify"]);

export const plainText = (node: unknown): string => {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return "";
  const record = node as { type?: string; html?: string; text?: string; content?: unknown[] };
  if (record.type === "html") return record.html || "";
  if (record.text) return String(record.text);
  return (record.content || []).map((child) => plainText(child)).join("");
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const isLegacyHtml = (block: object) => (block as { type?: string }).type === "html";

export const blocksHtml = (blocks: object[]): string => {
  if (blocks.length === 0) return "";
  if (!blocks.some(isLegacyHtml)) {
    try {
      return getDocumentEditorHTMLFromJSON({ type: "doc", content: blocks });
    } catch {
      // Fall through to per-block rendering for blocks the schema does not know.
    }
  }
  return blocks
    .map((block) => {
      if (isLegacyHtml(block)) return (block as { html?: string }).html || "";
      try {
        return getDocumentEditorHTMLFromJSON({ type: "doc", content: [block] });
      } catch {
        const text = escapeHtml(plainText(block));
        return text ? `<p>${text}</p>` : "";
      }
    })
    .join("");
};

const tokenize = (value: string) => {
  const words = value.split(/(\s+)/).filter((part) => part.length > 0);
  if (words.length > 1 && /\s/.test(value)) return words;
  return Array.from(value);
};

export const diffTokens = (base: string, text: string) => {
  const left = tokenize(base);
  const right = tokenize(text);
  if (left.length * right.length > 20000) return [{ text, changed: text !== base }];
  const scores: number[][] = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      scores[i][j] = left[i] === right[j] ? scores[i + 1][j + 1] + 1 : Math.max(scores[i + 1][j], scores[i][j + 1]);
    }
  }
  const changed = new Set<number>();
  let i = 0;
  let j = 0;
  while (j < right.length) {
    if (i < left.length && left[i] === right[j]) {
      i += 1;
      j += 1;
    } else if (i < left.length && scores[i + 1][j] >= scores[i][j + 1]) i += 1;
    else {
      changed.add(j);
      j += 1;
    }
  }
  const grouped: { text: string; changed: boolean }[] = [];
  right.forEach((part, index) => {
    const isChanged = changed.has(index);
    const last = grouped[grouped.length - 1];
    if (last && last.changed === isChanged) last.text += part;
    else grouped.push({ text: part, changed: isChanged });
  });
  return grouped;
};

const changedRanges = (base: string, text: string): Range[] => {
  if (!text || text === base) return [];
  const ranges: Range[] = [];
  let offset = 0;
  for (const part of diffTokens(base, text)) {
    if (part.changed) ranges.push({ start: offset, end: offset + part.text.length });
    offset += part.text.length;
  }
  return ranges;
};

const safeHref = (value: string | null) => {
  if (!value) return undefined;
  return /^(https?:|mailto:)/i.test(value.trim()) ? value : undefined;
};

const elementProps = (element: Element) => {
  const props: Record<string, unknown> = {};
  const className = element.getAttribute("class");
  if (className) props.className = className;
  for (const name of ["data-type", "data-checked", "data-text-color", "data-background-color", "data-block-type"]) {
    const value = element.getAttribute(name);
    if (value !== null) props[name] = value;
  }
  const align = (element as HTMLElement).style?.textAlign;
  if (align && TEXT_ALIGN.has(align)) props.style = { textAlign: align as CSSProperties["textAlign"] };
  for (const name of ["colspan", "rowspan"]) {
    const value = Number(element.getAttribute(name));
    if (Number.isInteger(value) && value > 1) props[name === "colspan" ? "colSpan" : "rowSpan"] = value;
  }
  if (element.tagName.toLowerCase() === "a") {
    props.href = safeHref(element.getAttribute("href"));
    props.target = "_blank";
    props.rel = "noopener noreferrer nofollow";
  }
  return props;
};

const paintText = (value: string, ranges: Range[], cursor: Cursor, tone: string, keyPrefix: string): ReactNode => {
  const start = cursor.offset;
  const end = start + value.length;
  cursor.offset = end;
  const hits = ranges.filter((range) => range.end > start && range.start < end);
  if (hits.length === 0) return value;
  const pieces: ReactNode[] = [];
  let position = start;
  for (const range of hits) {
    const from = Math.max(range.start, start);
    const to = Math.min(range.end, end);
    if (from > position) pieces.push(value.slice(position - start, from - start));
    pieces.push(
      <mark key={`${keyPrefix}-${from}`} className={`rounded-sm px-0.5 ${tone}`}>
        {value.slice(from - start, to - start)}
      </mark>
    );
    position = to;
  }
  if (position < end) pieces.push(value.slice(position - start));
  return pieces;
};

const renderDom = (node: Node, ranges: Range[], cursor: Cursor, tone: string, key: string): ReactNode => {
  if (node.nodeType === Node.TEXT_NODE) return paintText(node.textContent || "", ranges, cursor, tone, key);
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (IMAGE_TAGS.has(tag)) {
    return (
      <span key={key} className="inline-flex items-center rounded-sm bg-layer-3 p-1 align-middle text-tertiary">
        <ImageOutline className="size-4" />
      </span>
    );
  }
  if (tag === "input") {
    if (element.getAttribute("type") !== "checkbox") return null;
    return <input key={key} type="checkbox" checked={element.hasAttribute("checked")} disabled readOnly />;
  }
  const children = Array.from(element.childNodes).map((child, index) =>
    renderDom(child, ranges, cursor, tone, `${key}.${index}`)
  );
  if (!TAGS.has(tag)) return <span key={key}>{children}</span>;
  const props = { key, ...elementProps(element) };
  if (VOID_TAGS.has(tag)) return createVoid(tag, props);
  return createTag(tag, props, children);
};

const createVoid = (tag: string, props: Record<string, unknown>) => {
  const Tag = tag as "br";
  return <Tag {...props} />;
};

const createTag = (tag: string, props: Record<string, unknown>, children: ReactNode[]) => {
  const Tag = tag as "div";
  return <Tag {...props}>{children}</Tag>;
};

export function RichBlocks({
  blocks,
  base = "",
  conflict = false,
  className = "",
}: {
  blocks: object[];
  base?: string;
  conflict?: boolean;
  className?: string;
}) {
  const signature = JSON.stringify(blocks);
  const content = useMemo(() => {
    const parsed = JSON.parse(signature) as object[];
    const html = blocksHtml(parsed);
    if (!html) return null;
    const ranges = changedRanges(base, parsed.map((block) => plainText(block)).join(""));
    const tone = conflict ? "bg-danger-subtle text-danger-primary" : "bg-label-yellow-bg text-label-yellow-text";
    const body = new DOMParser().parseFromString(html, "text/html").body;
    const cursor = { offset: 0 };
    return Array.from(body.childNodes).map((child, index) => renderDom(child, ranges, cursor, tone, String(index)));
  }, [base, conflict, signature]);

  if (!content) return <span className="text-placeholder">—</span>;
  return (
    <div className={`editor-container small-font ${className}`}>
      <div className="wiki-merge-rich ProseMirror prose-brand font-default max-w-full text-primary prose [&_pre]:my-2 [&_pre]:rounded-lg [&_pre]:bg-layer-3 [&_pre]:p-3 [&_pre]:whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}
