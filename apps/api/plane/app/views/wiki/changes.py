# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import WikiChangeRequest, WikiNode, WikiNodeVersion
from plane.utils.content_validator import validate_html_content
from plane.utils.wiki_access import EDITABLE
from plane.utils.wiki_merge import apply_resolutions, plan_merge
from plane.utils.wiki_notify import notify_wiki
from plane.utils.wiki_version import mark_conflicting_change_requests, record_wiki_version

from .base import WikiMemberPermission, _is_creator, _not_found, _workspace_or_404
from .document import _creator_can_publish, _file_for_reading


def _notify_change(action, workspace, node, change, user):
    if action == "submit":
        notify_wiki(workspace, node, node.owned_by_id, user, "submitted")
    elif action == "return":
        notify_wiki(workspace, node, change.owned_by_id, user, "returned")
    elif action == "merge":
        notify_wiki(workspace, node, change.owned_by_id, user, "merged")
    elif action == "close":
        notify_wiki(workspace, node, change.owned_by_id, user, "closed")


def _clean_description(data):
    html = data.get("description_html", "<p></p>") or "<p></p>"
    valid, message, clean_html = validate_html_content(html)
    if not valid:
        return None, None, Response({"error": message or "invalid"}, status=status.HTTP_400_BAD_REQUEST)
    description_json = data.get("description_json", {})
    if description_json is None:
        description_json = {}
    if not isinstance(description_json, (dict, list)):
        return None, None, Response({"error": "invalid"}, status=status.HTTP_400_BAD_REQUEST)
    return clean_html or "<p></p>", description_json, None


def _author_can_edit(node, user, access):
    return access == EDITABLE and not _is_creator(node, user) and not node.is_locked and not node.archived_at


def _load_request(node, user, change_id):
    change = WikiChangeRequest.objects.filter(node=node, id=change_id).select_related("owned_by").first()
    if change is None:
        return None
    if _is_creator(node, user) or change.owned_by_id == user.id:
        return change
    return None


def _merge_plan(change, node):
    return plan_merge(
        change.baseline_json,
        change.baseline_html,
        node.description_json,
        node.description_html,
        change.description_json,
        change.description_html,
    )


def _merged_details(changes):
    """Historical before/after for merged requests, using the published version when it still exists."""
    merged = [change for change in changes if change.status == WikiChangeRequest.MERGED]
    if not merged:
        return {}
    versions = WikiNodeVersion.objects.filter(change_request_id__in=[change.id for change in merged]).order_by(
        "-last_saved_at"
    )
    after_by_change = {}
    for version in versions:
        after_by_change.setdefault(version.change_request_id, version)
    history = WikiNodeVersion.objects.filter(node_id__in={change.node_id for change in merged}).order_by(
        "-last_saved_at"
    )
    by_node = {}
    for version in history:
        by_node.setdefault(version.node_id, []).append(version)
    details = {}
    for change in merged:
        after = after_by_change.get(change.id)
        if after is None:
            before_json, before_html = change.baseline_json, change.baseline_html
            after_json, after_html = change.description_json, change.description_html
        else:
            previous = next(
                (
                    version
                    for version in by_node.get(change.node_id, [])
                    if version.id != after.id and version.last_saved_at < after.last_saved_at
                ),
                None,
            )
            before_json = previous.description_json if previous else change.baseline_json
            before_html = previous.description_html if previous else change.baseline_html
            after_json, after_html = after.description_json, after.description_html
        details[change.id] = plan_merge(
            before_json,
            before_html,
            before_json,
            before_html,
            after_json,
            after_html,
        )
    return details


def _serialize_change(change, node, user, access, merge_detail=None):
    author = change.owned_by_id == user.id
    creator = _is_creator(node, user)
    editable_author = author and _author_can_edit(node, user, access)
    editable_statuses = (WikiChangeRequest.DRAFT, WikiChangeRequest.CHANGES_REQUESTED)
    open_status = change.status in WikiChangeRequest.OPEN_STATUSES
    publishable = creator and not node.is_locked and not node.archived_at
    merge_plan = _merge_plan(change, node) if publishable or author else None
    return {
        "id": str(change.id),
        "node_id": str(node.id),
        "owned_by": str(change.owned_by_id),
        "author_name": change.owned_by.display_name or change.owned_by.email,
        "status": change.status,
        "review_comment": change.review_comment,
        "description_html": change.description_html,
        "description_json": change.description_json,
        "submitted_at": change.submitted_at,
        "updated_at": change.updated_at,
        "can_edit": editable_author and change.status in editable_statuses,
        "can_submit": editable_author and change.status in editable_statuses,
        "can_withdraw": author and change.status == WikiChangeRequest.IN_REVIEW,
        "can_close": (author or creator) and open_status,
        "can_return": publishable and change.status in (WikiChangeRequest.IN_REVIEW, WikiChangeRequest.CONFLICT),
        "can_merge": publishable and change.status in (WikiChangeRequest.IN_REVIEW, WikiChangeRequest.CONFLICT),
        "merge_plan": merge_plan,
        "merge_detail": merge_detail,
    }


