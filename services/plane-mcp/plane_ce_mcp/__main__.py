import argparse
import hmac
import os

import uvicorn
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from .client import PlaneClient, Settings
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Plane Community Edition MCP")
    parser.add_argument("transport", choices=["stdio", "http"], nargs="?", default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8211)
    args = parser.parse_args()
    try:
        server = create_server(PlaneClient(Settings.from_env()))
        if args.transport == "stdio":
            server.run(transport="stdio")
        else:
            app = BearerAuth(server.streamable_http_app(), os.getenv("PLANE_MCP_HTTP_TOKEN", ""))
            uvicorn.run(app, host=args.host, port=args.port)
    except (KeyError, ValueError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
