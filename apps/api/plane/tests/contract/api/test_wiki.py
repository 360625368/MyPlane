# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from django.utils import timezone

from plane.db.models import WikiNode, WikiNodePermission, WorkspaceMember
from plane.app.views.wiki.base import ensure_wiki_root


@pytest.fixture
def wiki_file(workspace, create_user):
    return WikiNode.objects.create(
        workspace=workspace,
        parent=ensure_wiki_root(workspace),
        owned_by=create_user,
        name="部署说明",
        node_type=WikiNode.FILE,
        description_html="<h1>部署</h1><p>正文关键字</p>",
        description_json={"type": "doc", "content": []},
    )


@pytest.mark.contract
@pytest.mark.django_db
class TestWikiTokenReads:
    def test_list_read_and_search(self, api_key_client, workspace, wiki_file):
        base = f"/api/v1/workspaces/{workspace.slug}/wiki/"
        listing = api_key_client.get(base + "nodes/")
        assert listing.status_code == 200
        assert str(wiki_file.id) in {node["id"] for node in listing.data}
        detail = api_key_client.get(base + f"nodes/{wiki_file.id}/")
        assert detail.status_code == 200
        assert detail.data["description_html"] == wiki_file.description_html
        assert detail.data["description_json"] == wiki_file.description_json
        search = api_key_client.get(base + "search/", {"q": "正文关键字"})
        assert search.status_code == 200
        assert [node["id"] for node in search.data] == [str(wiki_file.id)]

    @pytest.mark.parametrize("role", [5, 15])
    def test_guest_and_non_member_denied(self, api_key_client, workspace, wiki_file, create_user, role):
        membership = WorkspaceMember.objects.get(workspace=workspace, member=create_user)
        if role == 5:
            membership.role = role
            membership.save()
        else:
            membership.delete()
        base = f"/api/v1/workspaces/{workspace.slug}/wiki/"
        for path in ["nodes/", f"nodes/{wiki_file.id}/", "search/?q=正文"]:
            assert api_key_client.get(base + path).status_code == 403

    def test_hidden_nodes_not_disclosed(self, api_key_client, workspace, wiki_file, create_user):
        from plane.db.models import User

        other = User.objects.create(email="wiki-other@example.com", username="wiki-other")
        wiki_file.owned_by = other
        wiki_file.save()
        base = f"/api/v1/workspaces/{workspace.slug}/wiki/"
        assert str(wiki_file.id) not in {node["id"] for node in api_key_client.get(base + "nodes/").data}
        assert api_key_client.get(base + f"nodes/{wiki_file.id}/").status_code == 404
        assert api_key_client.get(base + "search/?q=正文").data == []
        WikiNodePermission.objects.create(workspace=workspace, node=wiki_file, member=create_user, access="visible")
        assert api_key_client.get(base + f"nodes/{wiki_file.id}/").status_code == 200

    def test_archived_listing(self, api_key_client, workspace, wiki_file):
        wiki_file.archived_at = timezone.now()
        wiki_file.save()
        url = f"/api/v1/workspaces/{workspace.slug}/wiki/nodes/"
        assert str(wiki_file.id) not in {node["id"] for node in api_key_client.get(url).data}
        assert str(wiki_file.id) in {node["id"] for node in api_key_client.get(url, {"archived": "1"}).data}

    def test_authentication_required(self, api_client, workspace, wiki_file):
        base = f"/api/v1/workspaces/{workspace.slug}/wiki/"
        for key in [None, "invalid-token"]:
            api_client.credentials(**({"HTTP_X_API_KEY": key} if key else {}))
            for path in ["nodes/", f"nodes/{wiki_file.id}/", "search/?q=正文"]:
                assert api_client.get(base + path).status_code in [401, 403]

    @pytest.mark.parametrize("method", ["post", "patch", "put", "delete"])
    def test_search_remains_read_only(self, api_key_client, workspace, method):
        response = getattr(api_key_client, method)(
            f"/api/v1/workspaces/{workspace.slug}/wiki/search/", {}, format="json"
        )
        assert response.status_code == 405


