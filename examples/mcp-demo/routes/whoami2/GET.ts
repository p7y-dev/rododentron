export const openapi = { summary: "Visszaadja a kapott Authorization fejlécet" };

export default async (req: Request) =>
  Response.json({ authorization: req.headers.get("authorization") });
