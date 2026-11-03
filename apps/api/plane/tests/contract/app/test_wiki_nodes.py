# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status

from plane.db.models import Notification, User, WikiNodeVersion, WorkspaceMember
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


def _age_latest_version(node_id):
    version = WikiNodeVersion.objects.filter(node_id=node_id).order_by("-last_saved_at").first()
    version.last_saved_at = timezone.now() - timedelta(seconds=700)
    version.save(update_fields=["last_saved_at"])
    return version


@pytest.mark.contract
class TestWikiDocument:
    def test_creator_publishes_immediately_and_can_restore_a_version(self, session_client, workspace, create_user):
        other = _member(workspace, 15)
        created = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": _root_id(session_client, workspace), "name": "Notes", "node_type": "file"},
            format="json",
        )
        node_id = created.data["id"]
        saved = session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/description/",
            {"description_html": "<p>Hello</p>", "description_json": {"type": "doc"}},
            format="json",
        )
        assert saved.status_code == status.HTTP_200_OK
        assert "Hello" in saved.data["description_html"]
        first = _age_latest_version(node_id)

        session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/description/",
            {"description_html": "<p>Goodbye</p>", "description_json": {"type": "doc"}},
            format="json",
        )
        _age_latest_version(node_id)
        restored = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/versions/",
            {"version_id": str(first.id)},
            format="json",
        )
        assert restored.status_code == status.HTTP_200_OK
        assert "Hello" in restored.data["description_html"]

        session_client.put(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/access/",
            {"member_id": str(other.id), "access": "visible"},
            format="json",
        )
        session_client.force_authenticate(user=other)
        denied = session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/description/",
            {"description_html": "<p>Nope</p>", "description_json": {}},
            format="json",
        )
        assert denied.status_code == status.HTTP_403_FORBIDDEN

        session_client.force_authenticate(user=create_user)
        session_client.put(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/access/",
            {"member_id": str(other.id), "access": "editable"},
            format="json",
        )
        session_client.force_authenticate(user=other)
        still_denied = session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/description/",
            {"description_html": "<p>Nope</p>", "description_json": {}},
            format="json",
        )
        assert still_denied.status_code == status.HTTP_403_FORBIDDEN

    def test_locked_or_archived_files_leave_the_tree_and_reject_saves(self, session_client, workspace):
        created = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": _root_id(session_client, workspace), "name": "Locked", "node_type": "file"},
            format="json",
        )
        node_id = created.data["id"]
        locked = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/state/",
            {"is_locked": True},
            format="json",
        )
        assert locked.status_code == status.HTTP_200_OK
        blocked = session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/description/",
            {"description_html": "<p>Hello</p>", "description_json": {}},
            format="json",
        )
        assert blocked.status_code == status.HTTP_400_BAD_REQUEST

        session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/state/",
            {"is_locked": False, "archived": True},
            format="json",
        )
        listing = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/")
        assert node_id not in {node["id"] for node in listing.data}
        archived = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/?archived=1")
        assert node_id in {node["id"] for node in archived.data}

    def test_search_hides_private_files_and_duplicate_starts_fresh(self, session_client, workspace, create_user):
        other = _member(workspace, 15)
        created = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": _root_id(session_client, workspace), "name": "Secret manual", "node_type": "file"},
            format="json",
        )
        node_id = created.data["id"]
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/description/",
            {"description_html": "<p>classified</p>", "description_json": {}},
            format="json",
        )
        session_client.force_authenticate(user=other)
        hidden = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/search/?q=classified")
        assert node_id not in {node["id"] for node in hidden.data}

        session_client.force_authenticate(user=create_user)
        session_client.put(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/access/",
            {"member_id": str(other.id), "access": "visible"},
            format="json",
        )
        session_client.force_authenticate(user=other)
        found = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/search/?q=classified")
        assert node_id in {node["id"] for node in found.data}
        copied = session_client.post(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/duplicate/", format="json")
        assert copied.status_code == status.HTTP_201_CREATED
        assert copied.data["is_creator"] is True

        session_client.force_authenticate(user=create_user)
        invisible_copy = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/{copied.data['id']}/")
        assert invisible_copy.status_code == status.HTTP_404_NOT_FOUND

    def test_favorite_uses_the_file_name_and_hides_private_files(self, session_client, workspace, create_user):
        other = _member(workspace, 15)
        created = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": _root_id(session_client, workspace), "name": "Field notes", "node_type": "file"},
            format="json",
        )
        node_id = created.data["id"]
        session_client.force_authenticate(user=other)
        hidden = session_client.post(
            f"/api/workspaces/{workspace.slug}/user-favorites/",
            {"entity_type": "wiki", "entity_identifier": node_id},
            format="json",
        )
        assert hidden.status_code == status.HTTP_404_NOT_FOUND

        session_client.force_authenticate(user=create_user)
        saved = session_client.post(
            f"/api/workspaces/{workspace.slug}/user-favorites/",
            {"entity_type": "wiki", "entity_identifier": node_id},
            format="json",
        )
        assert saved.status_code == status.HTTP_200_OK
        assert saved.data["entity_data"]["name"] == "Field notes"


