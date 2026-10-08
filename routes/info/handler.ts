import type { IncomingMessage, ServerResponse } from "node:http";

export const openapi = {
  summary: "Request info",
  description: "Visszaadja a beérkező kérés metódusát és path-ját",
  responses: { 200: { description: "method és path szöveges formában" } },
};

export function handle(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/plain" })
    .end(`method: ${req.method}\npath:   ${req.url}\n`);
}
