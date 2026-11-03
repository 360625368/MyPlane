# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import UUID

from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import User, WikiNode, WikiNodePermission, Workspace, WorkspaceMember
from plane.utils.wiki_access import EDITABLE, INVISIBLE, VISIBLE, can_create_child, can_view, resolve_access

ADMIN_ROLE = 20
MEMBER_ROLE = 15


class WikiMemberPermission(BasePermission):
    """Workspace admins and members can use Wiki. Guests cannot."""

    def has_permission(self, request, view):
        if request.user.is_anonymous:
            return False
        return WorkspaceMember.objects.filter(
            member=request.user,
            workspace__slug=view.workspace_slug,
            role__in=[ADMIN_ROLE, MEMBER_ROLE],
            is_active=True,
        ).exists()


def _not_found():
    return Response({"error": "not_found"}, status=status.HTTP_404_NOT_FOUND)


def _workspace_or_404(slug):
    workspace = Workspace.objects.filter(slug=slug).first()
    if workspace is None:
        return None, _not_found()
    return workspace, None


def ensure_wiki_root(workspace):
    root = WikiNode.objects.filter(workspace=workspace, is_root=True).first()
    if root is not None:
        return root
    try:
        with transaction.atomic():
            return WikiNode.objects.create(
                workspace=workspace,
                name="Wiki",
                node_type=WikiNode.FOLDER,
                is_root=True,
                owned_by=None,
                parent=None,
            )
    except IntegrityError:
        return WikiNode.objects.get(workspace=workspace, is_root=True)


def _explicit_map(workspace):
    grants = {}
    for permission in WikiNodePermission.objects.filter(workspace=workspace).values("node_id", "member_id", "access"):
        grants[(permission["node_id"], permission["member_id"])] = permission["access"]
    return grants


def _chain(node, nodes_by_id, explicit, user_id):
    lineage = []
    current = node
    while current is not None:
        lineage.append(current)
        current = nodes_by_id.get(current.parent_id) if current.parent_id else None
    lineage.reverse()
    return [
        {
            "is_root": item.is_root,
            "owned_by_id": item.owned_by_id,
            "user_id": user_id,
            "explicit": explicit.get((item.id, user_id)),
        }
        for item in lineage
    ]


def effective_access(node, user_id, nodes_by_id, explicit):
    return resolve_access(_chain(node, nodes_by_id, explicit, user_id))


def _load_nodes(workspace):
    nodes = list(WikiNode.objects.filter(workspace=workspace))
    return {node.id: node for node in nodes}


def _is_creator(node, user):
    return node.owned_by_id is not None and node.owned_by_id == user.id


def _serialize_node(node, user, access):
    creator = _is_creator(node, user)
    return {
        "id": str(node.id),
        "parent_id": str(node.parent_id) if node.parent_id else None,
        "name": node.name,
        "node_type": node.node_type,
        "is_root": node.is_root,
        "sort_order": node.sort_order,
        "owned_by": str(node.owned_by_id) if node.owned_by_id else None,
        "access": access,
        "is_creator": creator,
        "can_delete": creator and not node.is_root,
        "can_manage_access": creator and not node.is_root,
        "can_rename": creator and not node.is_root,
        "can_move": creator and not node.is_root,
        "can_create_child": node.node_type == WikiNode.FOLDER and can_create_child(access) and not node.archived_at,
        "is_locked": node.is_locked,
        "archived_at": node.archived_at,
        "logo_props": node.logo_props,
        "color": node.color,
        "view_props": node.view_props,
        "can_edit_body": creator and node.node_type == WikiNode.FILE and not node.is_locked and not node.archived_at,
    }


def _as_uuid(value):
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _visible_node(workspace, user, node_id):
    node_id = _as_uuid(node_id)
    nodes_by_id = _load_nodes(workspace)
    node = nodes_by_id.get(node_id) if node_id else None
    if node is None:
        return None, None, None, None
    explicit = _explicit_map(workspace)
    access = effective_access(node, user.id, nodes_by_id, explicit)
    if not can_view(access):
        return None, None, None, None
    return node, access, nodes_by_id, explicit