def _file(client, workspace, name="Notes"):
    created = client.post(
        f"/api/workspaces/{workspace.slug}/wiki/nodes/",
        {"parent_id": _root_id(client, workspace), "name": name, "node_type": "file"},
        format="json",
    )
    assert created.status_code == status.HTTP_201_CREATED
    return created.data["id"]


def _grant(client, workspace, node_id, member, access):
    response = client.put(
        f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/access/",
        {"member_id": str(member.id), "access": access},
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK


@pytest.mark.contract
class TestWikiChangeRequest:
    def test_draft_does_not_change_published_body_until_merge(self, session_client, workspace, create_user):
        other = _member(workspace, 15)
        node_id = _file(session_client, workspace)
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/description/",
            {"description_html": "<p>Published</p>", "description_json": {"type": "doc"}},
            format="json",
        )
        _grant(session_client, workspace, node_id, other, "editable")
        session_client.force_authenticate(user=other)
        opened = session_client.post(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/", format="json")
        assert opened.status_code == status.HTTP_201_CREATED
        change_id = opened.data["id"]
        again = session_client.post(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/", format="json")
        assert again.status_code == status.HTTP_200_OK
        assert again.data["id"] == change_id

        saved = session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"description_html": "<p>Proposal</p>", "description_json": {"type": "doc"}},
            format="json",
        )
        assert saved.status_code == status.HTTP_200_OK
        session_client.force_authenticate(user=create_user)
        published = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/")
        assert "Published" in published.data["description_html"]
        assert "Proposal" not in published.data["description_html"]

        session_client.force_authenticate(user=other)
        submitted = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "submit"},
            format="json",
        )
        assert submitted.data["status"] == "in_review"
        session_client.force_authenticate(user=create_user)
        merged = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "merge"},
            format="json",
        )
        assert merged.status_code == status.HTTP_200_OK
        assert merged.data["status"] == "merged"
        published = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/")
        assert "Proposal" in published.data["description_html"]
        versions = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/versions/")
        assert change_id in {version["change_request"] for version in versions.data}

    def test_visible_member_cannot_open_a_change_and_stale_merge_is_blocked(
        self, session_client, workspace, create_user
    ):
        other = _member(workspace, 15)
        node_id = _file(session_client, workspace, "Shared")
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/description/",
            {"description_html": "<p>One</p>", "description_json": {}},
            format="json",
        )
        _grant(session_client, workspace, node_id, other, "visible")
        session_client.force_authenticate(user=other)
        denied = session_client.post(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/", format="json")
        assert denied.status_code == status.HTTP_403_FORBIDDEN

        session_client.force_authenticate(user=create_user)
        _grant(session_client, workspace, node_id, other, "editable")
        session_client.force_authenticate(user=other)
        opened = session_client.post(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/", format="json")
        change_id = opened.data["id"]
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"description_html": "<p>Two</p>", "description_json": {}},
            format="json",
        )
        session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "submit"},
            format="json",
        )
        session_client.force_authenticate(user=create_user)
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/description/",
            {"description_html": "<p>Three</p>", "description_json": {}},
            format="json",
        )
        blocked = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "merge"},
            format="json",
        )
        assert blocked.status_code == status.HTTP_409_CONFLICT
        published = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/")
        assert "Three" in published.data["description_html"]
        assert "Two" not in published.data["description_html"]

        returned = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "return", "comment": "Please rebase"},
            format="json",
        )
        assert returned.data["status"] == "changes_requested"
        session_client.force_authenticate(user=other)
        edited = session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"description_html": "<p>Four</p>", "description_json": {}},
            format="json",
        )
        assert edited.status_code == status.HTTP_200_OK

    def test_downgraded_author_cannot_update_but_creator_can_still_merge(self, session_client, workspace, create_user):
        other = _member(workspace, 15)
        node_id = _file(session_client, workspace, "Review")
        _grant(session_client, workspace, node_id, other, "editable")
        session_client.force_authenticate(user=other)
        opened = session_client.post(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/", format="json")
        change_id = opened.data["id"]
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"description_html": "<p>Ready</p>", "description_json": {}},
            format="json",
        )
        session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "submit"},
            format="json",
        )
        withdrawn = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "withdraw"},
            format="json",
        )
        assert withdrawn.data["status"] == "draft"
        session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "submit"},
            format="json",
        )
        session_client.force_authenticate(user=create_user)
        _grant(session_client, workspace, node_id, other, "visible")
        session_client.force_authenticate(user=other)
        denied = session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"description_html": "<p>Late</p>", "description_json": {}},
            format="json",
        )
        assert denied.status_code == status.HTTP_403_FORBIDDEN
        session_client.force_authenticate(user=create_user)
        merged = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "merge"},
            format="json",
        )
        assert merged.status_code == status.HTTP_200_OK
        published = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/")
        assert "Ready" in published.data["description_html"]


