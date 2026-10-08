import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Supports both old-style handler.ts (handle(req,res)) and
// new-style METHOD.ts (default(req: Request): Promise<Response>)

type OldHandlerModule = {
  handle: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  openapi?: Record<string, unknown>;
};

type NewHandlerModule = {
  default: (req: Request) => Promise<Response>;
  openapi?: Record<string, unknown>;
};

type HandlerModule = OldHandlerModule | NewHandlerModule;

// --- Dinamikus handler betöltés mtime-alapú cache-sel ---

const cache = new Map<string, { mtime: number; mod: HandlerModule }>();

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

async function loadHandler(routePath: string, method: string): Promise<HandlerModule | null> {
  const base = join(process.cwd(), "routes", routePath);

  // Try method-based file first (GET.ts, POST.ts, etc.)
  const methodFile = join(base, `${method.toUpperCase()}.ts`);
  let stats;
  try { stats = await stat(methodFile); } catch { stats = null; }

  if (stats) {
    const mtime = stats.mtimeMs;
    const cached = cache.get(methodFile);
    if (cached?.mtime === mtime) return cached.mod;
    const mod = await import(pathToFileURL(methodFile).href + `?t=${mtime}`) as HandlerModule;
    cache.set(methodFile, { mtime, mod });
    return mod;
  }

  // Fall back to handler.ts
  const handlerFile = join(base, "handler.ts");
  try { stats = await stat(handlerFile); } catch { return null; }

  const mtime = stats.mtimeMs;
  const cached = cache.get(handlerFile);
  if (cached?.mtime === mtime) return cached.mod;

  const mod = await import(pathToFileURL(handlerFile).href + `?t=${mtime}`) as HandlerModule;
  cache.set(handlerFile, { mtime, mod });
  return mod;
}

// --- Swagger spec generálás ---

async function scanRoutes(dir: string, base = ""): Promise<Array<{ path: string; method: string; file: string }>> {
  const out: Array<{ path: string; method: string; file: string }> = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }

  for (const e of entries) {
    if (e.isDirectory()) {
      out.push(...await scanRoutes(join(dir, e.name), `${base}/${e.name}`));
    } else if (e.name === "handler.ts") {
      out.push({ path: base || "/", method: "get", file: join(dir, e.name) });
    } else {
      const match = e.name.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\.ts$/);
      if (match) {
        out.push({ path: base || "/", method: match[1].toLowerCase(), file: join(dir, e.name) });
      }
    }
  }
  return out;
}

async function buildSpec(): Promise<object> {
  const routes = await scanRoutes(join(process.cwd(), "routes"));
  const paths: Record<string, Record<string, unknown>> = {};
  const hasAuth = !!TOKEN;

  for (const { path, method } of routes) {
    const mod = await loadHandler(path.replace(/^\//, "") || "/", method);
    const meta = (mod as { openapi?: Record<string, unknown> })?.openapi ?? {};
    const effectiveMethod = (meta.method as string | undefined) ?? method;

    // Convert [name] folder convention to OpenAPI {name} path parameters
    const openApiPath = path.replace(/\[([^\]]+)\]/g, '{$1}');
    const autoParams = [...openApiPath.matchAll(/\{([^}]+)\}/g)].map(m => ({
      name: m[1], in: 'path', required: true, schema: { type: 'string' }
    }));
    const allParams = [...autoParams, ...((meta.parameters as unknown[]) ?? [])];

    if (!paths[openApiPath]) paths[openApiPath] = {};
    paths[openApiPath][effectiveMethod] = {
      summary: (meta.summary as string | undefined) ?? path,
      ...(meta.description ? { description: meta.description } : {}),
      ...(allParams.length > 0 ? { parameters: allParams } : {}),
      ...(meta.requestBody ? { requestBody: meta.requestBody } : {}),
      responses: meta.responses ?? { 200: { description: "OK" } },
      tags: (meta.tags as string[] | undefined) ?? [path.split("/").filter(Boolean)[0] ?? "default"],
      ...(meta.security ? { security: meta.security } : hasAuth ? { security: [{ bearerAuth: [] }] } : {}),
    };
  }

  const apiTitle = process.env.API_TITLE ?? "Rododentron API";
  return {
    openapi: "3.0.0",
    info: { title: apiTitle, version: "1.0.0" },
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    ...(hasAuth ? { security: [{ bearerAuth: [] }] } : {}),
    paths,
  };
}

