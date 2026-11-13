import asyncio
import json

import httpx
import pytest

from plane_ce_mcp.client import PlaneClient, Settings
from plane_ce_mcp.server import create_server

NODE = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"

CASES = [
    (
        "create_wiki_node",
        {"parent_id": NODE, "name": "目录", "node_type": "folder"},
        "POST",
        "nodes/",
        {"parent_id": NODE, "name": "目录", "node_type": "folder"},
    ),
    (
        "update_wiki_node",
        {
            "node_id": NODE,
            "parent_id": OTHER,
            "sort_order": 0,
            "logo_props": {},
            "color": "",
            "view_props": {},
        },
        "PATCH",
        f"nodes/{NODE}/",
        {"parent_id": OTHER, "sort_order": 0, "logo_props": {}, "color": "", "view_props": {}},
    ),
    (
        "update_wiki_content",
        {
            "node_id": NODE,
            "description_html": "<p>正文</p>",
            "description_json": {},
            "base_html": "",
        },
        "PATCH",
        f"nodes/{NODE}/description/",
        {"description_html": "<p>正文</p>", "description_json": {}, "base_html": ""},
    ),
    (
        "duplicate_wiki_node",
        {"node_id": NODE, "parent_id": OTHER},
        "POST",
        f"nodes/{NODE}/duplicate/",
        {"parent_id": OTHER},
    ),
    (
        "set_wiki_state",
        {"node_id": NODE, "is_locked": False, "archived": False},
        "POST",
        f"nodes/{NODE}/state/",
        {"is_locked": False, "archived": False},
    ),
    ("delete_wiki_node", {"node_id": NODE, "confirmed": True}, "DELETE", f"nodes/{NODE}/", None),
    ("restore_wiki_node", {"node_id": NODE}, "POST", f"nodes/{NODE}/restore/", {}),
    (
        "restore_wiki_version",
        {"node_id": NODE, "version_id": OTHER},
        "POST",
        f"nodes/{NODE}/versions/",
        {"version_id": OTHER},
    ),
    (
        "set_wiki_access",
        {"node_id": NODE, "member_id": OTHER, "access": None},
        "PUT",
        f"nodes/{NODE}/access/",
        {"member_id": OTHER, "access": None},
    ),
    ("create_wiki_change", {"node_id": NODE}, "POST", f"nodes/{NODE}/changes/", {}),
    (
        "update_wiki_change",
        {"node_id": NODE, "change_id": OTHER, "description_html": "", "description_json": []},
        "PATCH",
        f"nodes/{NODE}/changes/{OTHER}/",
        {"description_html": "", "description_json": []},
    ),
    (
        "act_on_wiki_change",
        {
            "node_id": NODE,
            "change_id": OTHER,
            "action": "merge",
            "resolutions": [{"id": "block-1", "choice": "draft"}],
        },
        "POST",
        f"nodes/{NODE}/changes/{OTHER}/",
        {"action": "merge", "resolutions": [{"id": "block-1", "choice": "draft"}]},
    ),
    ("list_wiki_trash", {}, "GET", "trash/", None),
    ("list_wiki_versions", {"node_id": NODE}, "GET", f"nodes/{NODE}/versions/", None),
    ("get_wiki_access", {"node_id": NODE}, "GET", f"nodes/{NODE}/access/", None),
    ("list_wiki_changes", {"node_id": NODE}, "GET", f"nodes/{NODE}/changes/", None),
]


@pytest.mark.parametrize("tool,args,method,path,body", CASES)
def test_wiki_tool_routes(tool, args, method, path, body):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"success": True})

    async def run():
        client = PlaneClient(
            Settings("https://plane.test", "team", "secret"), httpx.MockTransport(handler)
        )
        server = create_server(client)
        await server.call_tool(tool, args)
        assert len(requests) == 1
        request = requests[0]
        assert request.method == method
        assert request.url.path == f"/api/v1/workspaces/team/wiki/{path}"
        assert (json.loads(request.content) if request.content else None) == body
        tools = {t.name: t for t in await server.list_tools()}
        assert tools[tool].annotations.readOnlyHint == (method == "GET")
        read_server = create_server(
            PlaneClient(Settings("https://plane.test", "team", "secret", True))
        )
        assert (tool in {t.name for t in await read_server.list_tools()}) == (method == "GET")

    asyncio.run(run())


@pytest.mark.parametrize(
    "tool,args",
    [
        ("delete_wiki_node", {"node_id": NODE, "confirmed": False}),
        ("set_wiki_state", {"node_id": NODE}),
        ("update_wiki_node", {"node_id": NODE}),
        ("create_wiki_node", {"parent_id": NODE, "name": " ", "node_type": "file"}),
        ("act_on_wiki_change", {"node_id": NODE, "change_id": OTHER, "action": "return"}),
        (
            "act_on_wiki_change",
            {
                "node_id": NODE,
                "change_id": OTHER,
                "action": "merge",
                "description_html": "<p>x</p>",
            },
        ),
    ],
)
def test_invalid_wiki_writes_never_reach_api(tool, args):
    async def run():
        def handler(request):
            pytest.fail("Invalid write reached Plane API")

        server = create_server(
            PlaneClient(
                Settings("https://plane.test", "team", "secret"), httpx.MockTransport(handler)
            )
        )
        with pytest.raises(Exception):
            await server.call_tool(tool, args)

    asyncio.run(run())
