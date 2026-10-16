# MCP demo

Példa route-ok az MCP tool-generáláshoz és egy elfogadási teszt (SDK kliens, Streamable HTTP + régi SSE).

```bash
docker run -d --name rodo-mcp-test -e TOKEN=abc123 \
  -v "$(pwd)/routes:/app/routes" \
  -v "$(pwd)/test.ts:/app/test.ts" \
  csakaszamok/rododentron:0.3.1

docker exec -w /app rodo-mcp-test node_modules/.bin/tsx test.ts
docker rm -f rodo-mcp-test
```

| Route                     | Tool                 | Mit mutat |
|---------------------------|----------------------|-----------|
| `items/GET.ts`            | `get_items`          | query paraméter, `readOnlyHint` |
| `items/POST.ts`           | `post_items`         | JSON body lapítva, `required` |
| `items/[id]/GET.ts`       | `get_items_by_id`    | útvonal-paraméter, 404 → `isError` |
| `items/[id]/DELETE.ts`    | `delete_items_by_id` | `destructiveHint` |
| `items/[id]/PATCH.ts`     | `patch_items_by_id`  | body-mező ütközik az útvonal-paraméterrel → `body` objektum |
| `notes/POST.ts`           | `post_notes`         | `text/plain` body → `body` string |
| `whoami2/GET.ts`          | `get_whoami2`        | `Authorization` fejléc továbbítása |
| `renamed/GET.ts`          | `custom_tool`        | `openapi.mcp.name` |
| `hidden/GET.ts`           | —                    | `openapi.mcp = false` |
| `legacy/handler.ts`       | `get_legacy`         | régi `handle(req, res)` stílus |
