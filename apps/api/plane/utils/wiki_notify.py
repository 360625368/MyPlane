# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from plane.db.models import Notification, WikiChangeRequest
from plane.utils.wiki_favorite import visible_wiki_favorite


def notify_wiki(workspace, node, receiver_id, triggered_by, field):
    """Record one in-app notice when the receiver can still view the node."""
    if receiver_id is None or triggered_by is None:
        return None
    if str(receiver_id) == str(triggered_by.id):
        return None
    if visible_wiki_favorite(node.id, receiver_id, workspace.id) is None:
        return None

    return Notification.objects.create(
        workspace=workspace,
        sender="in_app:wiki",
        triggered_by=triggered_by,
        receiver_id=receiver_id,
        entity_identifier=node.id,
        entity_name="wiki",
        title=node.name,
        data={
            "wiki": {
                "field": field,
                "node_id": str(node.id),
                "name": node.name,
            }
        },
    )


def notify_open_change_authors(workspace, node, triggered_by, field):
    author_ids = (
        WikiChangeRequest.objects.filter(node=node, status__in=WikiChangeRequest.OPEN_STATUSES)
        .values_list("owned_by_id", flat=True)
        .distinct()
    )
    for author_id in author_ids:
        notify_wiki(workspace, node, author_id, triggered_by, field)
