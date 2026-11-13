"""Wiki write tools and supporting reads for history, permissions and review."""

from typing import Any, Literal
from uuid import UUID

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from .client import PlaneClient


def register_wiki_tools(server: FastMCP, client: PlaneClient, workspace: str) -> None:
    def node_path(node_id: UUID) -> str:
        return f"{workspace}wiki/nodes/{node_id}/"

    read = ToolAnnotations(readOnlyHint=True)
    write = ToolAnnotations(readOnlyHint=False, destructiveHint=True)
    create = ToolAnnotations(readOnlyHint=False, destructiveHint=False)

    @server.tool(annotations=read)
    async def list_wiki_trash() -> Any:
        """List the token owner's deleted Wiki nodes. Restore parents before children."""
        return await client.request("GET", f"{workspace}wiki/trash/")

    @server.tool(annotations=read)
    async def list_wiki_versions(node_id: UUID) -> Any:
        """Read document history, including version UUIDs and content for restoration."""
        return await client.request("GET", node_path(node_id) + "versions/")

    @server.tool(annotations=read)
    async def get_wiki_access(node_id: UUID) -> Any:
        """Read explicit and effective member access; only the node creator can inspect it."""
        return await client.request("GET", node_path(node_id) + "access/")

    @server.tool(annotations=read)
    async def list_wiki_changes(node_id: UUID) -> Any:
        """Read up to 50 change requests, permission flags and merge plans. Creators see all;
        other members see only their own requests. Use this before review or conflict resolution.
        """
        return await client.request("GET", node_path(node_id) + "changes/")

    if client.settings.read_only:
        return

    @server.tool(annotations=create)
    async def create_wiki_node(
        parent_id: UUID,
        name: str,
        node_type: Literal["folder", "file"],
        sort_order: float | None = None,
    ) -> Any:
        """Create a Wiki directory or empty document. Use update_wiki_content to fill a document."""
        if not name.strip() or len(name.strip()) > 255:
            raise ValueError("name must contain 1 to 255 characters")
        data: dict[str, Any] = {
            "parent_id": str(parent_id),
            "name": name.strip(),
            "node_type": node_type,
        }
        if sort_order is not None:
            data["sort_order"] = sort_order
        return await client.request("POST", f"{workspace}wiki/nodes/", data=data)

    @server.tool(annotations=write)
    async def update_wiki_node(
        node_id: UUID,
        name: str | None = None,
        parent_id: UUID | None = None,
        sort_order: float | None = None,
        logo_props: dict[str, Any] | None = None,
        color: str | None = None,
        view_props: dict[str, Any] | None = None,
    ) -> Any:
        """Rename, move, reorder or change icon/color/view properties. Creator only.
        Color/view properties apply only to unlocked, unarchived files per backend rules.
        """
        data = {
            k: v
            for k, v in {
                "name": name,
                "parent_id": str(parent_id) if parent_id else None,
                "sort_order": sort_order,
                "logo_props": logo_props,
                "color": color,
                "view_props": view_props,
            }.items()
            if v is not None
        }
        if not data:
            raise ValueError("At least one field is required")
        return await client.request("PATCH", node_path(node_id), data=data)

    @server.tool(annotations=write)
    async def update_wiki_content(
        node_id: UUID,
        description_html: str,
        description_json: dict[str, Any] | list[Any],
        base_html: str,
    ) -> Any:
        """Publish a complete document body as creator. First read current HTML and pass it as
        base_html to detect stale edits (409). Keep HTML and editor JSON consistent. Editable
        non-creators must use change requests. Locked/archived files cannot be published.
        """
        return await client.request(
            "PATCH",
            node_path(node_id) + "description/",
            data={
                "description_html": description_html,
                "description_json": description_json,
                "base_html": base_html,
            },
        )

    @server.tool(annotations=create)
    async def duplicate_wiki_node(node_id: UUID, parent_id: UUID | None = None) -> Any:
        """Copy a visible document into an editable directory; defaults to its current parent."""
        return await client.request(
            "POST",
            node_path(node_id) + "duplicate/",
            data={"parent_id": str(parent_id)} if parent_id else {},
        )

    @server.tool(annotations=write)
    async def set_wiki_state(
        node_id: UUID, is_locked: bool | None = None, archived: bool | None = None
    ) -> Any:
        """Lock/unlock a document or archive/unarchive a node. Creator only."""
        data = {
            k: v for k, v in {"is_locked": is_locked, "archived": archived}.items() if v is not None
        }
        if not data:
            raise ValueError("is_locked or archived is required")
        return await client.request("POST", node_path(node_id) + "state/", data=data)

    @server.tool(annotations=write)
    async def delete_wiki_node(node_id: UUID, confirmed: bool) -> Any:
        """Move a node and its descendants to trash. Creator only; folders containing nodes
        owned by other creators cannot be deleted. Require user confirmation before confirmed=true.
        """
        if not confirmed:
            raise ValueError("Deletion requires confirmed=true")
        return await client.request("DELETE", node_path(node_id))

    @server.tool(annotations=write)
    async def restore_wiki_node(node_id: UUID) -> Any:
        """Restore a node from trash. Parent must already be restored and editable."""
        return await client.request("POST", node_path(node_id) + "restore/", data={})

    @server.tool(annotations=write)
    async def restore_wiki_version(node_id: UUID, version_id: UUID) -> Any:
        """Replace current document content with a history version. Creator only; inspect
        list_wiki_versions first. Locked/archived documents cannot be restored.
        """
        return await client.request(
            "POST", node_path(node_id) + "versions/", data={"version_id": str(version_id)}
        )

    @server.tool(annotations=write)
    async def set_wiki_access(
        node_id: UUID, member_id: UUID, access: Literal["invisible", "visible", "editable"] | None
    ) -> Any:
        """Set another member's explicit node permission as creator. null removes the override
        and restores inherited access. Cannot exceed parent permission or grant guests access.
        """
        return await client.request(
            "PUT",
            node_path(node_id) + "access/",
            data={"member_id": str(member_id), "access": access},
        )

    @server.tool(annotations=create)
    async def create_wiki_change(node_id: UUID) -> Any:
        """Start/reuse a change-request draft as an editable non-creator. Then update the draft
        and submit it with act_on_wiki_change. Creators publish directly instead.
        """
        return await client.request("POST", node_path(node_id) + "changes/", data={})

    @server.tool(annotations=write)
    async def update_wiki_change(
        node_id: UUID,
        change_id: UUID,
        description_html: str,
        description_json: dict[str, Any] | list[Any],
    ) -> Any:
        """Save full HTML and editor JSON in your draft/returned change request."""
        return await client.request(
            "PATCH",
            node_path(node_id) + f"changes/{change_id}/",
            data={"description_html": description_html, "description_json": description_json},
        )

    @server.tool(annotations=write)
    async def act_on_wiki_change(
        node_id: UUID,
        change_id: UUID,
        action: Literal["submit", "withdraw", "close", "return", "merge"],
        comment: str | None = None,
        resolutions: list[dict[str, Any]] | None = None,
        description_html: str | None = None,
        description_json: dict[str, Any] | list[Any] | None = None,
    ) -> Any:
        """Submit/withdraw/close a request, or return/merge it as document creator. return requires
        a comment; close rejects/closes it. For merge conflicts, inspect list_wiki_changes and
        pass resolutions from its merge_plan; never resolve conflicts without user intent.
        Optional merged HTML and JSON must be supplied together.
        """
        if action == "return" and not (comment or "").strip():
            raise ValueError("Returning a request requires a comment")
        if (description_html is None) != (description_json is None):
            raise ValueError("description_html and description_json must be supplied together")
        data = {
            k: v
            for k, v in {
                "action": action,
                "comment": comment,
                "resolutions": resolutions,
                "description_html": description_html,
                "description_json": description_json,
            }.items()
            if v is not None
        }
        return await client.request("POST", node_path(node_id) + f"changes/{change_id}/", data=data)
