import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createMcpHandler, createMcpServer } from "./mcp-core.ts";

// Önálló MCP szerver a :3001-en.
//   /mcp            → Streamable HTTP (mcp-core)
//   /sse + /message → régi SSE transzport, visszafelé-kompatibilitásnak (ugyanaz a tool-lista és hívás)

const TOKEN = process.env.TOKEN;

function authorized(req: IncomingMessage): boolean {
  if (!TOKEN) return true;
  const header = req.headers.authorization;
  if (header === `Bearer ${TOKEN}`) return true;
  const qs = new URL(req.url ?? "/", "http://localhost").searchParams;
  return qs.get("token") === TOKEN;
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  return headers;
}

// IncomingMessage → Web API Request
function toWebRequest(req: IncomingMessage): Promise<Request> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      resolve(new Request(new URL(req.url ?? "/", "http://localhost"), {
        method: req.method ?? "GET",
        headers: toHeaders(req),
        body: body.length > 0 ? body : undefined,
      }));
    });
    req.on("error", reject);
  });
}

async function writeWebResponse(webRes: Response, res: ServerResponse): Promise<void> {
  res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
  res.end(Buffer.from(await webRes.arrayBuffer()));
}

const mcpHandler = createMcpHandler();
const transports = new Map<string, SSEServerTransport>();

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const path = (req.url ?? "/").split("?")[0];

  try {
    if (path === "/mcp") {
      if (!authorized(req)) { res.writeHead(401, { "WWW-Authenticate": "Bearer" }).end("Unauthorized"); return; }
      await writeWebResponse(await mcpHandler(await toWebRequest(req)), res);
      return;
    }

    if (path === "/sse" && req.method === "GET") {
      if (!authorized(req)) { res.writeHead(401, { "WWW-Authenticate": "Bearer" }).end("Unauthorized"); return; }
      const transport = new SSEServerTransport("/message", res);
      transports.set(transport.sessionId, transport);
      res.on("close", () => transports.delete(transport.sessionId));
      await createMcpServer(undefined, toHeaders(req)).connect(transport);
      return;
    }

    if (path === "/message" && req.method === "POST") {
      const sid = new URL(req.url ?? "/", "http://localhost").searchParams.get("sessionId");
      const transport = sid ? transports.get(sid) : undefined;
      if (!transport) { res.writeHead(404).end("Session not found"); return; }
      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404).end("Not Found");
  } catch (err) {
    console.error(`MCP hiba [${path}]:`, err);
    if (!res.headersSent) res.writeHead(500).end(String(err));
  }
}).listen(3001, () => console.log("MCP listening on :3001 (/mcp, /sse)"));
