FROM ghcr.io/astral-sh/uv:0.12.9 AS uv
FROM python:3.12-slim
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY plane_ce_mcp ./plane_ce_mcp
RUN uv sync --frozen --no-dev
RUN useradd --uid 10001 --create-home mcp
USER mcp
EXPOSE 8211
CMD ["/app/.venv/bin/plane-ce-mcp", "http", "--host", "0.0.0.0"]
