import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

type HandlerModule = {
  handle: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  openapi?: Record<string, unknown>;
};

// --- Ugyanaz a mtime-cache mint server.ts-ben ---

const cache = new Map<string, { mtime: number; mod: HandlerModule }>();

async function loadHandler(routePath: string): Promise<HandlerModule | null> {
  const filePath = join(process.cwd(), "routes", routePath, "handler.ts");
  let stats;
  try { stats = await stat(filePath); } catch { return null; }
  const mtime = stats.mtimeMs;
  const cached = cache.get(filePath);
  if (cached?.mtime === mtime) return cached.mod;
  const mod = await import(pathToFileURL(filePath).href + `?t=${mtime}`) as HandlerModule;
  cache.set(filePath, { mtime, mod });
  return mod;
}

async function scanRoutes(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      out.push(...await scanRoutes(join(dir, e.name), `${base}/${e.name}`));
    } else if (e.name === "handler.ts") {
      out.push(base || "/");
    }
  }
  return out;
}

// --- Fake req/res: HTTP handler meghívása HTTP nélkül ---

async function invokeHandler(routePath: string, args: Record<string, unknown>): Promise<string> {
  const handler = await loadHandler(routePath.replace(/^\//, "") || "/");
  if (!handler) throw new Error(`Handler not found: ${routePath}`);

  const url = new URL(`http://localhost${routePath}`);
  for (const [k, v] of Object.entries(args ?? {})) {
    url.searchParams.set(k, String(v));
  }

  return new Promise((resolve, reject) => {
    const mockReq = Object.assign(new Readable({ read() {} }), {
      url: url.pathname + url.search,
      method: "GET",
      headers: { host: "localhost" },
    }) as IncomingMessage;

    const chunks: Buffer[] = [];
    let status = 200;

    const mockRes = {
      headersSent: false,
      writeHead(code: number) { status = code; this.headersSent = true; return this; },
      setHeader() { return this; },
      getHeader() { return undefined; },
      write(d: Buffer | string) { chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)); return true; },
      end(d?: Buffer | string) {
        if (d) chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d));
        const body = Buffer.concat(chunks).toString("utf-8");
        if (status >= 400) reject(new Error(`HTTP ${status}: ${body}`));
        else resolve(body);
        return this;
      },
    } as unknown as ServerResponse;

    Promise.resolve(handler.handle(mockReq, mockRes)).catch(reject);
  });
}

// --- MCP tool lista build-elés route scanból ---

async function buildTools() {
  const paths = await scanRoutes(join(process.cwd(), "routes"));
  const tools = [];

  for (const path of paths) {
    const handler = await loadHandler(path.replace(/^\//, "") || "/");
    const meta = handler?.openapi ?? {};
    const params = (meta.parameters as Array<{
      name: string; in: string; schema?: { type: string };
      description?: string; required?: boolean;
    }>) ?? [];

    const properties: Record<string, { type: string; description?: string }> = {};
    const required: string[] = [];
    for (const p of params.filter(p => p.in === "query")) {
      properties[p.name] = {
        type: p.schema?.type ?? "string",
        ...(p.description ? { description: p.description } : {}),
      };
      if (p.required) required.push(p.name);
    }

    tools.push({
      name: path.replace(/^\//, "").replace(/\//g, "_") || "index",
      description: (meta.summary as string | undefined) ?? path,
      inputSchema: {
        type: "object" as const,
        properties,
        ...(required.length ? { required } : {}),
      },
    });
  }

  return tools;
}

// --- MCP Server factory (kapcsolatonként új példány) ---

function makeMcpServer() {
  const s = new Server(
    { name: "rododentron", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  s.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await buildTools(),
  }));

  s.setRequestHandler(CallToolRequestSchema, async (req) => {
    const toolName = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const routePath = "/" + toolName.replace(/_/g, "/");
    try {
      const result = await invokeHandler(routePath, args);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: String(err) }], isError: true };
    }
  });

  return s;
}

// --- SSE HTTP szerver ---

const TOKEN = process.env.TOKEN;

function authorized(req: IncomingMessage): boolean {
  if (!TOKEN) return true;
  const header = req.headers.authorization;
  if (header === `Bearer ${TOKEN}`) return true;
  const qs = new URL(req.url ?? "/", "http://localhost").searchParams;
  return qs.get("token") === TOKEN;
}

const transports = new Map<string, SSEServerTransport>();

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? "/";

  if (url === "/sse" && req.method === "GET") {
    if (!authorized(req)) { res.writeHead(401, { "WWW-Authenticate": "Bearer" }).end("Unauthorized"); return; }
    const transport = new SSEServerTransport("/message", res);
    transports.set(transport.sessionId, transport);
    res.on("close", () => transports.delete(transport.sessionId));
    await makeMcpServer().connect(transport);
    return;
  }

  if (url.startsWith("/message") && req.method === "POST") {
    const sid = new URL(url, "http://localhost").searchParams.get("sessionId");
    const transport = sid ? transports.get(sid) : undefined;
    if (!transport) { res.writeHead(404).end("Session not found"); return; }
    await transport.handlePostMessage(req, res);
    return;
  }

  res.writeHead(404).end("Not Found");
}).listen(3001, () => console.log("MCP SSE listening on :3001"));
