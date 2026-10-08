export const openapi = {
  summary: "Egy elem lekérése",
  parameters: [{ name: "id", in: "path", description: "Az elem azonosítója" }],
};

export default async (req: Request) => {
  const path = new URL(req.url).pathname;
  const id = decodeURIComponent(path.split("/")[2]);
  if (id === "missing") return Response.json({ error: "nincs ilyen elem" }, { status: 404 });
  return Response.json({ id, path });
};
