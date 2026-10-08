// MCP elfogadási teszt az examples/mcp-demo/routes ellen.
// Futtatás a konténerben: tsx test.ts   (TOKEN=abc123 mellett)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const AUTH = { Authorization: "Bearer abc123" };
let failed = 0;

function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failed++;
}

type Tool = { name: string; description?: string; inputSchema: { properties?: Record<string, any>; required?: string[] }; annotations?: Record<string, unknown> };

const textOf = (r: any) => r.content?.[0]?.text as string;

async function checkTools(prefix: string, tools: Tool[]) {
  const byName = Object.fromEntries(tools.map(t => [t.name, t]));
  const expected = [
    "get_items", "post_items", "get_items_by_id", "delete_items_by_id", "patch_items_by_id",
    "post_notes", "get_whoami2", "custom_tool", "get_legacy",
  ];
  for (const n of expected) check(`${prefix} tools/list: ${n}`, !!byName[n], Object.keys(byName));
  check(`${prefix} tools/list: hidden nincs`, !tools.some(t => t.name.includes("hidden")), Object.keys(byName));

  const post = byName.post_items;
  check(`${prefix} post_items required = [name]`, JSON.stringify(post?.inputSchema.required) === '["name"]', post?.inputSchema);
  check(`${prefix} post_items schema átvéve (pattern, default)`,
    post?.inputSchema.properties?.name?.pattern === "^[a-z]+$" && post?.inputSchema.properties?.count?.default === 1, post?.inputSchema);
  check(`${prefix} post_items leírás`, post?.description === "Elem létrehozása\nHTTP POST /items", post?.description);
  check(`${prefix} get_items_by_id required = [id]`, JSON.stringify(byName.get_items_by_id?.inputSchema.required) === '["id"]', byName.get_items_by_id?.inputSchema);
  check(`${prefix} get_items readOnlyHint`, byName.get_items?.annotations?.readOnlyHint === true, byName.get_items?.annotations);
  check(`${prefix} delete_items_by_id destructiveHint`, byName.delete_items_by_id?.annotations?.destructiveHint === true, byName.delete_items_by_id?.annotations);
  check(`${prefix} post_items nincs annotáció`, post?.annotations === undefined, post?.annotations);
  check(`${prefix} patch ütközés → body objektum`,
    byName.patch_items_by_id?.inputSchema.properties?.body?.type === "object", byName.patch_items_by_id?.inputSchema);
  check(`${prefix} text/plain body → body string`,
    byName.post_notes?.inputSchema.properties?.body?.type === "string", byName.post_notes?.inputSchema);
  check(`${prefix} legacy query required`, JSON.stringify(byName.get_legacy?.inputSchema.required) === '["name"]', byName.get_legacy?.inputSchema);
}

async function checkCalls(prefix: string, client: Client) {
  let r: any = await client.callTool({ name: "post_items", arguments: { name: "alma", count: 3 } });
  let j = JSON.parse(textOf(r));
  check(`${prefix} post_items → JSON body`,
    !r.isError && j.created.name === "alma" && j.created.count === 3 && j.contentType === "application/json", r);

  r = await client.callTool({ name: "get_items_by_id", arguments: { id: "a b/c" } });
  j = JSON.parse(textOf(r));
  check(`${prefix} get_items_by_id → útvonalban`, !r.isError && j.id === "a b/c" && j.path === "/items/a%20b%2Fc", r);

  r = await client.callTool({ name: "get_items", arguments: { q: "alma" } });
  j = JSON.parse(textOf(r));
  check(`${prefix} get_items → query`, j.q === "alma" && j.method === "GET", r);

  r = await client.callTool({ name: "delete_items_by_id", arguments: { id: "7" } });
  check(`${prefix} delete_items_by_id → DELETE`, JSON.parse(textOf(r)).method === "DELETE", r);

  r = await client.callTool({ name: "patch_items_by_id", arguments: { id: "7", body: { id: "x", name: "új" } } });
  j = JSON.parse(textOf(r));
  check(`${prefix} patch_items_by_id → body objektum`, j.id === "7" && j.body.id === "x" && j.body.name === "új", r);

  r = await client.callTool({ name: "post_notes", arguments: { body: "szia" } });
  check(`${prefix} post_notes → text/plain`, textOf(r) === "kapott (text/plain): szia", r);

  r = await client.callTool({ name: "get_whoami2", arguments: {} });
  check(`${prefix} get_whoami2 → Bearer abc123`, JSON.parse(textOf(r)).authorization === "Bearer abc123", r);

  r = await client.callTool({ name: "get_legacy", arguments: { name: "régi" } });
  j = JSON.parse(textOf(r));
  check(`${prefix} get_legacy (handler.ts)`, j.method === "GET" && j.name === "régi" && j.authorization === "Bearer abc123", r);

  r = await client.callTool({ name: "custom_tool", arguments: {} });
  check(`${prefix} custom_tool`, textOf(r) === "egyedi név", r);

  r = await client.callTool({ name: "get_items_by_id", arguments: { id: "missing" } });
  check(`${prefix} 404 → isError`, r.isError === true && textOf(r).startsWith("HTTP 404:"), r);

  r = await client.callTool({ name: "post_items", arguments: { count: 1 } });
  check(`${prefix} 400 → isError`, r.isError === true && textOf(r).startsWith("HTTP 400:"), r);
}

async function streamable(base: string) {
  const prefix = `[${base}/mcp]`;
  const client = new Client({ name: "acceptance", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: AUTH } }));
  await checkTools(prefix, (await client.listTools()).tools as Tool[]);
  await checkCalls(prefix, client);
  await client.close();

  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  check(`${prefix} TOKEN nélkül → 401`, res.status === 401, res.status);
}

async function sse(base: string) {
  const prefix = `[${base}/sse]`;
  const client = new Client({ name: "acceptance-sse", version: "1.0.0" });
  await client.connect(new SSEClientTransport(new URL(`${base}/sse`), {
    requestInit: { headers: AUTH },
    eventSourceInit: { fetch: (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), ...AUTH } }) },
  }));
  const tools = (await client.listTools()).tools as Tool[];
  check(`${prefix} listáz (${tools.length} tool)`, tools.some(t => t.name === "post_items") && !tools.some(t => t.name.includes("hidden")), tools.map(t => t.name));
  const r: any = await client.callTool({ name: "get_whoami2", arguments: {} });
  check(`${prefix} get_whoami2 → Bearer abc123`, JSON.parse(textOf(r)).authorization === "Bearer abc123", r);
  await client.close();

  const res = await fetch(`${base}/sse`);
  check(`${prefix} TOKEN nélkül → 401`, res.status === 401, res.status);
}

await streamable("http://localhost:3000");
await streamable("http://localhost:3001");
await sse("http://localhost:3001");

console.log(failed === 0 ? "\nMinden ellenőrzés sikeres." : `\n${failed} ellenőrzés sikertelen.`);
process.exit(failed === 0 ? 0 : 1);