def _descendant_ids(node_id, nodes_by_id):
    children = {}
    for node in nodes_by_id.values():
        children.setdefault(node.parent_id, []).append(node.id)
    pending = list(children.get(node_id, []))
    found = []
    while pending:
        current = pending.pop()
        found.append(current)
        pending.extend(children.get(current, []))
    return found


def _archived_branch_ids(nodes_by_id):
    hidden = {node.id for node in nodes_by_id.values() if node.archived_at}
    changed = True
    while changed:
        changed = False
        for node in nodes_by_id.values():
            if node.parent_id in hidden and node.id not in hidden:
                hidden.add(node.id)
                changed = True
    return hidden


def _remember_visit(workspace, user, node):
    from plane.db.models import UserRecentVisit

    visit = UserRecentVisit.objects.filter(
        workspace=workspace,
        user=user,
        entity_name="wiki",
        entity_identifier=node.id,
    ).first()
    if visit is None:
        UserRecentVisit.objects.create(
            workspace=workspace,
            user=user,
            entity_name="wiki",
            entity_identifier=node.id,
        )
        return
    from django.utils import timezone

    visit.visited_at = timezone.now()
    visit.save(update_fields=["visited_at", "updated_at"])


def _eligible_member(workspace, member_id):
    return WorkspaceMember.objects.filter(
        workspace=workspace,
        member_id=member_id,
        role__in=[ADMIN_ROLE, MEMBER_ROLE],
        is_active=True,
    ).exists()


