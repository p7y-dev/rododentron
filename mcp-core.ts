import type { IncomingMessage, ServerResponse } from "node:http";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Route-ok → MCP toolok. A server.ts route-konvencióit követi:
// METHOD.ts (default(req: Request): Promise<Response>) és régi handler.ts (handle(req, res)),
// [x] mappa = x útvonal-paraméter, openapi.method felülírja a metódust.

export interface McpRoute { method: string; path: string; openapi: Record<string, unknown> }

export interface McpOptions {
  routesDir?: string
  name?: string
  version?: string
  forwardHeaders?: string[]
  include?: (r: McpRoute) => boolean
  maxResponseBytes?: number
}

type McpTool = { name: string; description: string; inputSchema: object; annotations?: object };

type OldHandlerModule = {
  handle: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  openapi?: Record<string, unknown>;
};

type NewHandlerModule = {
  default: (req: Request) => Promise<Response>;
  openapi?: Record<string, unknown>;
};

type HandlerModule = OldHandlerModule | NewHandlerModule;

type JsonSchema = Record<string, unknown>;

type BodyMode =
  | { kind: "none" }
  | { kind: "flat"; keys: string[] }
  | { kind: "wrapped" }
  | { kind: "raw"; contentType: string };

type ToolEntry = {
  tool: McpTool;
  route: McpRoute;
  file: string;
  pathParams: string[];
  queryParams: string[];
  body: BodyMode;
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function resolveOptions(opts: McpOptions = {}) {
  return {
    routesDir: opts.routesDir ?? join(process.cwd(), "routes"),
    name: opts.name ?? "rododentron",
    version: opts.version ?? "1.0.0",
    forwardHeaders: (opts.forwardHeaders ?? ["authorization"]).map(h => h.toLowerCase()),
    include: opts.include ?? ((r: McpRoute) => r.openapi.mcp !== false),
    maxResponseBytes: opts.maxResponseBytes ?? 100_000,
  };
}

type ResolvedOptions = ReturnType<typeof resolveOptions>;

// --- Dinamikus betöltés mtime-alapú cache-sel (mint server.ts-ben) ---

const cache = new Map<string, { mtime: number; mod: HandlerModule }>();

async function loadModule(file: string): Promise<HandlerModule> {
  const { mtimeMs: mtime } = await stat(file);
  const cached = cache.get(file);
  if (cached?.mtime === mtime) return cached.mod;
  const mod = await import(pathToFileURL(file).href + `?t=${mtime}`) as HandlerModule;
  cache.set(file, { mtime, mod });
  return mod;
}

// --- Route-felderítés ---

type ScannedRoute = { fsPath: string; method: string; file: string; legacy: boolean };

async function scanRoutes(dir: string, base = ""): Promise<ScannedRoute[]> {
  const out: ScannedRoute[] = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }

  for (const e of entries) {
    if (e.isDirectory()) {
      out.push(...await scanRoutes(join(dir, e.name), `${base}/${e.name}`));
    } else if (e.name === "handler.ts") {
      out.push({ fsPath: base || "/", method: "GET", file: join(dir, e.name), legacy: true });
    } else {
      const match = e.name.match(/^(GET|POST|PUT|PATCH|DELETE)\.ts$/);
      if (match) out.push({ fsPath: base || "/", method: match[1], file: join(dir, e.name), legacy: false });
    }
  }
  return out;
}

// --- Tool-generálás ---

function shortHash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 6);
}

function sanitizeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function defaultToolName(method: string, fsPath: string): string {
  const segments = fsPath.split("/").filter(Boolean)
    .map(s => s.match(/^\[(.+)\]$/) ? `by_${s.slice(1, -1)}` : s);
  return [method.toLowerCase(), ...segments].join("_");
}

type QueryParam = { name: string; in: string; schema?: JsonSchema; description?: string; required?: boolean };

