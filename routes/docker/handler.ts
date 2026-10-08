import type { IncomingMessage, ServerResponse } from "node:http";
import Dockerode from "dockerode";

const docker = new Dockerode({ socketPath: "/var/run/docker.sock" });

export const openapi = {
  summary: "Futó konténerek listája",
  description: "Docker socket-en keresztül lekéri az összes futó konténert",
  responses: {
    200: {
      description: "Konténerek listája",
      content: {
        "application/json": {
          schema: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", example: "a1b2c3d4e5f6" },
                names: { type: "array", items: { type: "string" } },
                image: { type: "string" },
                status: { type: "string" },
                state: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

export async function handle(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const containers = await docker.listContainers();

  const result = containers.map((c) => ({
    id: c.Id.slice(0, 12),
    names: c.Names,
    image: c.Image,
    status: c.Status,
    state: c.State,
  }));

  res.writeHead(200, { "Content-Type": "application/json" })
    .end(JSON.stringify(result));
}