def _paragraph(block_id, text):
    return {"type": "paragraph", "attrs": {"id": block_id}, "content": [{"type": "text", "text": text}]}


def _doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


@pytest.mark.contract
class TestWikiConflict:
    def test_disjoint_block_edits_merge_automatically(self, session_client, workspace, create_user):
        other = _member(workspace, 15)
        node_id = _file(session_client, workspace, "Blocks")
        baseline = _doc(_paragraph("a", "Alpha"), _paragraph("b", "Beta"))
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/description/",
            {"description_html": "<p>Alpha</p><p>Beta</p>", "description_json": baseline},
            format="json",
        )
        _grant(session_client, workspace, node_id, other, "editable")
        session_client.force_authenticate(user=other)
        opened = session_client.post(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/", format="json")
        change_id = opened.data["id"]
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {
                "description_html": "<p>Alpha</p><p>Beta draft</p>",
                "description_json": _doc(_paragraph("a", "Alpha"), _paragraph("b", "Beta draft")),
            },
            format="json",
        )
        session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "submit"},
            format="json",
        )
        session_client.force_authenticate(user=create_user)
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/description/",
            {
                "description_html": "<p>Alpha current</p><p>Beta</p>",
                "description_json": _doc(_paragraph("a", "Alpha current"), _paragraph("b", "Beta")),
            },
            format="json",
        )
        merged = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "merge"},
            format="json",
        )
        assert merged.status_code == status.HTTP_200_OK
        published = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/")
        assert "Alpha current" in published.data["description_html"]
        assert "Beta draft" in published.data["description_html"]

    def test_overlapping_block_stays_blocked_until_the_creator_chooses(self, session_client, workspace, create_user):
        other = _member(workspace, 15)
        node_id = _file(session_client, workspace, "Overlap")
        baseline = _doc(_paragraph("a", "Alpha"), _paragraph("b", "Beta"))
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/description/",
            {"description_html": "<p>Alpha</p><p>Beta</p>", "description_json": baseline},
            format="json",
        )
        _grant(session_client, workspace, node_id, other, "editable")
        session_client.force_authenticate(user=other)
        opened = session_client.post(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/", format="json")
        change_id = opened.data["id"]
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {
                "description_html": "<p>Alpha draft</p><p>Beta</p>",
                "description_json": _doc(_paragraph("a", "Alpha draft"), _paragraph("b", "Beta")),
            },
            format="json",
        )
        session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "submit"},
            format="json",
        )
        session_client.force_authenticate(user=create_user)
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/description/",
            {
                "description_html": "<p>Alpha current</p><p>Beta</p>",
                "description_json": _doc(_paragraph("a", "Alpha current"), _paragraph("b", "Beta")),
            },
            format="json",
        )
        blocked = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "merge"},
            format="json",
        )
        assert blocked.status_code == status.HTTP_409_CONFLICT
        resolved = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {
                "action": "merge",
                "resolutions": [{"id": "a", "choice": "draft"}],
                "description_html": "<p>Alpha draft</p><p>Beta</p>",
                "description_json": _doc(_paragraph("a", "Alpha draft"), _paragraph("b", "Beta")),
            },
            format="json",
        )
        assert resolved.status_code == status.HTTP_200_OK
        published = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/")
        assert "Alpha draft" in published.data["description_html"]
        assert "Alpha current" not in published.data["description_html"]
        assert "Beta" in published.data["description_html"]


