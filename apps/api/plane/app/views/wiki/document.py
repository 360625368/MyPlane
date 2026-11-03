# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import status
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import UserRecentVisit, WikiNode, WikiNodeVersion
from plane.utils.content_validator import validate_html_content
from plane.utils.wiki_access import can_create_child, can_view
from plane.utils.wiki_version import mark_conflicting_change_requests, record_wiki_version

from .base import (
    WikiMemberPermission,
    _explicit_map,
    _is_creator,
    _load_nodes,
    _not_found,
    _serialize_node,
    _visible_node,
    _workspace_or_404,
    effective_access,
    ensure_wiki_root,
)


def _file_for_reading(workspace, user, node_id):
    node, access, nodes_by_id, explicit = _visible_node(workspace, user, node_id)
    if node is None or node.node_type != WikiNode.FILE:
        return None, None, None, None
    return node, access, nodes_by_id, explicit


def _creator_can_publish(node, user):
    if not _is_creator(node, user):
        return Response({"error": "forbidden"}, status=status.HTTP_403_FORBIDDEN)
    if node.is_locked:
        return Response({"error": "locked"}, status=status.HTTP_400_BAD_REQUEST)
    if node.archived_at:
        return Response({"error": "archived"}, status=status.HTTP_400_BAD_REQUEST)
    return None


class WikiNodeDescriptionEndpoint(BaseAPIView):
    permission_classes = [WikiMemberPermission]

    def patch(self, request, slug, node_id):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        node, access, _, _ = _file_for_reading(workspace, request.user, node_id)
        if node is None:
            return _not_found()
        blocked = _creator_can_publish(node, request.user)
        if blocked:
            return blocked

        html = request.data.get("description_html", "<p></p>")
        valid, message, clean_html = validate_html_content(html or "<p></p>")
        if not valid:
            return Response({"error": message or "invalid"}, status=status.HTTP_400_BAD_REQUEST)
        description_json = request.data.get("description_json", {})
        if description_json is None:
            description_json = {}
        if not isinstance(description_json, (dict, list)):
            return Response({"error": "invalid"}, status=status.HTTP_400_BAD_REQUEST)
        base_html = request.data.get("base_html", None)
        if isinstance(base_html, str) and base_html != (node.description_html or ""):
            return Response({"error": "conflict"}, status=status.HTTP_409_CONFLICT)

        previous_html = node.description_html
        node.description_html = clean_html or "<p></p>"
        node.description_json = description_json
        node.save()
        if previous_html != node.description_html:
            record_wiki_version(node, previous_html, request.user.id)
            mark_conflicting_change_requests(node)
        payload = _serialize_node(node, request.user, access)
        payload["description_html"] = node.description_html
        payload["description_json"] = node.description_json
        return Response(payload, status=status.HTTP_200_OK)


class WikiNodeVersionEndpoint(BaseAPIView):
    permission_classes = [WikiMemberPermission]

    def get(self, request, slug, node_id):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        node, _, _, _ = _file_for_reading(workspace, request.user, node_id)
        if node is None:
            return _not_found()
        versions = WikiNodeVersion.objects.filter(node=node).order_by("-last_saved_at")
        return Response(
            [
                {
                    "id": str(version.id),
                    "owned_by": str(version.owned_by_id),
                    "last_saved_at": version.last_saved_at,
                    "description_html": version.description_html,
                    "description_json": version.description_json,
                    "change_request": str(version.change_request_id) if version.change_request_id else None,
                }
                for version in versions
            ],
            status=status.HTTP_200_OK,
        )

    def post(self, request, slug, node_id):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        node, access, _, _ = _file_for_reading(workspace, request.user, node_id)
        if node is None:
            return _not_found()
        blocked = _creator_can_publish(node, request.user)
        if blocked:
            return blocked
        version = WikiNodeVersion.objects.filter(node=node, id=request.data.get("version_id")).first()
        if version is None:
            return _not_found()
        previous_html = node.description_html
        node.description_html = version.description_html
        node.description_json = version.description_json
        node.save()
        if previous_html != node.description_html:
            record_wiki_version(node, previous_html, request.user.id)
            mark_conflicting_change_requests(node)
        payload = _serialize_node(node, request.user, access)
        payload["description_html"] = node.description_html
        payload["description_json"] = node.description_json
        return Response(payload, status=status.HTTP_200_OK)


