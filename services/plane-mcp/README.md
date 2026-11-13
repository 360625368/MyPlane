# Plane CE MCP

针对本仓库 Community Edition `/api/v1/` 实现的独立 MCP 服务，不依赖商业版 OAuth、数据库或 Redis。参考官方 Plane MCP 的工具设计，使用 MCP Python SDK 自行实现，未复制官方代码。

## 本地运行（推荐）

需要 uv 和 Python 3.12+。在本目录运行：

```sh
uv sync --frozen
cp .env.example .env
# 编辑 .env，填写你的 Plane 地址、工作空间 slug 和 API Token
uv run --env-file .env plane-ce-mcp stdio
```

Plane 地址是实例根地址（如 http://localhost:8000 或 https://plane.example.com），不要附加 `/api/v1`。工作空间 slug 是网页 URL 中的工作空间路径段。API Token 在 Plane 个人设置中创建，权限沿用所属用户。stdio 模式无需 HTTP 密钥。

支持通用 mcpServers JSON 的客户端配置示例（将目录改为实际绝对路径）：

```json
{
  "mcpServers": {
    "plane-ce": {
      "command": "uv",
      "args": [
        "run",
        "--directory",
        "/Users/usmart/CursorProjects/Plane/services/plane-mcp",
        "--env-file",
        "/Users/usmart/CursorProjects/Plane/services/plane-mcp/.env",
        "plane-ce-mcp",
        "stdio"
      ]
    }
  }
}
```

客户端必须能找到 uv；否则把 command 改为 `command -v uv` 返回的绝对路径。密钥仅放本地 .env，该文件已忽略，不要提交。

## HTTP / Docker

HTTP 模式使用独立 Bearer 密钥，所有连接共用配置的 Plane 身份和工作空间。适合受信任的个人或团队客户端；不提供多用户身份隔离、OAuth 登录或自动注册。

```sh
# 生成连接密钥，填入 .env 中 PLANE_MCP_HTTP_TOKEN（至少32字符）
openssl rand -hex 32
uv run --env-file .env plane-ce-mcp http --host 127.0.0.1 --port 8211
# 或在本目录运行
 docker compose up -d --build
```

连接地址 `http://localhost:8211/mcp`，每次请求需带 `Authorization: Bearer <PLANE_MCP_HTTP_TOKEN>`。支持自定义 headers 的远程 MCP 客户端示例：

```json
{
  "mcpServers": {
    "plane-ce": {
      "url": "http://localhost:8211/mcp",
      "headers": { "Authorization": "Bearer <你的MCP连接密钥>" }
    }
  }
}
```

Docker 默认只映射宿主机回环地址。容器访问宿主机 Plane 使用 `http://host.docker.internal:<实际端口>`，访问其他容器则配置可达的实例地址/网络。外部连接时通过 HTTPS 反向代理转发，并保留 Authorization 头。无需改动现有 Plane Compose。

## 工具

| 工具                        | 功能                                                     |
| --------------------------- | -------------------------------------------------------- |
| list_resources              | 项目、工作项、评论、链接、周期、模块、状态、标签分页列表 |
| get_resource                | 按 UUID 读取上述资源                                     |
| create_resource             | 创建资源，data 接受社区版 REST 字段                      |
| update_resource             | PATCH 更新资源                                           |
| delete_resource             | 永久删除，要求 confirmed=true                            |
| current_user                | 验证 Plane Token，读取当前用户                           |
| list_members                | 工作空间或项目成员                                       |
| search_work_items           | 工作空间内搜索工作项                                     |
| get_work_item_by_identifier | 按项目标识和序号查询，如 WEB-42                          |
| list_wiki_nodes             | 列出可见 Wiki 目录和文件，包含父节点关系                 |
| search_wiki                 | 搜索可见 Wiki 标题和正文，最多 50 条                     |
| get_wiki_node               | 按节点 UUID 读取完整 HTML 和 JSON 正文                   |

resource 取值：project、work_item、comment、link、cycle、module、state、label。除 project 外要求 project_id；评论和链接额外要求 work_item_id。路径中的 ID 使用 UUID。list_resources 的 query 原样传递 CE 支持的过滤和分页参数；每次只取一页并保留原始分页结果，不自动遍历整个工作空间。

创建示例：`create_resource(resource="work_item", project_id="<UUID>", data={"name":"修复登录", "description_html":"<p>复现步骤</p>", "priority":"high"})`。先查询成员、状态、标签取得 UUID 后再指定 assignees、state 和 labels；评论使用 comment_html。

`PLANE_MCP_READ_ONLY=true` 隐藏所有写工具，并在 HTTP 客户端层拒绝写请求。删除确认标志是客户端交互约定，不是独立授权边界。上游报错返回 HTTP 状态码，429 保留 Retry-After，不输出密钥或上游原始错误页，也不自动重试写操作。