def _notices(user, node_id, field=None):
    query = Notification.objects.filter(receiver=user, entity_name="wiki", entity_identifier=node_id)
    if field is not None:
        query = query.filter(data__wiki__field=field)
    return query


@pytest.mark.contract
class TestWikiNotifications:
    def test_invisible_member_receives_no_content_notification(self, session_client, workspace, create_user):
        author = _member(workspace, 15)
        outsider = _member(workspace, 15)
        node_id = _file(session_client, workspace, "Review notes")
        _grant(session_client, workspace, node_id, author, "editable")
        session_client.force_authenticate(user=author)
        opened = session_client.post(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/", format="json")
        change_id = opened.data["id"]
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"description_html": "<p>Proposal</p>", "description_json": {"type": "doc"}},
            format="json",
        )
        submitted = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "submit"},
            format="json",
        )
        assert submitted.status_code == status.HTTP_200_OK

        session_client.force_authenticate(user=create_user)
        inbox = session_client.get(f"/api/workspaces/{workspace.slug}/users/notifications/")
        assert inbox.status_code == status.HTTP_200_OK
        assert any(
            item["entity_name"] == "wiki" and item["data"]["wiki"]["field"] == "submitted" for item in inbox.data
        )
        assert _notices(create_user, node_id, "submitted").count() == 1
        assert _notices(author, node_id, "submitted").count() == 0
        assert _notices(outsider, node_id).count() == 0

        _grant(session_client, workspace, node_id, author, "invisible")
        returned = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "return", "comment": "Hold"},
            format="json",
        )
        assert returned.status_code == status.HTTP_200_OK
        assert _notices(author, node_id, "returned").count() == 0
        session_client.force_authenticate(user=author)
        hidden = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/")
        assert hidden.status_code == status.HTTP_404_NOT_FOUND

    def test_visible_downgrade_blocks_the_draft_but_review_continues(self, session_client, workspace, create_user):
        author = _member(workspace, 15)
        node_id = _file(session_client, workspace, "Shared draft")
        _grant(session_client, workspace, node_id, author, "editable")
        session_client.force_authenticate(user=author)
        opened = session_client.post(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/", format="json")
        change_id = opened.data["id"]
        submitted = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "submit"},
            format="json",
        )
        assert submitted.status_code == status.HTTP_200_OK
        session_client.force_authenticate(user=create_user)
        _grant(session_client, workspace, node_id, author, "visible")
        session_client.force_authenticate(user=author)
        blocked = session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"description_html": "<p>Later</p>", "description_json": {"type": "doc"}},
            format="json",
        )
        assert blocked.status_code == status.HTTP_403_FORBIDDEN
        session_client.force_authenticate(user=create_user)
        returned = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "return", "comment": "Still open"},
            format="json",
        )
        assert returned.status_code == status.HTTP_200_OK
        assert _notices(author, node_id, "returned").count() == 1
        closed = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "close"},
            format="json",
        )
        assert closed.status_code == status.HTTP_200_OK
        assert _notices(author, node_id, "closed").count() == 1

    def test_access_lock_and_archive_notify_only_people_who_can_view(self, session_client, workspace, create_user):
        author = _member(workspace, 15)
        hidden = _member(workspace, 15)
        node_id = _file(session_client, workspace, "Guarded")
        denied = session_client.put(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/access/",
            {"member_id": str(hidden.id), "access": "invisible"},
            format="json",
        )
        assert denied.status_code == status.HTTP_200_OK
        assert _notices(hidden, node_id, "access").count() == 0
        _grant(session_client, workspace, node_id, author, "editable")
        assert _notices(author, node_id, "access").count() == 1

        session_client.force_authenticate(user=author)
        opened = session_client.post(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/", format="json")
        change_id = opened.data["id"]
        session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/changes/{change_id}/",
            {"action": "submit"},
            format="json",
        )
        session_client.force_authenticate(user=create_user)
        locked = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/state/",
            {"is_locked": True},
            format="json",
        )
        assert locked.status_code == status.HTTP_200_OK
        archived = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/state/",
            {"archived": True},
            format="json",
        )
        assert archived.status_code == status.HTTP_200_OK
        assert _notices(author, node_id, "locked").count() == 1
        assert _notices(author, node_id, "archived").count() == 1
        assert _notices(hidden, node_id).count() == 0

    def test_folder_loses_create_but_keeps_existing_children(self, session_client, workspace, create_user):
        author = _member(workspace, 15)
        folder = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": _root_id(session_client, workspace), "name": "Shared shelf", "node_type": "folder"},
            format="json",
        )
        folder_id = folder.data["id"]
        _grant(session_client, workspace, folder_id, author, "editable")
        session_client.force_authenticate(user=author)
        child = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": folder_id, "name": "Kept", "node_type": "file"},
            format="json",
        )
        assert child.status_code == status.HTTP_201_CREATED
        session_client.force_authenticate(user=create_user)
        _grant(session_client, workspace, folder_id, author, "visible")
        session_client.force_authenticate(user=author)
        blocked = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/",
            {"parent_id": folder_id, "name": "Blocked", "node_type": "file"},
            format="json",
        )
        assert blocked.status_code == status.HTTP_400_BAD_REQUEST
        kept = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/{child.data['id']}/")
        assert kept.status_code == status.HTTP_200_OK

    def test_search_recent_favorite_and_duplicate_follow_access(self, session_client, workspace, create_user):
        reader = _member(workspace, 15)
        node_id = _file(session_client, workspace, "Classified notes")
        described = session_client.patch(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/description/",
            {"description_html": "<p>classified phrase</p>", "description_json": {"type": "doc"}},
            format="json",
        )
        assert described.status_code == status.HTTP_200_OK
        _grant(session_client, workspace, node_id, reader, "visible")
        session_client.force_authenticate(user=reader)
        opened = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/")
        assert opened.status_code == status.HTTP_200_OK
        found = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/search/?q=classified")
        recent = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/recent/")
        saved = session_client.post(
            f"/api/workspaces/{workspace.slug}/user-favorites/",
            {"entity_type": "wiki", "entity_identifier": node_id},
            format="json",
        )
        assert node_id in {item["id"] for item in found.data}
        assert node_id in {item["id"] for item in recent.data}
        assert saved.status_code == status.HTTP_200_OK

        session_client.force_authenticate(user=create_user)
        _grant(session_client, workspace, node_id, reader, "invisible")
        session_client.force_authenticate(user=reader)
        hidden_search = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/search/?q=classified")
        hidden_recent = session_client.get(f"/api/workspaces/{workspace.slug}/wiki/recent/")
        favorites = session_client.get(f"/api/workspaces/{workspace.slug}/user-favorites/")
        hidden_row = next(item for item in favorites.data if item["entity_identifier"] == node_id)
        assert hidden_row["entity_data"] is None
        session_client.delete(f"/api/workspaces/{workspace.slug}/user-favorites/{saved.data['id']}/")
        hidden_favorite = session_client.post(
            f"/api/workspaces/{workspace.slug}/user-favorites/",
            {"entity_type": "wiki", "entity_identifier": node_id},
            format="json",
        )
        copied = session_client.post(
            f"/api/workspaces/{workspace.slug}/wiki/nodes/{node_id}/duplicate/",
            format="json",
        )
        assert hidden_search.data == []
        assert node_id not in {item["id"] for item in hidden_recent.data}
        assert hidden_favorite.status_code == status.HTTP_404_NOT_FOUND
        assert copied.status_code == status.HTTP_404_NOT_FOUND
