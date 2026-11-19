import argparse
import hmac
import os

import httpx
import uvicorn
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from .client import PlaneClient, Settings, request_api_key
from .server import create_server


class BearerAuth:
    """Protect the whole HTTP surface, including requests after initialization."""

    def __init__(self, app: ASGIApp, token: str):
        if len(token) < 32:
            raise ValueError("PLANE_MCP_HTTP_TOKEN must contain at least 32 characters")
        self.app = app
        self.expected = f"Bearer {token}".encode()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            headers = dict(scope.get("headers", []))
            if not hmac.compare_digest(headers.get(b"authorization", b""), self.expected):
                await JSONResponse(
                    {"error": "Unauthorized"},
                    status_code=401,
                    headers={"WWW-Authenticate": "Bearer"},
                )(scope, receive, send)
                return
        await self.app(scope, receive, send)


class PersonalTokenAuth:
    """Validate a personal token for every HTTP request and isolate its context."""

    def __init__(self, app: ASGIApp, settings: Settings):
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        authorization = dict(scope.get("headers", [])).get(b"authorization", b"")
        scheme, _, value = authorization.partition(b" ")
        token = value.decode("ascii", errors="ignore")
        if (
            scheme.lower() != b"bearer"
            or not token.startswith("plane_api_")
            or not token.replace("_", "").isalnum()
        ):
            await JSONResponse(
                {"error": "Unauthorized"}, status_code=401, headers={"WWW-Authenticate": "Bearer"}
            )(scope, receive, send)
            return
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
                response = await client.get(
                    f"{self.settings.base_url}/api/v1/users/me/",
                    headers={"X-Api-Key": token},
                )
        except httpx.RequestError:
            await JSONResponse({"error": "Plane API unavailable"}, status_code=503)(
                scope, receive, send
            )
            return
        if response.status_code != 200:
            code = response.status_code if response.status_code in (401, 403, 429) else 503
            headers = {"WWW-Authenticate": "Bearer"} if code == 401 else {}
            if code == 429 and response.headers.get("retry-after"):
                headers["Retry-After"] = response.headers["retry-after"]
            await JSONResponse(
                {"error": "Plane authentication failed"}, status_code=code, headers=headers
            )(scope, receive, send)
            return
        context = request_api_key.set(token)
        try:
            await self.app(scope, receive, send)
        finally:
            request_api_key.reset(context)


def main() -> None:
    parser = argparse.ArgumentParser(description="Plane Community Edition MCP")
    parser.add_argument("transport", choices=["stdio", "http"], nargs="?", default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8211)
    args = parser.parse_args()
    try:
        settings = Settings.from_env()
        if settings.per_user and args.transport != "http":
            raise ValueError("per_user authentication requires HTTP transport")
        server = create_server(PlaneClient(settings))
        if args.transport == "stdio":
            server.run(transport="stdio")
        else:
            app = (
                PersonalTokenAuth(server.streamable_http_app(), settings)
                if settings.per_user
                else BearerAuth(server.streamable_http_app(), os.getenv("PLANE_MCP_HTTP_TOKEN", ""))
            )
            uvicorn.run(app, host=args.host, port=args.port)
    except (KeyError, ValueError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
