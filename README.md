# rododentron (pleda)

Fájlalapú HTTP API szerver TypeScript-ben. Minden route egy fájl — a szerver automatikusan betölti, újratölti módosításkor, és OpenAPI specet generál belőle. MCP SSE szerveren is elérhetők az endpointok.

**Végfelhasználóknak:** Lásd [USAGE.md](USAGE.md) — csak Docker és egy `routes/` mappa kell.

---

## Fejlesztői gyors start

```bash
npm install
npm start          # HTTP API → http://localhost:3000
npm run mcp        # MCP SSE → http://localhost:3001
```

Docker-rel:

```bash
docker compose up --build
# HTTP API → http://localhost:8081
# MCP SSE  → http://localhost:8082
# MCP Inspector → http://localhost:6274
```

## Új endpoint hozzáadása

Hozz létre egy mappát és egy `handler.ts` fájlt a `routes/` alá:

```
routes/
  valami/
    handler.ts       → GET /valami
  foo/bar/
    handler.ts       → GET /foo/bar
```

**Minimális handler:**

```ts
import type { IncomingMessage, ServerResponse } from "node:http";

export const openapi = {
  summary: "Rövid leírás",
};

export function handle(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "text/plain" }).end("OK");
}
```

**Query paraméterekkel:**

```ts
export const openapi = {
  summary: "Köszönés",
  parameters: [
    {
      name: "name",
      in: "query",
      schema: { type: "string" },
      description: "Kinek szóljon",
      required: false,
    },
  ],
};

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const name = url.searchParams.get("name") ?? "World";
  res.writeHead(200, { "Content-Type": "text/plain" }).end(`Hello, ${name}!`);
}
```

A szerver **hot-reload** nélkül is frissíti a handlert: mtime-alapú cache-sel minden kérésnél ellenőrzi, változott-e a fájl, és ha igen, újratölti. Újraindítás nem kell.

## OpenAPI / Swagger

Az összes route automatikusan megjelenik:

- **Swagger UI:** `http://localhost:3000/swagger`
- **JSON spec:** `http://localhost:3000/swagger.json`

A handler `openapi` exportjából épül fel: `summary`, `description`, `parameters`, `requestBody`, `responses`, `tags` mezők használhatók (OpenAPI 3.0 konvenció szerint).

## MCP integráció

Az `mcp.ts` ugyanazokat a route-okat MCP toolként is elérhetővé teszi SSE-n. Az MCP tool neve a route útjából képződik, `/` → `_` csere:

| Route          | MCP tool neve    |
|----------------|------------------|
| `/hello`       | `hello`          |
| `/whoami/create` | `whoami_create` |

A handler `openapi.parameters` (query paraméterek) lesznek az MCP tool inputSchema mezői.

**MCP Inspector** (böngészőből tesztelhető): `http://localhost:6274`

## Autentikáció

Ha a `TOKEN` környezeti változó be van állítva, minden kéréshez szükséges:

```bash
# Bearer header
curl -H "Authorization: Bearer abc123" http://localhost:3000/hello

# vagy query paraméterként
curl http://localhost:3000/hello?token=abc123
```

A Swagger UI "Authorize" gombjánál is megadható. Ha `TOKEN` nincs beállítva, nincs auth.

## Docker socket hozzáférés

A `routes/docker/handler.ts` és a `routes/whoami/create/handler.ts` a Docker sockethez fér hozzá (`/var/run/docker.sock`). Docker Compose-ban a socket mount automatikus; lokális futtatásnál a socket elérhetőségét manuálisan kell biztosítani.

## Portok

| Port (host) | Port (konténer) | Szolgáltatás        |
|-------------|-----------------|---------------------|
| 8081        | 3000            | HTTP API            |
| 8082        | 3001            | MCP SSE             |
| 6274        | 6274            | MCP Inspector UI    |
| 6277        | 6277            | MCP Inspector proxy |

## Struktúra

```
routes/
  <útvonal>/
    handler.ts     ← handle() + openapi export
server.ts          ← HTTP API szerver (3000)
mcp.ts             ← MCP SSE szerver (3001)
ecosystem.config.cjs ← pm2 konfig (Docker-ben fut)
Dockerfile
docker-compose.yml
```
