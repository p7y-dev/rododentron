export const openapi = {
  summary: "Elemek listázása",
  parameters: [
    { name: "q", in: "query", schema: { type: "string" }, description: "Szűrőkifejezés" },
  ],
};

export default async (req: Request) => {
  const q = new URL(req.url).searchParams.get("q");
  return Response.json({ method: req.method, q, items: ["alma", "körte"].filter(i => !q || i.includes(q)) });
};