class WikiNodeEndpoint(BaseAPIView):
    permission_classes = [WikiMemberPermission]

    def get(self, request, slug, node_id=None):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        ensure_wiki_root(workspace)
        if node_id is None:
            nodes_by_id = _load_nodes(workspace)
            explicit = _explicit_map(workspace)
            archived_only = request.query_params.get("archived") == "1"
            hidden = _archived_branch_ids(nodes_by_id)
            visible = []
            for node in nodes_by_id.values():
                access = effective_access(node, request.user.id, nodes_by_id, explicit)
                if not can_view(access):
                    continue
                if archived_only:
                    if node.archived_at is None:
                        continue
                elif node.id in hidden:
                    continue
                visible.append(_serialize_node(node, request.user, access))
            visible.sort(key=lambda item: (item["sort_order"], item["name"]))
            return Response(visible, status=status.HTTP_200_OK)

        node, access, _, _ = _visible_node(workspace, request.user, node_id)
        if node is None:
            return _not_found()
        if node.node_type == WikiNode.FILE:
            _remember_visit(workspace, request.user, node)
        payload = _serialize_node(node, request.user, access)
        payload["description_html"] = node.description_html
        payload["description_json"] = node.description_json
        return Response(payload, status=status.HTTP_200_OK)

    def post(self, request, slug):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        ensure_wiki_root(workspace)
        parent_id = request.data.get("parent_id")
        name = (request.data.get("name") or "").strip()
        node_type = request.data.get("node_type")
        if node_type not in (WikiNode.FOLDER, WikiNode.FILE) or not name or len(name) > 255 or not parent_id:
            return Response({"error": "invalid"}, status=status.HTTP_400_BAD_REQUEST)

        parent, parent_access, _, _ = _visible_node(workspace, request.user, parent_id)
        if parent is None:
            return _not_found()
        if parent.node_type != WikiNode.FOLDER or not can_create_child(parent_access):
            return Response({"error": "invalid_parent"}, status=status.HTTP_400_BAD_REQUEST)

        node = WikiNode.objects.create(
            workspace=workspace,
            parent=parent,
            name=name,
            node_type=node_type,
            owned_by=request.user,
            sort_order=request.data.get("sort_order") or WikiNode.DEFAULT_SORT_ORDER,
        )
        return Response(_serialize_node(node, request.user, EDITABLE), status=status.HTTP_201_CREATED)

    def patch(self, request, slug, node_id):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        node, access, nodes_by_id, explicit = _visible_node(workspace, request.user, node_id)
        if node is None:
            return _not_found()
        if node.is_root or not _is_creator(node, request.user):
            return Response({"error": "forbidden"}, status=status.HTTP_403_FORBIDDEN)

        if "name" in request.data:
            name = (request.data.get("name") or "").strip()
            if not name or len(name) > 255:
                return Response({"error": "invalid"}, status=status.HTTP_400_BAD_REQUEST)
            node.name = name
        if "sort_order" in request.data:
            node.sort_order = request.data.get("sort_order")
        if "parent_id" in request.data:
            parent, parent_access, _, _ = _visible_node(workspace, request.user, request.data.get("parent_id"))
            if parent is None:
                return _not_found()
            if (
                parent.node_type != WikiNode.FOLDER
                or parent.archived_at
                or not can_create_child(parent_access)
                or parent.id == node.id
                or parent.id in _descendant_ids(node.id, nodes_by_id)
            ):
                return Response({"error": "invalid_parent"}, status=status.HTTP_400_BAD_REQUEST)
            node.parent = parent
        if "logo_props" in request.data and isinstance(request.data.get("logo_props"), dict):
            node.logo_props = request.data.get("logo_props")
        if node.node_type == WikiNode.FILE and not node.is_locked and not node.archived_at:
            if "color" in request.data:
                node.color = str(request.data.get("color") or "")[:255]
            if "view_props" in request.data and isinstance(request.data.get("view_props"), dict):
                node.view_props = request.data.get("view_props")
        node.save()
        nodes_by_id[node.id] = node
        access = effective_access(node, request.user.id, nodes_by_id, explicit)
        return Response(_serialize_node(node, request.user, access), status=status.HTTP_200_OK)

    def delete(self, request, slug, node_id):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        node, _, nodes_by_id, _ = _visible_node(workspace, request.user, node_id)
        if node is None:
            return _not_found()
        if node.is_root or not _is_creator(node, request.user):
            return Response({"error": "forbidden"}, status=status.HTTP_403_FORBIDDEN)

        descendant_ids = _descendant_ids(node.id, nodes_by_id)
        for descendant_id in descendant_ids:
            descendant = nodes_by_id[descendant_id]
            if descendant.owned_by_id != request.user.id:
                return Response({"error": "folder_has_other_creators"}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            for descendant_id in reversed(descendant_ids):
                nodes_by_id[descendant_id].delete()
            node.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WikiNodeRestoreEndpoint(BaseAPIView):
    permission_classes = [WikiMemberPermission]

    def post(self, request, slug, node_id):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        node = WikiNode.all_objects.filter(workspace=workspace, id=node_id, deleted_at__isnull=False).first()
        if node is None or node.is_root or node.owned_by_id != request.user.id:
            return _not_found()
        parent = WikiNode.objects.filter(workspace=workspace, id=node.parent_id).first()
        if parent is None:
            return Response({"error": "parent_deleted"}, status=status.HTTP_400_BAD_REQUEST)
        parent_visible, parent_access, _, _ = _visible_node(workspace, request.user, parent.id)
        if parent_visible is None or not can_create_child(parent_access):
            return _not_found()
        node.deleted_at = None
        node.save(update_fields=["deleted_at", "updated_at"])
        return Response(_serialize_node(node, request.user, EDITABLE), status=status.HTTP_200_OK)


class WikiTrashEndpoint(BaseAPIView):
    permission_classes = [WikiMemberPermission]

    def get(self, request, slug):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        nodes = WikiNode.all_objects.filter(
            workspace=workspace,
            owned_by=request.user,
            is_root=False,
            deleted_at__isnull=False,
        ).order_by("-deleted_at")
        return Response(
            [
                {
                    "id": str(node.id),
                    "parent_id": str(node.parent_id) if node.parent_id else None,
                    "name": node.name,
                    "node_type": node.node_type,
                    "deleted_at": node.deleted_at,
                }
                for node in nodes
            ],
            status=status.HTTP_200_OK,
        )


class WikiNodeAccessEndpoint(BaseAPIView):
    permission_classes = [WikiMemberPermission]

    def get(self, request, slug, node_id):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        node, _, nodes_by_id, explicit = _visible_node(workspace, request.user, node_id)
        if node is None:
            return _not_found()
        if node.is_root or not _is_creator(node, request.user):
            return Response({"error": "forbidden"}, status=status.HTTP_403_FORBIDDEN)

        memberships = WorkspaceMember.objects.filter(
            workspace=workspace,
            role__in=[ADMIN_ROLE, MEMBER_ROLE],
            is_active=True,
        ).select_related("member")
        members = []
        for membership in memberships:
            member = membership.member
            if member.id == request.user.id:
                continue
            members.append(
                {
                    "id": str(member.id),
                    "display_name": member.display_name or member.email,
                    "email": member.email,
                    "explicit_access": explicit.get((node.id, member.id)),
                    "effective_access": effective_access(node, member.id, nodes_by_id, explicit),
                }
            )
        return Response(members, status=status.HTTP_200_OK)

    def put(self, request, slug, node_id):
        workspace, error = _workspace_or_404(slug)
        if error:
            return error
        node, _, nodes_by_id, explicit = _visible_node(workspace, request.user, node_id)
        if node is None:
            return _not_found()
        if node.is_root or not _is_creator(node, request.user):
            return Response({"error": "forbidden"}, status=status.HTTP_403_FORBIDDEN)

        raw_member_id = request.data.get("member_id")
        access = request.data.get("access")
        try:
            member_id = UUID(str(raw_member_id))
        except (TypeError, ValueError):
            return Response({"error": "invalid_member"}, status=status.HTTP_400_BAD_REQUEST)
        if member_id == request.user.id or not _eligible_member(workspace, member_id):
            return Response({"error": "invalid_member"}, status=status.HTTP_400_BAD_REQUEST)
        if not User.objects.filter(id=member_id).exists():
            return Response({"error": "invalid_member"}, status=status.HTTP_400_BAD_REQUEST)

        parent = nodes_by_id.get(node.parent_id)
        parent_access = effective_access(parent, member_id, nodes_by_id, explicit) if parent else EDITABLE
        if access is None:
            WikiNodePermission.objects.filter(node=node, member_id=member_id).delete()
        elif access not in (INVISIBLE, VISIBLE, EDITABLE):
            return Response({"error": "invalid"}, status=status.HTTP_400_BAD_REQUEST)
        elif access == EDITABLE and parent_access != EDITABLE:
            return Response({"error": "cannot_elevate"}, status=status.HTTP_400_BAD_REQUEST)
        elif access == VISIBLE and parent_access == INVISIBLE:
            return Response({"error": "cannot_elevate"}, status=status.HTTP_400_BAD_REQUEST)
        else:
            permission = WikiNodePermission.objects.filter(node=node, member_id=member_id).first()
            if permission is None:
                permission = WikiNodePermission.all_objects.filter(node=node, member_id=member_id).first()
            if permission is None:
                WikiNodePermission.objects.create(
                    workspace=workspace,
                    node=node,
                    member_id=member_id,
                    access=access,
                )
            else:
                permission.access = access
                permission.deleted_at = None
                permission.save(update_fields=["access", "deleted_at", "updated_at"])

        explicit = _explicit_map(workspace)
        effective = effective_access(node, member_id, nodes_by_id, explicit)
        if can_view(effective):
            from plane.utils.wiki_notify import notify_wiki

            notify_wiki(workspace, node, member_id, request.user, "access")
        return Response(
            {
                "member_id": str(member_id),
                "explicit_access": explicit.get((node.id, member_id)) if access is not None else None,
                "effective_access": effective,
            },
            status=status.HTTP_200_OK,
        )