@pytest.mark.contract
@pytest.mark.django_db
class TestWikiTokenWrites:
    def test_node_lifecycle(self, api_key_client, workspace, wiki_file):
        base = f"/api/v1/workspaces/{workspace.slug}/wiki/"
        detail = base + f"nodes/{wiki_file.id}/"
        folder = api_key_client.post(
            base + "nodes/",
            {"parent_id": str(wiki_file.parent_id), "name": "目录", "node_type": "folder"},
            format="json",
        )
        assert folder.status_code == 201
        response = api_key_client.patch(
            detail,
            {
                "name": "新名称",
                "parent_id": folder.data["id"],
                "sort_order": 42,
                "logo_props": {"emoji": "test"},
                "color": "red",
                "view_props": {"full_width": True},
            },
            format="json",
        )
        assert response.status_code == 200
        assert response.data["parent_id"] == folder.data["id"]
        assert response.data["sort_order"] == 42
        assert response.data["color"] == "red"
        body = {
            "description_html": "<p>新的正文</p>",
            "description_json": {"type": "doc"},
            "base_html": wiki_file.description_html,
        }
        assert api_key_client.patch(detail + "description/", body, format="json").status_code == 200
        assert api_key_client.patch(detail + "description/", body, format="json").status_code == 409
        versions = api_key_client.get(detail + "versions/")
        assert versions.status_code == 200 and versions.data
        assert (
            api_key_client.post(detail + "versions/", {"version_id": versions.data[0]["id"]}, format="json").status_code
            == 200
        )
        copy = api_key_client.post(detail + "duplicate/", {}, format="json")
        assert copy.status_code == 201
        for state in [{"is_locked": True}, {"is_locked": False}, {"archived": True}, {"archived": False}]:
            assert api_key_client.post(detail + "state/", state, format="json").status_code == 200
        assert api_key_client.delete(detail).status_code == 204
        assert str(wiki_file.id) in {node["id"] for node in api_key_client.get(base + "trash/").data}
        assert api_key_client.post(detail + "restore/", {}, format="json").status_code == 200
        assert api_key_client.get(detail).status_code == 200

    def test_permissions_and_change_workflow(self, api_key_client, workspace, wiki_file, create_user):
        from plane.db.models import APIToken, User
        from rest_framework.test import APIClient

        other = User.objects.create(email="wiki-author@example.com", username="wiki-author")
        WorkspaceMember.objects.create(workspace=workspace, member=other, role=15)
        token = APIToken.objects.create(user=other)
        author = APIClient()
        author.credentials(HTTP_X_API_KEY=token.token)
        detail = f"/api/v1/workspaces/{workspace.slug}/wiki/nodes/{wiki_file.id}/"
        assert (
            api_key_client.put(
                detail + "access/", {"member_id": str(other.id), "access": "editable"}, format="json"
            ).status_code
            == 200
        )
        assert api_key_client.get(detail + "access/").status_code == 200
        assert (
            author.patch(detail + "description/", {"description_html": "<p>bad</p>"}, format="json").status_code == 403
        )
        assert author.delete(detail).status_code == 403
        assert (
            author.put(
                detail + "access/", {"member_id": str(create_user.id), "access": "editable"}, format="json"
            ).status_code
            == 403
        )
        response = author.post(detail + "changes/", {}, format="json")
        assert response.status_code == 201
        change = detail + f"changes/{response.data['id']}/"
        assert (
            author.patch(
                change, {"description_html": "<p>建议正文</p>", "description_json": {"type": "doc"}}, format="json"
            ).status_code
            == 200
        )
        for client, action, extra in [
            (author, "submit", {}),
            (author, "withdraw", {}),
            (author, "submit", {}),
            (api_key_client, "return", {"comment": "请补充"}),
            (author, "submit", {}),
            (api_key_client, "merge", {}),
        ]:
            response = client.post(change, {"action": action, **extra}, format="json")
            assert response.status_code == 200, response.data
        wiki_file.refresh_from_db()
        assert wiki_file.description_html == "<p>建议正文</p>"
        changes = api_key_client.get(detail + "changes/")
        assert changes.data[0]["status"] == "merged"
        response = author.post(detail + "changes/", {}, format="json")
        assert response.status_code == 201
        close = author.post(detail + f"changes/{response.data['id']}/", {"action": "close"}, format="json")
        assert close.status_code == 200
        assert (
            api_key_client.put(
                detail + "access/", {"member_id": str(other.id), "access": None}, format="json"
            ).status_code
            == 200
        )
        assert author.get(detail).status_code == 404

    @pytest.mark.parametrize("role", [5, 15])
    def test_writes_denied_to_guest_or_outsider(self, api_key_client, workspace, wiki_file, create_user, role):
        membership = WorkspaceMember.objects.get(workspace=workspace, member=create_user)
        if role == 5:
            membership.role = role
            membership.save()
        else:
            membership.delete()
        base = f"/api/v1/workspaces/{workspace.slug}/wiki/"
        detail = base + f"nodes/{wiki_file.id}/"
        requests = [
            ("post", base + "nodes/"),
            ("patch", detail),
            ("delete", detail),
            ("post", detail + "restore/"),
            ("patch", detail + "description/"),
            ("post", detail + "duplicate/"),
            ("post", detail + "state/"),
            ("post", detail + "versions/"),
            ("put", detail + "access/"),
            ("post", detail + "changes/"),
            ("patch", detail + f"changes/{wiki_file.id}/"),
            ("post", detail + f"changes/{wiki_file.id}/"),
        ]
        for method, url in requests:
            assert getattr(api_key_client, method)(url, {}, format="json").status_code == 403

    def test_locked_and_invalid_bodies(self, api_key_client, workspace, wiki_file):
        detail = f"/api/v1/workspaces/{workspace.slug}/wiki/nodes/{wiki_file.id}/"
        assert api_key_client.patch(detail, [], format="json").status_code == 400
        assert api_key_client.post(detail + "state/", {"is_locked": True}, format="json").status_code == 200
        assert (
            api_key_client.patch(
                detail + "description/", {"description_html": "<p>change</p>"}, format="json"
            ).status_code
            == 400
        )

    def test_collection_and_detail_methods(self, api_key_client, workspace, wiki_file):
        base = f"/api/v1/workspaces/{workspace.slug}/wiki/nodes/"
        assert api_key_client.patch(base, {}, format="json").status_code == 405
        assert api_key_client.delete(base).status_code == 405
        assert api_key_client.post(base + f"{wiki_file.id}/", {}, format="json").status_code == 405