范围限于上表；暂不包含附件上传、周期/模块工作项关联、Intake、非 Wiki 归档、活动记录，也不宣称与官方 Cloud 工具兼容。实际功能受本仓库 CE API 和用户权限限制，不提供 Cloud 专有 PQL 或商业版功能。

## 自定义 Wiki 读写

需要同时部署本次更新后的 Plane API 和 MCP 服务。官方原版 Plane 不提供这里新增的 Wiki Token API，仅更新 MCP 镜像不能读取 Wiki。后端新增接口：

- `GET /api/v1/workspaces/{slug}/wiki/nodes/`
- `GET /api/v1/workspaces/{slug}/wiki/nodes/{node_id}/`
- `GET /api/v1/workspaces/{slug}/wiki/search/?q=关键字`

使用现有 x-api-key 鉴权和 API Token 限流；保留 Wiki 工作空间成员、节点显式授权及继承权限，访客和非成员不能访问。写操作复用网页的创建者检查、锁定/归档限制、正文校验、版本记录和修改申请审核流程。

用法：先调用 `list_wiki_nodes()` 查看目录树，或 `search_wiki(query="部署")` 查找标题/正文，再调用 `get_wiki_node(node_id="<UUID>")` 获取 `description_html`、`description_json`。目录列表不分页，搜索最多返回 50 条摘要；正文可能包含不可信文本。默认目录列表排除归档分支，`archived=true` 返回归档节点。读取文件沿用网页行为，会更新最近访问记录。

客户端重连 MCP 后可发现新工具。全部 Wiki 读取工具在只读模式下可用；`PLANE_MCP_READ_ONLY=true` 会隐藏全部 Wiki 写工具，客户端层也会拒绝写请求。

| 写工具               | 操作                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| create_wiki_node     | 新建目录或空文档（node_type=folder/file）                            |
| update_wiki_node     | 重命名、移动、排序、图标、颜色、展示属性                             |
| update_wiki_content  | 发布 HTML 和 JSON 正文，必传当前 base_html，过期返回409              |
| duplicate_wiki_node  | 复制文档，可指定目标目录                                             |
| set_wiki_state       | 锁定/解锁、归档/取消归档                                             |
| delete_wiki_node     | 移入回收站，包括后代节点，需 confirmed=true                          |
| restore_wiki_node    | 恢复回收站节点，先恢复父节点                                         |
| restore_wiki_version | 将指定历史版本恢复为当前正文                                         |
| set_wiki_access      | 设置 invisible/visible/editable；null 删除显式授权、恢复继承         |
| create_wiki_change   | 可编辑的非创建者创建或获取自己的修改草稿                             |
| update_wiki_change   | 编辑修改申请的 HTML 和 JSON                                          |
| act_on_wiki_change   | submit 提交、withdraw 撤回、close 关闭/拒绝、return 退回、merge 合并 |

配套读取工具：`list_wiki_trash` 查看自己的回收站；`list_wiki_versions` 查看历史；`get_wiki_access` 查看节点授权（创建者）；`list_wiki_changes` 查看申请和合并计划。创建者能查看该文档所有申请，其他成员只能查看自己的申请。

直接发布正文仅允许创建者；可编辑成员通过修改申请提交。`return` 必须填写 comment。`merge` 遇到冲突时先读取合并计划，再按用户选择传入 `resolutions=[{"id":"<冲突块ID>","choice":"current或draft或custom"}]`；custom 需附 block。可选的合并后 HTML/JSON 必须成对提供。409 上游响应不会直接返回完整错误体，可通过 `list_wiki_changes` 获取最新计划。

新增 Token API 在 `/api/v1/workspaces/{slug}/wiki/` 下与网页 Wiki 对齐：nodes 集合 GET/POST，节点 GET/PATCH/DELETE；节点子路径 description PATCH、duplicate POST、state POST、restore POST、versions GET/POST、access GET/PUT、changes GET/POST、changes/{change_id} PATCH/POST；trash 和 search 只读。没有新增永久清空回收站接口。

删除确认是客户端约定，不是独立审批。权限调整、通知、版本恢复及申请合并都以 Token 所属身份执行，HTTP 所有调用者共用此身份。

## 开发验证

```sh
uv sync --frozen
uv run pytest
uv run ruff check plane_ce_mcp tests
uv run ruff format --check plane_ce_mcp tests
```

测试使用模拟 Plane HTTP API，包含真实 MCP 初始化/工具发现/调用、路由映射、分页、写入、删除确认、只读模式、错误脱敏和 HTTP 鉴权。上线后先调用 current_user 和 list_resources(resource="project") 验证真实实例。

参考：[官方 Plane MCP](https://github.com/makeplane/plane-mcp-server)、[MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)。
