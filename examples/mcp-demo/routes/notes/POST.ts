export const openapi = {
  summary: "Jegyzet mentése (nyers szöveg)",
  requestBody: { required: true, content: { "text/plain": { schema: { type: "string" } } } },
};

export default async (req: Request) =>
  new Response(`kapott (${req.headers.get("content-type")}): ${await req.text()}`, {
    headers: { "Content-Type": "text/plain" },
  });