class WikiChangeRequestEndpoint(BaseAPIView):
    permission_classes = [WikiMemberPermission]

    def get(self, request, slug, node_id):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        node, access, _, _ = _file_for_reading(workspace, request.user, node_id)
        if node is None:
            return _not_found()
        changes = WikiChangeRequest.objects.filter(node=node).select_related("owned_by")
        if not _is_creator(node, request.user):
            changes = changes.filter(owned_by=request.user)
        changes = list(changes[:50])
        details = _merged_details(changes)
        return Response(
            [_serialize_change(change, node, request.user, access, details.get(change.id)) for change in changes],
            status=status.HTTP_200_OK,
        )

    def post(self, request, slug, node_id):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        node, access, _, _ = _file_for_reading(workspace, request.user, node_id)
        if node is None:
            return _not_found()
        if _is_creator(node, request.user) or access != EDITABLE:
            return Response({"error": "forbidden"}, status=status.HTTP_403_FORBIDDEN)
        if node.is_locked:
            return Response({"error": "locked"}, status=status.HTTP_400_BAD_REQUEST)
        if node.archived_at:
            return Response({"error": "archived"}, status=status.HTTP_400_BAD_REQUEST)

        existing = (
            WikiChangeRequest.objects.filter(
                node=node,
                owned_by=request.user,
                status__in=WikiChangeRequest.OPEN_STATUSES,
            )
            .select_related("owned_by")
            .first()
        )
        if existing:
            return Response(_serialize_change(existing, node, request.user, access), status=status.HTTP_200_OK)

        change = WikiChangeRequest.objects.create(
            workspace=workspace,
            node=node,
            owned_by=request.user,
            status=WikiChangeRequest.DRAFT,
            baseline_html=node.description_html,
            baseline_json=node.description_json,
            description_html=node.description_html,
            description_json=node.description_json,
        )
        change = WikiChangeRequest.objects.select_related("owned_by").get(id=change.id)
        return Response(_serialize_change(change, node, request.user, access), status=status.HTTP_201_CREATED)


class WikiChangeRequestDetailEndpoint(BaseAPIView):
    permission_classes = [WikiMemberPermission]

    def patch(self, request, slug, node_id, change_id):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        node, access, _, _ = _file_for_reading(workspace, request.user, node_id)
        if node is None:
            return _not_found()
        change = _load_request(node, request.user, change_id)
        if change is None:
            return _not_found()
        if not _serialize_change(change, node, request.user, access)["can_edit"]:
            return Response({"error": "forbidden"}, status=status.HTTP_403_FORBIDDEN)
        html, description_json, invalid = _clean_description(request.data)
        if invalid:
            return invalid
        change.description_html = html
        change.description_json = description_json
        change.save()
        return Response(_serialize_change(change, node, request.user, access), status=status.HTTP_200_OK)

    def post(self, request, slug, node_id, change_id):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        node, access, _, _ = _file_for_reading(workspace, request.user, node_id)
        if node is None or node.node_type != WikiNode.FILE:
            return _not_found()
        change = _load_request(node, request.user, change_id)
        if change is None:
            return _not_found()
        action = request.data.get("action")
        payload = _serialize_change(change, node, request.user, access)
        if action == "submit" and payload["can_submit"]:
            change.status = WikiChangeRequest.IN_REVIEW
            change.submitted_at = timezone.now()
        elif action == "withdraw" and payload["can_withdraw"]:
            change.status = WikiChangeRequest.DRAFT
        elif action == "close" and payload["can_close"]:
            change.status = WikiChangeRequest.CLOSED
            change.closed_at = timezone.now()
        elif action == "return" and payload["can_return"]:
            comment = (request.data.get("comment") or "").strip()
            if not comment:
                return Response({"error": "invalid"}, status=status.HTTP_400_BAD_REQUEST)
            change.status = WikiChangeRequest.CHANGES_REQUESTED
            change.review_comment = comment[:4000]
        elif (
            action == "merge"
            and _is_creator(node, request.user)
            and change.status
            in (
                WikiChangeRequest.IN_REVIEW,
                WikiChangeRequest.CONFLICT,
            )
        ):
            blocked = _creator_can_publish(node, request.user)
            if blocked:
                return blocked
            edited_html, edited_json, invalid = (None, None, None)
            if "description_html" in request.data and "description_json" in request.data:
                edited_html, edited_json, invalid = _clean_description(request.data)
                if invalid:
                    return invalid
            if change.baseline_html == node.description_html:
                merged_html = edited_html if edited_html is not None else change.description_html
                merged_json = edited_json if edited_json is not None else change.description_json
            else:
                plan = plan_merge(
                    change.baseline_json,
                    change.baseline_html,
                    node.description_json,
                    node.description_html,
                    change.description_json,
                    change.description_html,
                )
                if plan["conflicts"]:
                    applied = apply_resolutions(plan, request.data.get("resolutions"))
                    if applied is None:
                        if change.status != WikiChangeRequest.CONFLICT:
                            change.status = WikiChangeRequest.CONFLICT
                            change.save(update_fields=["status", "updated_at"])
                        return Response({"error": "conflict", "merge_plan": plan}, status=status.HTTP_409_CONFLICT)
                    merged_json, merged_html = applied
                    if edited_html is not None:
                        merged_html, merged_json = edited_html, edited_json
                elif edited_html is not None:
                    merged_html, merged_json = edited_html, edited_json
                else:
                    merged_html = plan["html"]
                    merged_json = plan["json"]
            previous_html = node.description_html
            node.description_html = merged_html
            node.description_json = merged_json
            node.save()
            record_wiki_version(node, previous_html, request.user.id, change_request=change)
            change.status = WikiChangeRequest.MERGED
            change.merged_at = timezone.now()
            change.save()
            mark_conflicting_change_requests(node)
            _notify_change("merge", workspace, node, change, request.user)
            return Response(_serialize_change(change, node, request.user, access), status=status.HTTP_200_OK)
        else:
            return Response({"error": "forbidden"}, status=status.HTTP_403_FORBIDDEN)
        change.save()
        _notify_change(action, workspace, node, change, request.user)
        return Response(_serialize_change(change, node, request.user, access), status=status.HTTP_200_OK)
