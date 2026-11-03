# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Effective Wiki access for one member on one node.

The chain is ordered from the workspace root to the node itself. Each entry
carries the explicit grant for that member, if one exists. The root is editable
for every non-guest workspace member, but that access is not inherited. A node
without an explicit grant stays invisible unless a nearer ancestor has one.
A creator can always edit their own node. An invisible ancestor hides the rest
of the branch, and a child grant cannot raise a member above the access they
already have on the parent.
"""

INVISIBLE = "invisible"
VISIBLE = "visible"
EDITABLE = "editable"

ACCESS_LEVELS = (INVISIBLE, VISIBLE, EDITABLE)


def _is_creator(node):
    return node["owned_by_id"] is not None and str(node["owned_by_id"]) == str(node["user_id"])


def _clamp(explicit, parent_access):
    """Keep a grant from widening the access already held on the parent."""
    if explicit == INVISIBLE or parent_access == INVISIBLE:
        return INVISIBLE
    if explicit == EDITABLE and parent_access != EDITABLE:
        return parent_access
    return explicit


def resolve_access(chain):
    """Return the effective access for a member along ``chain``.

    ``chain`` items are mappings with ``is_root``, ``owned_by_id``, ``user_id``
    and ``explicit`` (one of the access levels, or None).
    """
    current = INVISIBLE
    inherited = None
    for node in chain:
        if node["is_root"]:
            current = EDITABLE
            inherited = None
            continue

        explicit = node.get("explicit")
        parent_access = current
        if _is_creator(node):
            current = EDITABLE
            if parent_access == INVISIBLE:
                inherited = INVISIBLE
            elif explicit is not None:
                inherited = _clamp(explicit, parent_access)
            continue

        if parent_access == INVISIBLE:
            current = INVISIBLE
            inherited = INVISIBLE
            continue

        if explicit is None:
            current = inherited if inherited is not None else INVISIBLE
            if current == EDITABLE and parent_access != EDITABLE:
                current = parent_access
            if current == INVISIBLE:
                inherited = INVISIBLE
            continue

        current = _clamp(explicit, parent_access)
        inherited = current
    return current


def can_view(access):
    return access in (VISIBLE, EDITABLE)


def can_create_child(access):
    return access == EDITABLE
