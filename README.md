# rododentron (pleda)

Fájlalapú HTTP API szerver TypeScript-ben. Minden route egy fájl — a szerver automatikusan betölti, újratölti módosításkor, és OpenAPI specet generál belőle. Minden route automatikusan MCP tool is (Streamable HTTP, `/mcp`).

**Végfelhasználóknak:** Lásd [USAGE.md](USAGE.md) — csak Docker és egy `routes/` mappa kell.

---

## Fejlesztői gyors start

```bash
npm install
npm start          # HTTP API → http://localhost:3000, MCP → http://localhost:3000/mcp
npm run mcp        # önálló MCP szerver → http://localhost:3001/mcp (+ régi /sse)
```

Docker-rel:

```bash
docker compose up --build
# HTTP API → http://localhost:8081
# MCP      → http://localhost:8081/mcp és http://localhost:8082/mcp
# MCP Inspector → http://localhost:6274 (csak INSPECTOR=on mellett)
```

## Új endpoint hozzáadása

Hozz létre egy mappát a `routes/` alá, benne metódusonként egy fájllal (`GET.ts`, `POST.ts`, `PUT.ts`, `PATCH.ts`, `DELETE.ts`). A `[név]` mappa útvonal-paraméter:

```
routes/
  items/
    GET.ts           → GET /items
    POST.ts          → POST /items
    [id]/
      GET.ts         → GET /items/{id}
      DELETE.ts      → DELETE /items/{id}
```

**Minimális route:**

```ts
export const openapi = {
  summary: "Rövid leírás",
};

export default async (req: Request): Promise<Response> => {
  return Response.json({ ok: true });
};
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

export default async (req: Request) => {
  const name = new URL(req.url).searchParams.get("name") ?? "World";
  return new Response(`Hello, ${name}!`);
};
```

**JSON request body-val:**

```ts
export const openapi = {
  summary: "Elem létrehozása",
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            count: { type: "number" },
          },
        },
      },
    },
  },
};

export default async (req: Request) => Response.json(await req.json(), { status: 201 });
```

**Régi stílus (`handler.ts`)** — továbbra is működik; ha ugyanabban a mappában `GET.ts` is van, az élvez elsőbbséget:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";

export const openapi = { summary: "Rövid leírás" };

export function handle(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "text/plain" }).end("OK");
}
```

A szerver **hot-reload** nélkül is frissíti a route-ot: mtime-alapú cache-sel minden kérésnél ellenőrzi, változott-e a fájl, és ha igen, újratölti. Újraindítás nem kell.

## OpenAPI / Swagger

Az összes route automatikusan megjelenik:

- **Swagger UI:** `http://localhost:3000/swagger`
- **JSON spec:** `http://localhost:3000/swagger.json`

A route `openapi` exportjából épül fel: `summary`, `description`, `parameters`, `requestBody`, `responses`, `tags` mezők használhatók (OpenAPI 3.0 konvenció szerint). Az `openapi.method` felülírja a fájlnévből adódó metódust.

## MCP integráció

Minden route automatikusan MCP tool. Az `mcp-core.ts` állítja elő őket ugyanabból a `routes/` mappából és `openapi` exportból, amiből a Swagger is készül. Átvitel: **Streamable HTTP** (stateless), a `/mcp` útvonalon:

- `http://localhost:3000/mcp` — a HTTP API-val azonos porton (kikapcsolható: `MCP=off`)
- `http://localhost:3001/mcp` — az önálló `mcp.ts` szerveren; itt a régi SSE (`/sse` + `/message`) is elérhető visszafelé-kompatibilitásnak

Mindkettőre ugyanaz a `TOKEN`-ellenőrzés vonatkozik, mint az API-ra.

**Tool-név:** `openapi.mcp.name` → `openapi.operationId` → `<metódus>_<szegmensek>`, ahol `[x]` → `by_x`:

| Route                          | MCP tool neve                 |
|--------------------------------|-------------------------------|
| `GET /items`                   | `get_items`                   |
| `POST /items`                  | `post_items`                  |
| `GET /items/[id]`              | `get_items_by_id`             |
| `GET /sandboxes/[name]/logs`   | `get_sandboxes_by_name_logs`  |

Ütköző vagy 64 karakternél hosszabb név rövidítést és egy rövid hash-végződést kap.

**Paraméterek** (a tool `inputSchema`-ja lapos objektum):
- útvonal-paraméterek (`[x]`): kötelező string;
- az `openapi.parameters` `in: "query"` elemei;
- a JSON `requestBody` schema `properties` mezői a `required` listával (a schema többi kulcsa — `pattern`, `enum`, `default`… — változatlanul átkerül). Ha egy body-mező neve ütközik útvonal- vagy query-paraméterrel, a teljes body egy `body` objektum paraméter alá kerül;
- nem JSON body (pl. `text/plain`) → `body` string paraméter.

**Annotációk:** GET → `readOnlyHint`, DELETE → `destructiveHint`.

