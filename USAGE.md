# Usage

Create a `routes/` folder and start the container. No source code needed.

## 1. Routes folder

```
routes/
  hello/
    handler.ts
```

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
  -p 6274:6274 \
  -v "$(pwd)/routes:/app/routes" \
  csakaszamok/rododentron:1
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
| `http://localhost:6274` | MCP Inspector |

**No restart needed** after adding or editing a handler.

## Authentication (optional)

```bash
docker run -d \
  -e TOKEN=mysecrettoken \
  -p 8081:3000 \
  -p 8082:3001 \
  -p 6274:6274 \
  -v "$(pwd)/routes:/app/routes" \
  csakaszamok/rododentron:1
```

Every request requires: `-H "Authorization: Bearer mysecrettoken"` or `?token=mysecrettoken`.