function buildEntry(scanned: ScannedRoute, openapi: Record<string, unknown>): Omit<ToolEntry, "tool"> & { legacy: boolean; baseName: string; description: string; inputSchema: JsonSchema; annotations?: object } {
  const method = ((openapi.method as string | undefined) ?? scanned.method).toUpperCase();
  const path = scanned.fsPath.replace(/\[([^\]]+)\]/g, "{$1}");
  const route: McpRoute = { method, path, openapi };

  const mcpMeta = typeof openapi.mcp === "object" && openapi.mcp !== null ? openapi.mcp as Record<string, unknown> : {};
  const baseName = sanitizeName(
    (mcpMeta.name as string | undefined) ?? (openapi.operationId as string | undefined) ?? defaultToolName(method, scanned.fsPath)
  );

  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const params = (openapi.parameters as QueryParam[] | undefined) ?? [];

  // Útvonal-paraméterek
  const pathParams = [...scanned.fsPath.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
  for (const name of pathParams) {
    const declared = params.find(p => p.in === "path" && p.name === name);
    properties[name] = {
      type: "string",
      ...(declared?.description ? { description: declared.description } : {}),
    };
    required.push(name);
  }

  // Query paraméterek
  const queryParams: string[] = [];
  for (const p of params.filter(p => p.in === "query")) {
    properties[p.name] = {
      ...(p.schema ?? { type: "string" }),
      ...(p.description ? { description: p.description } : {}),
    };
    if (p.required) required.push(p.name);
    queryParams.push(p.name);
  }

  // Request body
  let body: BodyMode = { kind: "none" };
  const requestBody = openapi.requestBody as { required?: boolean; description?: string; content?: Record<string, { schema?: JsonSchema }> } | undefined;
  if (requestBody?.content) {
    const jsonSchema = requestBody.content["application/json"]?.schema;
    const contentTypes = Object.keys(requestBody.content);
    if (requestBody.content["application/json"]) {
      const bodyProps = jsonSchema?.properties as Record<string, JsonSchema> | undefined;
      const collides = bodyProps && Object.keys(bodyProps).some(k => k in properties);
      if (bodyProps && !collides) {
        Object.assign(properties, bodyProps);
        required.push(...((jsonSchema!.required as string[] | undefined) ?? []));
        body = { kind: "flat", keys: Object.keys(bodyProps) };
      } else {
        properties.body = {
          ...(jsonSchema ?? { type: "object" }),
          ...(requestBody.description ? { description: requestBody.description } : {}),
        };
        if (requestBody.required) required.push("body");
        body = { kind: "wrapped" };
      }
    } else if (contentTypes.length > 0) {
      properties.body = {
        type: "string",
        description: requestBody.description ?? `Request body (${contentTypes[0]})`,
      };
      if (requestBody.required) required.push("body");
      body = { kind: "raw", contentType: contentTypes[0] };
    }
  }

  const description = [
    [openapi.summary, openapi.description].filter(Boolean).join("\n\n"),
    `HTTP ${method} ${path}`,
  ].filter(Boolean).join("\n");

  const annotations =
    method === "GET" || method === "HEAD" ? { readOnlyHint: true } :
    method === "DELETE" ? { destructiveHint: true } :
    undefined;

  return {
    baseName,
    description,
    inputSchema: { type: "object", properties, ...(required.length ? { required: [...new Set(required)] } : {}) },
    ...(annotations ? { annotations } : {}),
    route,
    file: scanned.file,
    legacy: scanned.legacy,
    pathParams,
    queryParams,
    body,
  };
}

async function buildTools(o: ResolvedOptions): Promise<ToolEntry[]> {
  const scanned = await scanRoutes(o.routesDir);
  const drafts = [];
  for (const s of scanned) {
    let openapi: Record<string, unknown>;
    try {
      openapi = (await loadModule(s.file)).openapi ?? {};
    } catch (err) {
      console.error(`MCP: route betöltési hiba [${s.file}]:`, err);
      continue;
    }
    const draft = buildEntry(s, openapi);
    if (!o.include(draft.route)) continue;
    drafts.push(draft);
  }

  // A régi handler.ts csak akkor tool, ha a metódusára nincs METHOD.ts ugyanabban a mappában
  // (server.ts loadHandler is a METHOD.ts-t részesíti előnyben)
  const taken = new Set(drafts.filter(d => !d.legacy).map(d => `${d.route.method} ${d.route.path}`));
  const visible = drafts.filter(d => !d.legacy || !taken.has(`${d.route.method} ${d.route.path}`));

  // Ütköző vagy túl hosszú nevek: rövidítés + hash
  const counts = new Map<string, number>();
  for (const d of visible) counts.set(d.baseName, (counts.get(d.baseName) ?? 0) + 1);

  return visible.map(({ baseName, description, inputSchema, annotations, legacy: _legacy, ...rest }) => {
    const name = (counts.get(baseName)! > 1 || baseName.length > 64)
      ? `${baseName.slice(0, 57)}_${shortHash(`${rest.route.method} ${rest.route.path}`)}`
      : baseName;
    return { ...rest, tool: { name, description, inputSchema, ...(annotations ? { annotations } : {}) } };
  });
}

export async function listMcpTools(opts?: McpOptions): Promise<McpTool[]> {
  return (await buildTools(resolveOptions(opts))).map(e => e.tool);
}

// --- Tool-hívás ---

function buildRequest(entry: ToolEntry, args: Record<string, unknown>, incoming: Headers, o: ResolvedOptions): Request {
  let path = entry.route.path;
  for (const name of entry.pathParams) {
    const value = args[name];
    if (value === undefined || value === null || value === "") throw new Error(`Hiányzó útvonal-paraméter: ${name}`);
    path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
  }

  const url = new URL(path, "http://localhost");
  for (const name of entry.queryParams) {
    const value = args[name];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach(v => url.searchParams.append(name, String(v)));
    else url.searchParams.set(name, typeof value === "object" ? JSON.stringify(value) : String(value));
  }

  const headers = new Headers();
  for (const h of o.forwardHeaders) {
    const v = incoming.get(h);
    if (v !== null) headers.set(h, v);
  }

  const method = entry.route.method;
  let body: string | undefined;
  if (["POST", "PUT", "PATCH"].includes(method)) {
    if (entry.body.kind === "flat") {
      const keys = entry.body.keys;
      body = JSON.stringify(Object.fromEntries(keys.filter(k => args[k] !== undefined).map(k => [k, args[k]])));
      headers.set("content-type", "application/json");
    } else if (entry.body.kind === "wrapped" && args.body !== undefined) {
      body = JSON.stringify(args.body);
      headers.set("content-type", "application/json");
    } else if (entry.body.kind === "raw" && args.body !== undefined) {
      body = typeof args.body === "string" ? args.body : JSON.stringify(args.body);
      headers.set("content-type", entry.body.contentType);
    }
  }

  return new Request(url, { method, headers, body });
}

