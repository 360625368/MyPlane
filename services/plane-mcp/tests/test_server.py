import asyncio
from uuid import UUID

import httpx
import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from plane_ce_mcp.client import PlaneClient, Settings
from plane_ce_mcp.server import create_server
from plane_ce_mcp.__main__ import BearerAuth

PROJECT = UUID("11111111-1111-4111-8111-111111111111")
ITEM = UUID("22222222-2222-4222-8222-222222222222")


def make_client(handler, read_only=False):
    return PlaneClient(
        Settings("https://plane.test", "team", "secret", read_only), httpx.MockTransport(handler)
    )


def test_protocol_and_api_mapping():
    requests = []

    def handler(request):
        requests.append(request)
        assert request.headers["x-api-key"] == "secret"
        return httpx.Response(200, json={"results": [], "next_cursor": "next"})

    async def run():
        server = create_server(make_client(handler))
        async with create_connected_server_and_client_session(server._mcp_server) as session:
            tools = (await session.list_tools()).tools
            assert len(tools) == 9
            assert next(t for t in tools if t.name == "delete_resource").annotations.destructiveHint
            result = await session.call_tool(
                "list_resources",
                {
                    "resource": "comment",
                    "project_id": str(PROJECT),
                    "work_item_id": str(ITEM),
                    "query": {"cursor": "abc"},
                },
            )
            assert not result.isError
            assert "next_cursor" in result.content[0].text
            invalid = await session.call_tool(
                "get_resource", {"resource": "state", "item_id": str(ITEM)}
            )
            assert invalid.isError
            invalid_id = await session.call_tool(
                "get_resource", {"resource": "project", "item_id": "../escape"}
            )
            assert invalid_id.isError
        assert len(requests) == 1
        assert (
            requests[0].url.path
            == f"/api/v1/workspaces/team/projects/{PROJECT}/work-items/{ITEM}/comments/"
        )
        assert requests[0].url.params["cursor"] == "abc"

    asyncio.run(run())


def test_write_delete_and_read_only():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(204)

    async def run():
        server = create_server(make_client(handler))
        await server.call_tool(
            "create_resource",
            {"resource": "work_item", "project_id": str(PROJECT), "data": {"name": "Task"}},
        )
        await server.call_tool(
            "update_resource",
            {
                "resource": "label",
                "project_id": str(PROJECT),
                "item_id": str(ITEM),
                "data": {"name": "Label"},
            },
        )
        with pytest.raises(Exception, match="confirmed"):
            await server.call_tool(
                "delete_resource",
                {"resource": "project", "item_id": str(PROJECT), "confirmed": False},
            )
        await server.call_tool(
            "delete_resource", {"resource": "project", "item_id": str(PROJECT), "confirmed": True}
        )
        assert [r.method for r in requests] == ["POST", "PATCH", "DELETE"]
        read_client = make_client(handler, read_only=True)
        read_server = create_server(read_client)
        assert len(await read_server.list_tools()) == 6
        with pytest.raises(ValueError, match="read-only"):
            await read_client.request("POST", "projects/", data={})

    asyncio.run(run())


@pytest.mark.parametrize("status", [301, 401, 403, 404, 429, 500])
def test_upstream_errors_do_not_leak_secrets(status):
    async def run():
        client = make_client(
            lambda r: httpx.Response(
                status, text="secret diagnostics", headers={"Location": "https://evil.test"}
            )
        )
        with pytest.raises(ValueError, match=f"HTTP {status}") as exc:
            await client.request("GET", "users/me/")
        assert "secret" not in str(exc.value)

    asyncio.run(run())


def test_settings_validation():
    for url in [
        "file:///tmp/key",
        "https://user:secret@plane.test",
        "https://plane.test?key=secret",
    ]:
        with pytest.raises(ValueError):
            Settings(url, "team", "key")
    with pytest.raises(ValueError):
        Settings("https://plane.test", "../other", "key")
    assert "secret" not in repr(Settings("https://plane.test", "team", "secret"))


def test_http_auth_all_requests():
    async def run():
        async def app(scope, receive, send):
            from starlette.responses import JSONResponse

            await JSONResponse({"ok": True})(scope, receive, send)

        token = "a" * 32
        with pytest.raises(ValueError):
            BearerAuth(app, "short")
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=BearerAuth(app, token)), base_url="http://localhost"
        ) as client:
            for method in ["GET", "POST", "DELETE"]:
                assert (await client.request(method, "/mcp")).status_code == 401
                assert (
                    await client.request(
                        method, "/mcp", headers={"Authorization": f"Bearer {token}"}
                    )
                ).status_code == 200

    asyncio.run(run())
