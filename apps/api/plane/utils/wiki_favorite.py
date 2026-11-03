# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import UUID

from plane.db.models import WikiNode, WikiNodePermission
from plane.utils.wiki_access import can_view, resolve_access


def _node_id(value):
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def visible_wiki_favorite(node_id, user_id, workspace_id):
    """Return name and icon when the member can view the file or folder."""
    target_id = _node_id(node_id)
    if target_id is None:
        return None

    nodes = list(WikiNode.objects.filter(workspace_id=workspace_id))
    nodes_by_id = {node.id: node for node in nodes}
    node = nodes_by_id.get(target_id)
    if node is None or node.is_root:
        return None

    explicit = {}
    grants = WikiNodePermission.objects.filter(workspace_id=workspace_id).values("node_id", "member_id", "access")
    for permission in grants:
        explicit[(permission["node_id"], permission["member_id"])] = permission["access"]

    lineage = []
    current = node
    while current is not None:
        lineage.append(current)
        current = nodes_by_id.get(current.parent_id) if current.parent_id else None
    lineage.reverse()
    access = resolve_access(
        [
            {
                "is_root": item.is_root,
                "owned_by_id": item.owned_by_id,
                "user_id": user_id,
                "explicit": explicit.get((item.id, user_id)),
            }
            for item in lineage
        ]
    )
    if not can_view(access):
        return None
    return {"id": str(node.id), "name": node.name, "logo_props": node.logo_props}
