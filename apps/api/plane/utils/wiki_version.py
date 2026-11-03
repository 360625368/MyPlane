# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.utils import timezone

from plane.db.models import WikiChangeRequest, WikiNodeVersion
from plane.utils.wiki_merge import plan_merge

VERSION_COALESCE_SECONDS = 600
VERSION_LIMIT = 20


def mark_conflicting_change_requests(node):
    """Leave open drafts intact. Mark a request only when the same block changed on both sides."""
    reviews = WikiChangeRequest.objects.filter(
        node=node,
        status__in=(
            WikiChangeRequest.DRAFT,
            WikiChangeRequest.IN_REVIEW,
            WikiChangeRequest.CHANGES_REQUESTED,
            WikiChangeRequest.CONFLICT,
        ),
    )
    for change in reviews:
        if change.baseline_html == node.description_html:
            if change.status == WikiChangeRequest.CONFLICT:
                change.status = WikiChangeRequest.IN_REVIEW
                change.save(update_fields=["status", "updated_at"])
            continue
        plan = plan_merge(
            change.baseline_json,
            change.baseline_html,
            node.description_json,
            node.description_html,
            change.description_json,
            change.description_html,
        )
        if plan["conflicts"] and change.status != WikiChangeRequest.CONFLICT:
            change.status = WikiChangeRequest.CONFLICT
            change.save(update_fields=["status", "updated_at"])
        elif not plan["conflicts"] and change.status == WikiChangeRequest.CONFLICT:
            change.status = WikiChangeRequest.IN_REVIEW
            change.save(update_fields=["status", "updated_at"])


def record_wiki_version(node, previous_html, user_id, change_request=None):
    """Keep a published-body snapshot, coalescing the same author's recent saves."""
    if previous_html == node.description_html:
        return None
    latest = WikiNodeVersion.objects.filter(node=node).order_by("-last_saved_at").first()
    if (
        change_request is None
        and latest
        and str(latest.owned_by_id) == str(user_id)
        and (timezone.now() - latest.last_saved_at).total_seconds() <= VERSION_COALESCE_SECONDS
    ):
        latest.description_html = node.description_html
        latest.description_json = node.description_json
        latest.description_stripped = node.description_stripped
        latest.save(update_fields=["description_html", "description_json", "description_stripped", "updated_at"])
        return latest

    version = WikiNodeVersion.objects.create(
        workspace_id=node.workspace_id,
        node=node,
        owned_by_id=user_id,
        description_html=node.description_html,
        description_json=node.description_json,
        description_stripped=node.description_stripped,
        last_saved_at=timezone.now(),
        change_request=change_request,
    )
    overflow = WikiNodeVersion.objects.filter(node=node).order_by("-last_saved_at")[VERSION_LIMIT:]
    for stale in overflow:
        stale.delete()
    return version
