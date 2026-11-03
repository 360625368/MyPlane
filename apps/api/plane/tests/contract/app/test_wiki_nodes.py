# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

import pytest
from rest_framework import status

from plane.db.models import User, WorkspaceMember
from plane.utils.wiki_access import EDITABLE, INVISIBLE, VISIBLE, resolve_access


def _node(is_root=False, owned_by_id=None, user_id="member", explicit=None):
    return {
        "is_root": is_root,
        "owned_by_id": owned_by_id,
        "user_id": user_id,
        "explicit": explicit,
    }


@pytest.mark.unit
class TestWikiAccess:
    def test_root_is_editable_for_a_member(self):
        assert resolve_access([_node(is_root=True)]) == EDITABLE

    def test_new_node_is_invisible_without_a_grant(self):
        chain = [_node(is_root=True), _node(owned_by_id="creator")]
        assert resolve_access(chain) == INVISIBLE

    def test_creator_can_edit_their_own_node(self):
        chain = [_node(is_root=True, user_id="creator"), _node(owned_by_id="creator", user_id="creator")]
        assert resolve_access(chain) == EDITABLE

    def test_explicit_grant_is_used(self):
        chain = [_node(is_root=True), _node(owned_by_id="creator", explicit=VISIBLE)]
        assert resolve_access(chain) == VISIBLE

    def test_child_inherits_the_nearest_parent_grant(self):
        chain = [
            _node(is_root=True),
            _node(owned_by_id="creator", explicit=EDITABLE),
            _node(owned_by_id="creator"),
        ]
        assert resolve_access(chain) == EDITABLE

    def test_invisible_ancestor_hides_a_looser_child_grant(self):
        chain = [
            _node(is_root=True),
            _node(owned_by_id="creator", explicit=INVISIBLE),
            _node(owned_by_id="creator", explicit=EDITABLE),
        ]
        assert resolve_access(chain) == INVISIBLE

    def test_visible_parent_cannot_be_raised_to_editable(self):
        chain = [
            _node(is_root=True),
            _node(owned_by_id="creator", explicit=VISIBLE),
            _node(owned_by_id="creator", explicit=EDITABLE),
        ]
        assert resolve_access(chain) == VISIBLE

    def test_editable_parent_can_be_narrowed(self):
        chain = [
            _node(is_root=True),
            _node(owned_by_id="creator", explicit=EDITABLE),
            _node(owned_by_id="creator", explicit=VISIBLE),
        ]
        assert resolve_access(chain) == VISIBLE


@pytest.fixture(autouse=True)
def mute_wiki_soft_delete_task(monkeypatch):
    monkeypatch.setattr("plane.db.mixins.soft_delete_related_objects.delay", lambda *args, **kwargs: None)


def _member(workspace, role):
    unique = uuid.uuid4().hex[:8]
    user = User.objects.create(email=f"{unique}@plane.so", username=f"wiki_{unique}")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role, is_active=True)
    return user


def _root_id(client, workspace):
    listing = client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/")
    assert listing.status_code == status.HTTP_200_OK
    return next(node["id"] for node in listing.data if node["is_root"])


