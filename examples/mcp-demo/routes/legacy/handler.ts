import type { IncomingMessage, ServerResponse } from "node:http";

export const openapi = {
  summary: "Régi stílusú handler",
  parameters: [{ name: "name", in: "query", schema: { type: "string" }, required: true }],
};

export function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
    method: req.method,
    name: url.searchParams.get("name"),
    authorization: req.headers.authorization ?? null,
  }));
}
