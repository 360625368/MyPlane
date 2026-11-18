/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RichBlocks } from "./wiki-merge-rich";

vi.mock("@plane/editor", () => ({ getDocumentEditorHTMLFromJSON: vi.fn() }));

const htmlBlock = (html: string) => ({ type: "html", html });

describe("Wiki merge highlights", () => {
  const before = [
    htmlBlock("<p>原有内容 &amp; <code>API</code></p>"),
    htmlBlock("<h2>自定义 Wiki <strong>读写</strong></h2>"),
    htmlBlock("<p>后续内容</p>"),
  ];
  const after = [before[0], htmlBlock("<h2>自定义 Wiki <strong>读写123</strong></h2>"), before[2]];

  it("marks only the inserted characters within the changed heading", () => {
    const { container } = render(<RichBlocks blocks={after} base={before} />);

    expect(Array.from(container.querySelectorAll("mark"), (mark) => mark.textContent)).toEqual(["123"]);
    expect(container.querySelector("h2 strong mark")?.textContent).toBe("123");
  });

  it("renders unchanged content without marks and highlights a new block", () => {
    const { container, rerender } = render(<RichBlocks blocks={before} base={before} />);
    expect(container.querySelector("mark")).toBeNull();

    rerender(<RichBlocks blocks={[htmlBlock("<p>新增内容</p>")]} base={[]} />);
    expect(container.querySelector("mark")?.textContent).toBe("新增内容");
  });
});