// Régi handler.ts hívása HTTP nélkül: mock req/res
async function invokeLegacy(mod: OldHandlerModule, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const bodyBuf = Buffer.from(await req.arrayBuffer());

  return new Promise((resolve, reject) => {
    const mockReq = Object.assign(new Readable({ read() {} }), {
      url: url.pathname + url.search,
      method: req.method,
      headers: { host: url.host, ...Object.fromEntries(req.headers.entries()) },
    }) as unknown as IncomingMessage;
    if (bodyBuf.length > 0) mockReq.push(bodyBuf);
    mockReq.push(null);

    const chunks: Buffer[] = [];
    const resHeaders = new Headers();

    const mockRes = {
      statusCode: 200,
      headersSent: false,
      writeHead(code: number, headers?: Record<string, string | string[]>) {
        this.statusCode = code;
        for (const [k, v] of Object.entries(headers ?? {})) resHeaders.set(k, Array.isArray(v) ? v.join(", ") : String(v));
        this.headersSent = true;
        return this;
      },
      setHeader(k: string, v: string | string[]) { resHeaders.set(k, Array.isArray(v) ? v.join(", ") : String(v)); return this; },
      getHeader(k: string) { return resHeaders.get(k) ?? undefined; },
      write(d: Buffer | string) { chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)); return true; },
      end(d?: Buffer | string) {
        if (d) chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d));
        const status = this.statusCode;
        const noBody = status === 204 || status === 304;
        resolve(new Response(noBody ? null : Buffer.concat(chunks), { status, headers: resHeaders }));
        return this;
      },
    } as unknown as ServerResponse;

    Promise.resolve(mod.handle(mockReq, mockRes)).catch(reject);
  });
}

async function toToolResult(res: Response, o: ResolvedOptions) {
  const contentType = res.headers.get("content-type") ?? "";
  const buf = Buffer.from(await res.arrayBuffer());
  const isText = contentType === "" || /^text\//i.test(contentType) || /[/+]json\b/i.test(contentType);

  let text: string;
  if (!isText) {
    text = `[nem szöveges válasz: ${contentType}, ${buf.length} bájt]`;
  } else if (buf.length > o.maxResponseBytes) {
    text = buf.subarray(0, o.maxResponseBytes).toString("utf-8") + `\n…[levágva: ${o.maxResponseBytes} / ${buf.length} bájt]`;
  } else {
    text = buf.toString("utf-8");
  }

  if (res.status >= 400) return { content: [{ type: "text", text: `HTTP ${res.status}: ${text}` }], isError: true };
  return { content: [{ type: "text", text }] };
}

async function callTool(o: ResolvedOptions, name: string, args: Record<string, unknown>, incoming: Headers) {
  try {
    const entry = (await buildTools(o)).find(e => e.tool.name === name);
    if (!entry) return { content: [{ type: "text", text: `Ismeretlen tool: ${name}` }], isError: true };

    const req = buildRequest(entry, args, incoming, o);
    const mod = await loadModule(entry.file);
    let res: Response;
    if ("default" in mod && typeof mod.default === "function") res = await mod.default(req);
    else if ("handle" in mod && typeof mod.handle === "function") res = await invokeLegacy(mod, req);
    else throw new Error(`Érvénytelen handler modul: ${entry.file}`);

    return await toToolResult(res, o);
  } catch (err) {
    return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
}

// --- MCP szerver ---

// Új Server példány; a toolok a megadott (bejövő kérésből származó) fejléceket továbbítják.
// Az mcp.ts SSE ága is ezt használja, hogy a tool-lista és a hívás közös legyen.
export function createMcpServer(opts: McpOptions | undefined, incoming: Headers): Server {
  const o = resolveOptions(opts);
  const server = new Server({ name: o.name, version: o.version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await buildTools(o)).map(e => e.tool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    callTool(o, req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>, incoming)
  );

  return server;
}

// Streamable HTTP, stateless: kérésenként új Server + transzport
export function createMcpHandler(opts?: McpOptions): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    // Stateless módban nincs szerver→kliens stream és lezárandó session
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }),
        { status: 405, headers: { "Content-Type": "application/json", Allow: "POST" } },
      );
    }

    const server = createMcpServer(opts, req.headers);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(req);
    } finally {
      await server.close();
    }
  };
}