const SWAGGER_UI = `<!DOCTYPE html>
<html><head><title>Rododentron API</title><meta charset="utf-8">
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css"></head>
<body style="margin:0"><div id="ui"></div>
<script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({url:"/swagger.json",dom_id:"#ui",deepLinking:true,layout:"BaseLayout",persistAuthorization:true})</script>
</body></html>`;

// --- HTTP szerver ---

const TOKEN = process.env.TOKEN;

function authorized(req: IncomingMessage): boolean {
  if (!TOKEN) return true;
  const header = req.headers.authorization;
  if (header === `Bearer ${TOKEN}`) return true;
  const qs = new URL(req.url ?? "/", "http://localhost").searchParams;
  return qs.get("token") === TOKEN;
}

// Convert IncomingMessage to Web API Request
function toWebRequest(req: IncomingMessage): Promise<Request> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? "/", `http://localhost`);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      }
      resolve(new Request(url.toString(), {
        method: req.method ?? "GET",
        headers,
        body: body.length > 0 ? body : undefined,
      }));
    });
    req.on("error", reject);
  });
}

// Write Web API Response to ServerResponse
async function writeWebResponse(webRes: Response, res: ServerResponse): Promise<void> {
  res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
  const body = await webRes.arrayBuffer();
  res.end(Buffer.from(body));
}

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  let path = (req.url ?? "/").split("?")[0];
  const method = req.method ?? "GET";

  if (path.includes("..")) { res.writeHead(400).end("Bad Request"); return; }

  if (path === "/swagger") {
    res.writeHead(200, { "Content-Type": "text/html" }).end(SWAGGER_UI);
    return;
  }
  if (path === "/swagger.json") {
    const spec = await buildSpec();
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(spec, null, 2));
    return;
  }

  if (!authorized(req)) { res.writeHead(401, { "WWW-Authenticate": "Bearer" }).end("Unauthorized"); return; }

  if (path === "/") path = "/index";

  // Replace [name] dynamic segments: /sandboxes/foo -> /sandboxes/[name]
  // Walk the filesystem to find the matching route
  const routePath = await resolveRoutePath(path);

  try {
    const handler = await loadHandler(routePath, method);
    if (!handler) { res.writeHead(404).end("Not Found"); return; }

    if ("handle" in handler) {
      // Old-style Node.js handler
      await (handler as OldHandlerModule).handle(req, res);
    } else if ("default" in handler) {
      // New-style Web API handler
      const webReq = await toWebRequest(req);
      const webRes = await (handler as NewHandlerModule).default(webReq);
      await writeWebResponse(webRes, res);
    } else {
      res.writeHead(500).end("Invalid handler module");
    }
  } catch (err) {
    console.error(`Handler hiba [${path}]:`, err);
    if (!res.headersSent) res.writeHead(500).end(String(err));
  }
}).listen(3000, () => console.log("Listening on :3000"));

// --- Dynamic route resolution ---
// Matches /sandboxes/foo/start to routes/sandboxes/[name]/start

async function resolveRoutePath(urlPath: string): Promise<string> {
  const segments = urlPath.replace(/^\//, "").split("/");
  const routesDir = join(process.cwd(), "routes");
  const resolved = await matchSegments(routesDir, segments);
  return resolved ?? urlPath.replace(/^\//, "");
}

async function matchSegments(dir: string, segments: string[]): Promise<string | null> {
  if (segments.length === 0) return "";

  const [head, ...rest] = segments;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return null; }

  // Prefer exact match over dynamic
  const exactMatch = entries.find(e => e.isDirectory() && e.name === head);
  if (exactMatch) {
    const subResult = rest.length === 0
      ? head
      : await matchSegments(join(dir, head), rest).then(r => r !== null ? `${head}/${r}` : null);
    if (subResult !== null) return subResult;
  }

  // Try dynamic segment [name]
  const dynamicMatch = entries.find(e => e.isDirectory() && e.name.startsWith("[") && e.name.endsWith("]"));
  if (dynamicMatch) {
    const dynName = dynamicMatch.name;
    if (rest.length === 0) return dynName;
    const subResult = await matchSegments(join(dir, dynName), rest);
    if (subResult !== null) return `${dynName}/${subResult}`;
  }

  return null;
}
