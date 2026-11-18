# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from collections import defaultdict

from django.core.paginator import Paginator
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import WikiComment, WorkspaceMember
from plane.utils.wiki_notify import notify_wiki

from .base import ADMIN_ROLE, MEMBER_ROLE, WikiMemberPermission, _is_creator, _not_found, _workspace_or_404
from .document import _file_for_reading


class CommentBodySerializer(serializers.Serializer):
    body = serializers.CharField(max_length=10000)


class CreateCommentSerializer(CommentBodySerializer):
    parent_id = serializers.UUIDField(required=False, allow_null=True)


class CommentPageSerializer(serializers.Serializer):
    page = serializers.IntegerField(min_value=1, default=1)
    comment_id = serializers.UUIDField(required=False)


def _serialize(comment, node, user):
    deleted = comment.deleted_at is not None
    own_comment = comment.author_id == user.id and not deleted
    return {
        "id": str(comment.id),
        "parent_id": str(comment.parent_id) if comment.parent_id else None,
        "author_name": comment.author.display_name if comment.author and not deleted else "",
        "author_avatar_url": comment.author.avatar_url if comment.author and not deleted else None,
        "body": comment.body if not deleted else "",
        "created_at": comment.created_at,
        "edited_at": comment.edited_at if not deleted else None,
        "deleted": deleted,
        "can_edit": own_comment,
        "can_delete": not deleted and (own_comment or _is_creator(node, user)),
    }


def _notify(workspace, node, comment, actor, field):
    recipients = {node.owned_by_id}
    if comment.parent_id:
        recipients.add(comment.parent.author_id)
    recipients.discard(actor.id)
    recipients.discard(None)
    members = WorkspaceMember.objects.filter(
        workspace=workspace, member_id__in=recipients, role__in=(ADMIN_ROLE, MEMBER_ROLE), is_active=True
    ).values_list("member_id", flat=True)
    for member_id in members:
        notify_wiki(workspace, node, member_id, actor, field, comment_id=comment.id)


class WikiCommentsEndpoint(BaseAPIView):
    permission_classes = [WikiMemberPermission]

    def _file(self, request, slug, node_id):
        workspace, _ = _workspace_or_404(slug)
        if workspace is None:
            return None, None
        node, _, _, _ = _file_for_reading(workspace, request.user, node_id)
        return workspace, node

    def get(self, request, slug, node_id):
        _, node = self._file(request, slug, node_id)
        if node is None:
            return _not_found()
        params = CommentPageSerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        comments = WikiComment.all_objects.filter(node=node)
        rows = list(comments.values_list("id", "parent_id", "deleted_at"))
        parents = {comment_id: parent_id for comment_id, parent_id, _ in rows}
        visible_ids = {comment_id for comment_id, _, deleted_at in rows if deleted_at is None}
        for comment_id, parent_id, deleted_at in rows:
            if deleted_at is not None:
                continue
            while parent_id in parents and parent_id not in visible_ids:
                visible_ids.add(parent_id)
                parent_id = parents[parent_id]

        roots = []
        children = defaultdict(list)
        for comment_id, parent_id, _ in rows:
            if comment_id not in visible_ids:
                continue
            if parent_id in parents:
                children[parent_id].append(comment_id)
            else:
                roots.append(comment_id)

        paginator = Paginator(roots, 10)
        page_number = params.validated_data["page"]
        focus = params.validated_data.get("comment_id")
        if focus in visible_ids:
            while parents[focus] in parents:
                focus = parents[focus]
            page_number = roots.index(focus) // paginator.per_page + 1
        page = paginator.get_page(page_number)
        pending = list(page.object_list)
        page_ids = []
        while pending:
            comment_id = pending.pop()
            page_ids.append(comment_id)
            pending.extend(children[comment_id])

        return Response(
            {
                "page": page.number,
                "total_pages": paginator.num_pages,
                "results": [
                    _serialize(comment, node, request.user)
                    for comment in comments.filter(id__in=page_ids).select_related("author__avatar_asset")
                ],
            }
        )

    @transaction.atomic
    def post(self, request, slug, node_id):
        workspace, node = self._file(request, slug, node_id)
        if node is None:
            return _not_found()
        serializer = CreateCommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        parent = None
        if parent_id := serializer.validated_data.get("parent_id"):
            parent = WikiComment.objects.select_for_update().filter(node=node, id=parent_id).first()
            if parent is None:
                return _not_found()
        comment = WikiComment.objects.create(
            node=node, author=request.user, parent=parent, body=serializer.validated_data["body"]
        )
        _notify(workspace, node, comment, request.user, "comment_replied" if parent else "comment_created")
        return Response(_serialize(comment, node, request.user), status=status.HTTP_201_CREATED)

    @transaction.atomic
    def patch(self, request, slug, node_id, comment_id):
        workspace, node = self._file(request, slug, node_id)
        if node is None:
            return _not_found()
        comment = WikiComment.objects.select_for_update().filter(node=node, id=comment_id).first()
        if comment is None:
            return _not_found()
        if comment.author_id != request.user.id:
            return Response({"error": "forbidden"}, status=status.HTTP_403_FORBIDDEN)
        serializer = CommentBodySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        body = serializer.validated_data["body"]
        if body != comment.body:
            comment.body = body
            comment.edited_at = timezone.now()
            comment.save(update_fields=["body", "edited_at", "updated_at", "updated_by"])
            _notify(workspace, node, comment, request.user, "comment_edited")
        return Response(_serialize(comment, node, request.user))

    def delete(self, request, slug, node_id, comment_id):
        _, node = self._file(request, slug, node_id)
        if node is None:
            return _not_found()
        comments = WikiComment.objects.filter(node=node, id=comment_id)
        comment = comments.first()
        if comment is None:
            return _not_found()
        if comment.author_id != request.user.id and not _is_creator(node, request.user):
            return Response({"error": "forbidden"}, status=status.HTTP_403_FORBIDDEN)
        # Leave a tombstone for replies, without retaining the deleted text.
        if not comments.update(body="", deleted_at=timezone.now()):
            return _not_found()
        return Response(status=status.HTTP_204_NO_CONTENT)
