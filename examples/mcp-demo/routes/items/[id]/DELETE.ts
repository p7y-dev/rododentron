export const openapi = { summary: "Elem törlése" };

export default async (req: Request) => {
  const id = decodeURIComponent(new URL(req.url).pathname.split("/")[2]);
  return Response.json({ deleted: id, method: req.method });
};
