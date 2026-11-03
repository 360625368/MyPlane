# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
from html import escape


def _blocks(description_json, description_html):
    content = []
    if isinstance(description_json, dict) and description_json.get("type") == "doc":
        content = description_json.get("content") or []
    elif isinstance(description_json, list):
        content = description_json
    blocks = [block for block in content if isinstance(block, dict)]
    if blocks:
        return blocks
    return [{"type": "html", "attrs": {"id": "html"}, "html": description_html or ""}]


def _keyed(blocks):
    seen = {}
    keyed = []
    for index, block in enumerate(blocks):
        attrs = block.get("attrs") if isinstance(block.get("attrs"), dict) else {}
        key = str(attrs.get("id") or f"index:{index}")
        count = seen.get(key, 0)
        seen[key] = count + 1
        if count:
            key = f"{key}#{count}"
        keyed.append((key, block))
    return keyed


def _insert(order, side_keys):
    present = set(order)
    result = list(order)
    pending = []
    for key in side_keys:
        if key in present:
            if pending:
                index = result.index(key)
                result[index:index] = pending
                present.update(pending)
                pending = []
        elif key not in present:
            pending.append(key)
    result.extend(pending)
    return result


def _canonical(block):
    if block is None:
        return None
    return json.dumps(block, sort_keys=True, default=str)


def _plain_text(node):
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if not isinstance(node, dict):
        return ""
    if node.get("type") == "html":
        return node.get("html") or ""
    if node.get("text"):
        return str(node.get("text"))
    return "".join(_plain_text(child) for child in node.get("content") or [])


def block_to_html(block):
    if block is None:
        return ""
    if block.get("type") == "html":
        return block.get("html") or ""
    text = escape(_plain_text(block))
    if block.get("type") == "heading":
        level = (block.get("attrs") or {}).get("level") or 1
        try:
            level = min(max(int(level), 1), 6)
        except (TypeError, ValueError):
            level = 1
        return f"<h{level}>{text}</h{level}>"
    if block.get("type") == "blockquote":
        return f"<blockquote><p>{text}</p></blockquote>"
    return f"<p>{text}</p>"


def document_html(blocks):
    return "".join(block_to_html(block) for block in blocks) or "<p></p>"


def plan_merge(baseline_json, baseline_html, current_json, current_html, draft_json, draft_html):
    """Three-way merge of top-level editor blocks. Overlapping edits stay unresolved."""
    base = dict(_keyed(_blocks(baseline_json, baseline_html)))
    current = dict(_keyed(_blocks(current_json, current_html)))
    draft = dict(_keyed(_blocks(draft_json, draft_html)))
    order = _insert(list(base), list(current))
    order = _insert(order, list(draft))
    blocks = []
    for key in order:
        base_block = base.get(key)
        current_block = current.get(key)
        draft_block = draft.get(key)
        base_key = _canonical(base_block)
        current_key = _canonical(current_block)
        draft_key = _canonical(draft_block)
        if current_key == draft_key:
            chosen = current_block
            conflict = False
        elif current_key == base_key:
            chosen = draft_block
            conflict = False
        elif draft_key == base_key:
            chosen = current_block
            conflict = False
        else:
            chosen = None
            conflict = True
        entry = {"id": key, "conflict": conflict, "block": chosen}
        if conflict:
            entry.update(
                {
                    "baseline": base_block,
                    "current": current_block,
                    "draft": draft_block,
                    "baseline_text": _plain_text(base_block),
                    "current_text": _plain_text(current_block),
                    "draft_text": _plain_text(draft_block),
                }
            )
        blocks.append(entry)
    resolved = [entry["block"] for entry in blocks if entry["block"] is not None and not entry["conflict"]]
    return {
        "blocks": blocks,
        "conflicts": [entry for entry in blocks if entry["conflict"]],
        "json": {"type": "doc", "content": resolved},
        "html": document_html(resolved),
    }


def apply_resolutions(plan, resolutions):
    """Return a document when every conflict block has a choice. Otherwise return None."""
    if not plan["conflicts"]:
        content = [entry["block"] for entry in plan["blocks"] if entry["block"] is not None]
        return {"type": "doc", "content": content}, document_html(content)
    choices = {}
    for item in resolutions or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        choice = item.get("choice")
        conflict = next((entry for entry in plan["conflicts"] if entry["id"] == item["id"]), None)
        if conflict is None:
            continue
        if choice == "current":
            choices[item["id"]] = conflict.get("current")
        elif choice == "draft":
            choices[item["id"]] = conflict.get("draft")
        elif choice == "custom" and isinstance(item.get("block"), dict):
            choices[item["id"]] = item["block"]
    if any(entry["id"] not in choices for entry in plan["conflicts"]):
        return None
    content = []
    for entry in plan["blocks"]:
        block = choices[entry["id"]] if entry["conflict"] else entry["block"]
        if block is not None:
            content.append(block)
    return {"type": "doc", "content": content}, document_html(content)