class WikiNodeStateEndpoint(BaseAPIView):
    permission_classes = [WikiMemberPermission]

    def post(self, request, slug, node_id):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        node, access, _, _ = _visible_node(workspace, request.user, node_id)
        if node is None or node.is_root:
            return _not_found()
        if not _is_creator(node, request.user):
            return Response({"error": "forbidden"}, status=status.HTTP_403_FORBIDDEN)

        was_locked = node.is_locked
        was_archived = node.archived_at is not None
        if "is_locked" in request.data:
            if node.node_type != WikiNode.FILE:
                return Response({"error": "invalid"}, status=status.HTTP_400_BAD_REQUEST)
            node.is_locked = bool(request.data.get("is_locked"))
        if "archived" in request.data:
            from django.utils import timezone

            node.archived_at = timezone.now() if request.data.get("archived") else None
        node.save()
        if node.node_type == WikiNode.FILE:
            from plane.utils.wiki_notify import notify_open_change_authors

            if node.is_locked and not was_locked:
                notify_open_change_authors(workspace, node, request.user, "locked")
            if node.archived_at is not None and not was_archived:
                notify_open_change_authors(workspace, node, request.user, "archived")
        return Response(_serialize_node(node, request.user, access), status=status.HTTP_200_OK)


class WikiNodeDuplicateEndpoint(BaseAPIView):
    permission_classes = [WikiMemberPermission]

    def post(self, request, slug, node_id):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        ensure_wiki_root(workspace)
        node, _, _, _ = _file_for_reading(workspace, request.user, node_id)
        if node is None:
            return _not_found()
        parent_id = request.data.get("parent_id") or node.parent_id
        parent, parent_access, _, _ = _visible_node(workspace, request.user, parent_id)
        if (
            parent is None
            or parent.node_type != WikiNode.FOLDER
            or parent.archived_at
            or not can_create_child(parent_access)
        ):
            return Response({"error": "invalid_parent"}, status=status.HTTP_400_BAD_REQUEST)
        copy = WikiNode.objects.create(
            workspace=workspace,
            parent=parent,
            name=node.name,
            node_type=WikiNode.FILE,
            owned_by=request.user,
            description_html=node.description_html,
            description_json=node.description_json,
            color=node.color,
            logo_props=node.logo_props,
            view_props=node.view_props,
        )
        record_wiki_version(copy, "", request.user.id)
        return Response(_serialize_node(copy, request.user, "editable"), status=status.HTTP_201_CREATED)


class WikiSearchEndpoint(BaseAPIView):
    permission_classes = [WikiMemberPermission]

    def get(self, request, slug):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        query = (request.query_params.get("q") or "").strip()
        if not query:
            return Response([], status=status.HTTP_200_OK)
        nodes_by_id = _load_nodes(workspace)
        explicit = _explicit_map(workspace)
        matches = []
        for node in nodes_by_id.values():
            if node.archived_at or node.is_root:
                continue
            haystack = f"{node.name} {node.description_stripped or ''}"
            if query.lower() not in haystack.lower():
                continue
            access = effective_access(node, request.user.id, nodes_by_id, explicit)
            if can_view(access):
                matches.append(_serialize_node(node, request.user, access))
        return Response(matches[:50], status=status.HTTP_200_OK)


class WikiRecentEndpoint(BaseAPIView):
    permission_classes = [WikiMemberPermission]

    def get(self, request, slug):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        visits = UserRecentVisit.objects.filter(workspace=workspace, user=request.user, entity_name="wiki").order_by(
            "-visited_at"
        )[:20]
        nodes_by_id = _load_nodes(workspace)
        explicit = _explicit_map(workspace)
        recent = []
        for visit in visits:
            node = nodes_by_id.get(visit.entity_identifier)
            if node is None or node.archived_at:
                continue
            access = effective_access(node, request.user.id, nodes_by_id, explicit)
            if can_view(access):
                recent.append(_serialize_node(node, request.user, access))
        return Response(recent, status=status.HTTP_200_OK)
