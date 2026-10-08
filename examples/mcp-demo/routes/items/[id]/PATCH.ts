// A body "id" mezője ütközik az útvonal-paraméterrel → a teljes body egy "body" paraméter alá kerül
export const openapi = {
  summary: "Elem módosítása",
  requestBody: {
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: { id: { type: "string" }, name: { type: "string" } },
        },
      },
    },
  },
};

export default async (req: Request) => {
  const id = decodeURIComponent(new URL(req.url).pathname.split("/")[2]);
  return Response.json({ id, body: await req.json() });
};
