# Usage

Create a `routes/` folder and start the container. No source code needed.

## 1. Routes folder

One file per HTTP method; a `[name]` folder is a path parameter.

```
routes/
  items/
    GET.ts          → GET /items
    POST.ts         → POST /items
    [id]/
      GET.ts        → GET /items/{id}
```

```ts
// routes/items/GET.ts
export const openapi = {
  summary: "List items",
  parameters: [{ name: "q", in: "query", schema: { type: "string" } }],
};

export default async (req: Request) => {
  const q = new URL(req.url).searchParams.get("q");
  return Response.json({ q, items: [] });
};
```

The old style still works:

```ts
// routes/hello/handler.ts
import type { IncomingMessage, ServerResponse } from "node:http";

export const openapi = { summary: "Hello" };

export function handle(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "text/plain" }).end("Hello!");
}
```

## 2. Start the container

```bash
docker run -d \
  -p 8081:3000 \
  -p 8082:3001 \
  -v "$(pwd)/routes:/app/routes" \
  csakaszamok/rododentron:0.3.1
```

If your handlers need access to the Docker socket:

```bash
  -v /var/run/docker.sock:/var/run/docker.sock \
```

## 3. Available at

| | |
|---|---|
| `http://localhost:8081/<route>` | API endpoints |
| `http://localhost:8081/swagger` | Swagger UI (all routes) |
| `http://localhost:8081/mcp` | MCP server (Streamable HTTP), every route is a tool |
| `http://localhost:8082/mcp` | same MCP server on the standalone port (legacy SSE: `/sse`) |

**No restart needed** after adding or editing a route.

## MCP tools

Every route becomes an MCP tool, e.g. `GET /items` → `get_items`, `GET /items/[id]` → `get_items_by_id`. Query parameters, path parameters and JSON request body fields become tool arguments; the caller's `Authorization` header is forwarded to the route.

```ts
export const openapi = { summary: "Internal", mcp: false };               // not exposed as a tool
export const openapi = { summary: "List", mcp: { name: "list_things" } }; // custom tool name
```

Example client config:

```json
{
  "mcpServers": {
    "rododentron": {
      "type": "http",
      "url": "http://localhost:8081/mcp",
      "headers": { "Authorization": "Bearer mysecrettoken" }
    }
  }
}
```

## Environment variables

| Variable | Effect |
|---|---|
| `TOKEN` | Bearer token for the API and `/mcp`; no token → no auth |
| `MCP=off` | disables `/mcp` on port 3000 |
| `INSPECTOR=on` | starts the MCP Inspector on port 6274 (publish `-p 6274:6274 -p 6277:6277`); it runs with auth, the login link is in `docker logs` |

## Authentication (optional)

```bash
docker run -d \
  -e TOKEN=mysecrettoken \
  -p 8081:3000 \
  -p 8082:3001 \
  -v "$(pwd)/routes:/app/routes" \
  csakaszamok/rododentron:0.3.1
```

Every request requires: `-H "Authorization: Bearer mysecrettoken"` or `?token=mysecrettoken`.
