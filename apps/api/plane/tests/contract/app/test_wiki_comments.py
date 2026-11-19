# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.db.models import Notification, User, WikiNode, WikiNodePermission, WorkspaceMember


@pytest.fixture
def discussion(workspace):
    users = [User.objects.create(email=f"comment-{i}@example.com", username=f"comment-{i}") for i in range(4)]
    for user in users:
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=15, is_active=True)
    root = WikiNode.objects.create(workspace=workspace, name="Wiki", node_type=WikiNode.FOLDER, is_root=True)
    file = WikiNode.objects.create(
        workspace=workspace, parent=root, name="Notes", node_type=WikiNode.FILE, owned_by=users[0]
    )
    for user in users[1:3]:
        WikiNodePermission.objects.create(
            workspace=workspace, node=file, member=user, access=WikiNodePermission.VISIBLE
        )
    return file, users, f"/api/workspaces/{workspace.slug}/wiki/nodes/{file.id}/comments/"


@pytest.mark.contract
@pytest.mark.django_db
def test_wiki_comments_permissions_and_inbox(api_client, discussion):
    file, (owner, author, replier, hidden), url = discussion

    api_client.force_authenticate(user=hidden)
    assert api_client.get(url).status_code == 404
    assert api_client.post(url, {"body": "Hidden"}, format="json").status_code == 404

    api_client.force_authenticate(user=author)
    assert api_client.post(url, {"body": " "}, format="json").status_code == 400
    response = api_client.post(url, {"body": "First comment"}, format="json")
    assert response.status_code == 201
    first = response.data["id"]
    assert response.data["edited_at"] is None

    api_client.force_authenticate(user=replier)
    assert api_client.delete(f"{url}{first}/").status_code == 403
    reply = api_client.post(url, {"body": "Reply", "parent_id": first}, format="json")
    assert reply.status_code == 201
    reply_id = reply.data["id"]
    assert api_client.patch(f"{url}{reply_id}/", {"body": "Updated"}, format="json").data["edited_at"]
    assert api_client.patch(f"{url}{reply_id}/", {"body": "Updated"}, format="json").status_code == 200

    notices = Notification.objects.filter(entity_identifier=file.id)
    assert notices.count() == 5
    assert set(notices.filter(receiver=author).values_list("data__wiki__field", flat=True)) == {
        "comment_replied",
        "comment_edited",
    }
    assert notices.filter(receiver=owner, data__wiki__comment_id=first, data__wiki__field="comment_created").exists()
    assert not notices.filter(receiver=replier).exists()

    api_client.force_authenticate(user=owner)
    inbox = api_client.get(f"/api/workspaces/{file.workspace.slug}/users/notifications/")
    assert inbox.status_code == 200
    assert {notice["data"]["wiki"]["field"] for notice in inbox.data} == {
        "comment_created",
        "comment_replied",
        "comment_edited",
    }
    assert api_client.patch(f"{url}{first}/", {"body": "Edited by owner"}, format="json").status_code == 403
    assert api_client.delete(f"{url}{first}/").status_code == 204
    items = api_client.get(url).data["results"]
    assert [item["id"] for item in items] == [first, reply_id]
    assert items[0]["deleted"] and items[0]["body"] == ""
    assert items[1]["parent_id"] == first
    assert api_client.post(url, {"body": "Too late", "parent_id": first}, format="json").status_code == 404

    api_client.force_authenticate(user=replier)
    assert api_client.delete(f"{url}{reply_id}/").status_code == 204
    assert api_client.get(url).data["results"] == []


@pytest.mark.contract
@pytest.mark.django_db
def test_wiki_comment_cannot_reference_another_file(api_client, discussion):
    file, (owner, *_), url = discussion
    api_client.force_authenticate(user=owner)
    existing = api_client.post(url, {"body": "First"}, format="json")
    assert existing.status_code == 201
    other = WikiNode.objects.create(
        workspace=file.workspace, parent=file.parent, name="Other", node_type=WikiNode.FILE, owned_by=owner
    )
    other_url = f"/api/workspaces/{file.workspace.slug}/wiki/nodes/{other.id}/comments/"
    comment_id = existing.data["id"]
    assert api_client.post(other_url, {"body": "Reply", "parent_id": comment_id}, format="json").status_code == 404
    assert api_client.delete(f"{other_url}{comment_id}/").status_code == 404


@pytest.mark.contract
@pytest.mark.django_db
def test_comment_pages_limit_top_level_threads_and_locate_nested_replies(api_client, discussion):
    _, (owner, *_), url = discussion
    api_client.force_authenticate(user=owner)
    roots = [api_client.post(url, {"body": f"Comment {index}"}, format="json").data["id"] for index in range(11)]
    reply = api_client.post(url, {"body": "Reply", "parent_id": roots[-1]}, format="json").data["id"]
    nested = api_client.post(url, {"body": "Nested reply", "parent_id": reply}, format="json").data["id"]
    assert api_client.delete(f"{url}{roots[-1]}/").status_code == 204

    first = api_client.get(url).data
    assert (first["page"], first["total_pages"]) == (1, 2)
    assert [item["id"] for item in first["results"]] == roots[:10]

    second = api_client.get(url, {"page": 2}).data
    assert (second["page"], second["total_pages"]) == (2, 2)
    assert [item["id"] for item in second["results"]] == [roots[-1], reply, nested]
    assert second["results"][0]["deleted"]
    assert api_client.get(url, {"comment_id": nested}).data == second


@pytest.mark.contract
@pytest.mark.django_db
def test_wiki_image_upload_and_read_permissions(api_client, discussion, monkeypatch):
    from plane.db.models import FileAsset
    from plane.settings.storage import S3Storage

    monkeypatch.setattr(
        S3Storage, "generate_presigned_post", lambda *a, **k: {"url": "https://storage.test", "fields": {}}
    )
    monkeypatch.setattr(S3Storage, "generate_presigned_url", lambda *a, **k: "https://storage.test/image")
    file, (owner, viewer, _, hidden), _ = discussion
    url = f"/api/assets/v2/workspaces/{file.workspace.slug}/"
    payload = {
        "entity_type": "WIKI_DESCRIPTION",
        "entity_identifier": str(file.id),
        "name": "test.png",
        "type": "image/png",
        "size": 100,
    }

    api_client.force_authenticate(user=viewer)
    assert api_client.post(url, payload, format="json").status_code == 403
    api_client.force_authenticate(user=owner)
    result = api_client.post(url, payload, format="json")
    assert result.status_code == 200
    asset_id = result.data["asset_id"]
    asset = FileAsset.objects.get(id=asset_id)
    assert asset.wiki_node_id == file.id
    asset.is_uploaded = True
    asset.save()
    api_client.force_authenticate(user=viewer)
    assert api_client.get(f"{url}{asset_id}/").status_code == 302
    api_client.force_authenticate(user=hidden)
    assert api_client.get(f"{url}{asset_id}/").status_code == 403
    api_client.force_authenticate(user=owner)
    assert api_client.delete(f"{url}{asset_id}/").status_code == 204
    assert FileAsset.objects.filter(id=asset_id).exists()
