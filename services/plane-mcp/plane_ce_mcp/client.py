from dataclasses import dataclass, field
import os
from typing import Any
from urllib.parse import urlsplit

import httpx


@dataclass(frozen=True)
class Settings:
    base_url: str
    workspace: str
    api_key: str = field(repr=False)
    read_only: bool = False

    def __post_init__(self) -> None:
        url = urlsplit(self.base_url)
        if (
            url.scheme not in {"http", "https"}
            or not url.netloc
            or url.username
            or url.password
            or url.query
            or url.fragment
        ):
            raise ValueError(
                "PLANE_BASE_URL must be an HTTP(S) instance URL without credentials/query"
            )
        if not self.api_key.strip():
            raise ValueError("PLANE_API_KEY is required")
        segment(self.workspace)

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            os.environ["PLANE_BASE_URL"].rstrip("/"),
            os.environ["PLANE_WORKSPACE_SLUG"],
            os.environ["PLANE_API_KEY"],
            os.getenv("PLANE_MCP_READ_ONLY", "false").lower() == "true",
        )


def segment(value: str) -> str:
    if not value or any(
        c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in value
    ):
        raise ValueError("Invalid path identifier; use a UUID, slug or project identifier")
    return value


class PlaneClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.transport = transport

    async def request(
        self,
        method: str,
        path: str,
        *,
        data: dict[str, Any] | None = None,
        query: dict[str, Any] | None = None,
    ) -> Any:
        if self.settings.read_only and method != "GET":
            raise ValueError("Server is in read-only mode")
        # Never follow redirects: a misconfigured proxy must not receive our key on another host.
        async with httpx.AsyncClient(
            transport=self.transport, timeout=30, follow_redirects=False
        ) as client:
            try:
                response = await client.request(
                    method,
                    f"{self.settings.base_url.rstrip('/')}/api/v1/{path}",
                    headers={"x-api-key": self.settings.api_key},
                    json=data,
                    params=query,
                )
            except httpx.RequestError:
                raise ValueError(
                    "Plane API unavailable or timed out; check PLANE_BASE_URL"
                ) from None
        if not 200 <= response.status_code < 300:
            retry = response.headers.get("retry-after")
            suffix = f"; retry after {retry}" if response.status_code == 429 and retry else ""
            # Do not echo upstream bodies; they can include credentials or proxy diagnostics.
            raise ValueError(f"Plane API HTTP {response.status_code}{suffix}")
        if response.status_code == 204 or not response.content:
            return {"success": True}
        try:
            return response.json()
        except ValueError:
            raise ValueError(
                "Plane API returned non-JSON; check instance URL and reverse proxy"
            ) from None