**Kihagyás, egyedi név:**

```ts
export const openapi = { summary: "Belső végpont", mcp: false };          // nem lesz tool (HTTP-n és Swaggerben megmarad)
export const openapi = { summary: "Listázás", mcp: { name: "list_things" } };
```

**Hívás:** a tool a route-ot közvetlenül hívja (HTTP nélkül), a megfelelő metódussal, útvonallal, query-vel és JSON body-val. A bejövő MCP kérés `Authorization` fejléce továbbmegy a route-nak, így a route saját auth-ja is működik. JSON/szöveges válasz szövegként jön vissza (100 000 bájt felett levágva), egyéb tartalomnál csak a típus és a méret. HTTP ≥ 400 → `isError: true`.

**Beépítés másik szerverbe** (pl. egy erre épülő image saját `server.ts`-ében):

```ts
import { createMcpHandler, listMcpTools } from "./mcp-core.ts";

const mcp = createMcpHandler({
  name: "p7y",
  forwardHeaders: ["authorization", "x-user"],   // alap: ["authorization"]
  include: (r) => r.openapi.mcp !== false && !r.path.startsWith("/internal"),
  maxResponseBytes: 50_000,
});

// a saját auth után; (req: Request) => Promise<Response>
if (url.pathname === "/mcp") return mcp(request);
```

Opciók: `routesDir` (alap `./routes`), `name`, `version`, `forwardHeaders`, `include(route)` — `route.method`, `route.path` OpenAPI-formában (pl. `/items/{id}`), `route.openapi` —, `maxResponseBytes`. A `listMcpTools(opts)` ugyanezt a tool-listát adja vissza.

**MCP Inspector** (böngészőből tesztelhető): csak `INSPECTOR=on` mellett indul, `http://localhost:6274`. Auth-tal fut; a belépő link (session tokennel) a konténer logjában van (`docker logs`).

Kipróbálható példa route-ok és elfogadási teszt: [examples/mcp-demo/](examples/mcp-demo/).

## Autentikáció

Ha a `TOKEN` környezeti változó be van állítva, minden kéréshez szükséges (az `/mcp`-hez is):

```bash
# Bearer header
curl -H "Authorization: Bearer abc123" http://localhost:3000/hello

# vagy query paraméterként
curl http://localhost:3000/hello?token=abc123
```

A Swagger UI "Authorize" gombjánál is megadható. Ha `TOKEN` nincs beállítva, nincs auth.

## Környezeti változók

| Változó        | Hatás |
|----------------|-------|
| `TOKEN`        | Bearer token az API-hoz és az MCP-hez; ha nincs, nincs auth |
| `MCP=off`      | kikapcsolja a `/mcp`-t a :3000-es porton |
| `INSPECTOR=on` | elindítja az MCP Inspectort (auth-tal) |
| `API_TITLE`    | a Swagger spec címe |

## Docker socket hozzáférés

A `routes/docker/handler.ts` és a `routes/whoami/create/handler.ts` a Docker sockethez fér hozzá (`/var/run/docker.sock`). Docker Compose-ban a socket mount automatikus; lokális futtatásnál a socket elérhetőségét manuálisan kell biztosítani.

## Portok

| Port (host) | Port (konténer) | Szolgáltatás                          |
|-------------|-----------------|---------------------------------------|
| 8081        | 3000            | HTTP API + MCP (`/mcp`)               |
| 8082        | 3001            | MCP (`/mcp`, régi `/sse`)             |
| 6274        | 6274            | MCP Inspector UI (`INSPECTOR=on`)     |
| 6277        | 6277            | MCP Inspector proxy (`INSPECTOR=on`)  |

## Kiadás

Az image a `ghcr.io/p7y-dev/rododentron:<verzió>` címen érhető el; GitHub Actions teszi fel ([.github/workflows/release.yml](.github/workflows/release.yml)):

```bash
echo 0.3.2 > VERSION           # verzió emelése, commit, push
git tag v0.3.2                 # a tag egyezzen a VERSION fájllal
git push origin v0.3.2
```

Már kiadott verzió nem írható felül. A korábbi `csakaszamok/rododentron` Docker Hub image-ek változatlanul elérhetők; az `upload-docker.sh` elavult.

## Struktúra

```
routes/
  <útvonal>/
    GET.ts, POST.ts…   ← default(req) + openapi export
    handler.ts         ← régi stílus: handle(req, res) + openapi export
server.ts            ← HTTP API szerver + /mcp (3000)
mcp-core.ts          ← route-ok → MCP toolok (createMcpHandler, listMcpTools)
mcp.ts               ← önálló MCP szerver: /mcp + régi /sse (3001)
ecosystem.config.cjs ← pm2 konfig (Docker-ben fut)
examples/mcp-demo/   ← példa route-ok + MCP elfogadási teszt
.github/workflows/release.yml ← v* tagre: ghcr.io/p7y-dev/rododentron:<verzió>
Dockerfile
docker-compose.yml
```
