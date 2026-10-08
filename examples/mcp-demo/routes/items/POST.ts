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
            name: { type: "string", description: "Az elem neve", pattern: "^[a-z]+$" },
            count: { type: "number", description: "Darabszám", default: 1 },
          },
        },
      },
    },
  },
};

export default async (req: Request) => {
  const body = await req.json().catch(() => null) as { name?: string; count?: number } | null;
  if (!body?.name) return Response.json({ error: "name kötelező" }, { status: 400 });
  return Response.json({ created: body, contentType: req.headers.get("content-type") }, { status: 201 });
};