@pytest.mark.contract
class TestWikiNodes:
    def test_guest_cannot_open_wiki(self, api_client, workspace):
        guest = _member(workspace, 5)
        api_client.force_authenticate(user=guest)
        response = api_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/")
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_member_only_sees_nodes_they_are_allowed_to_view(self, session_client, workspace, create_user):
        other = _member(workspace, 15)
        created = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": _root_id(session_client, workspace), "name": "Private", "node_type": "folder"},
            format="json",
        )
        assert created.status_code == status.HTTP_201_CREATED
        folder_id = created.data["id"]

        session_client.force_authenticate(user=other)
        listing = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/")
        assert folder_id not in {node["id"] for node in listing.data}
        hidden = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/{folder_id}/")
        assert hidden.status_code == status.HTTP_404_NOT_FOUND

        session_client.force_authenticate(user=create_user)
        granted = session_client.put(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{folder_id}/access/",
            {"member_id": str(other.id), "access": "visible"},
            format="json",
        )
        assert granted.status_code == status.HTTP_200_OK

        session_client.force_authenticate(user=other)
        visible = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/{folder_id}/")
        assert visible.status_code == status.HTTP_200_OK
        assert visible.data["can_create_child"] is False

    def test_editable_member_can_create_a_child(self, session_client, workspace, create_user):
        other = _member(workspace, 15)
        folder = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": _root_id(session_client, workspace), "name": "Shared", "node_type": "folder"},
            format="json",
        )
        session_client.put(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{folder.data['id']}/access/",
            {"member_id": str(other.id), "access": "editable"},
            format="json",
        )
        session_client.force_authenticate(user=other)
        child = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": folder.data["id"], "name": "Notes", "node_type": "file"},
            format="json",
        )
        assert child.status_code == status.HTTP_201_CREATED
        assert child.data["is_creator"] is True

        session_client.force_authenticate(user=create_user)
        hidden = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/{child.data['id']}/")
        assert hidden.status_code == status.HTTP_404_NOT_FOUND

    def test_child_grant_cannot_bypass_an_invisible_parent(self, session_client, workspace):
        other = _member(workspace, 15)
        parent = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": _root_id(session_client, workspace), "name": "Parent", "node_type": "folder"},
            format="json",
        ).data
        child = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": parent["id"], "name": "Child", "node_type": "file"},
            format="json",
        ).data
        session_client.put(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{parent['id']}/access/",
            {"member_id": str(other.id), "access": "invisible"},
            format="json",
        )
        blocked = session_client.put(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{child['id']}/access/",
            {"member_id": str(other.id), "access": "editable"},
            format="json",
        )
        assert blocked.status_code == status.HTTP_400_BAD_REQUEST

        session_client.force_authenticate(user=other)
        assert (
            session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/{child['id']}/").status_code
            == status.HTTP_404_NOT_FOUND
        )

    def test_only_the_creator_can_delete_or_change_access(self, session_client, workspace, create_user):
        other = _member(workspace, 15)
        created = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": _root_id(session_client, workspace), "name": "Notes", "node_type": "file"},
            format="json",
        ).data
        session_client.put(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{created['id']}/access/",
            {"member_id": str(other.id), "access": "editable"},
            format="json",
        )
        session_client.force_authenticate(user=other)
        assert (
            session_client.delete(f"/api/workspaces/{workspace.slug}/wiki/nodes/{created['id']}/").status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert (
            session_client.put(
                f"/api/workspaces/{workspace.slug}/wiki/nodes/{created['id']}/access/",
                {"member_id": str(create_user.id), "access": "visible"},
                format="json",
            ).status_code
            == status.HTTP_403_FORBIDDEN
        )

    def test_creator_cannot_delete_a_folder_that_holds_another_creators_file(
        self, session_client, workspace, create_user
    ):
        other = _member(workspace, 15)
        parent = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": _root_id(session_client, workspace), "name": "Shared", "node_type": "folder"},
            format="json",
        )
        session_client.put(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{parent.data['id']}/access/",
            {"member_id": str(other.id), "access": "editable"},
            format="json",
        )
        session_client.force_authenticate(user=other)
        session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": parent.data["id"], "name": "Theirs", "node_type": "file"},
            format="json",
        )
        session_client.force_authenticate(user=create_user)
        response = session_client.delete(f"/api/workspaces/{workspace.slug}/wiki/nodes/{parent.data['id']}/")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["error"] == "folder_has_other_creators"

    def test_creator_can_move_rename_delete_and_restore(self, session_client, workspace):
        root_id = _root_id(session_client, workspace)
        destination = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": root_id, "name": "Destination", "node_type": "folder"},
            format="json",
        ).data
        node = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": root_id, "name": "Draft", "node_type": "file"},
            format="json",
        ).data
        renamed = session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node['id']}/",
            {"name": "Published", "parent_id": destination["id"], "sort_order": 10},
            format="json",
        )
        assert renamed.status_code == status.HTTP_200_OK
        assert renamed.data["name"] == "Published"
        assert renamed.data["parent_id"] == destination["id"]

        deleted = session_client.delete(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node['id']}/")
        assert deleted.status_code == status.HTTP_204_NO_CONTENT
        trash = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/trash/")
        assert node["id"] in {item["id"] for item in trash.data}

        restored = session_client.post(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node['id']}/restore/")
        assert restored.status_code == status.HTTP_200_OK
        assert restored.data["name"] == "Published"
