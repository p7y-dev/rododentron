import type { IncomingMessage, ServerResponse } from "node:http";
import Dockerode from "dockerode";

const docker = new Dockerode({ socketPath: "/var/run/docker.sock" });

export const openapi = {
  summary: "Whoami konténer létrehozása",
  description: "Létrehoz és elindít egy traefik/whoami konténert, véletlenszerű host porttal",
  parameters: [
    {
      name: "name",
      in: "query",
      schema: { type: "string" },
      description: "Konténer neve (opcionális, default: whoami-{timestamp})",
    },
  ],
  responses: {
    201: {
      description: "Konténer sikeresen létrehozva",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              id: { type: "string", example: "7c17915fd1fd" },
              name: { type: "string", example: "whoami-test" },
              port: { type: "string", example: "61492" },
              url: { type: "string", example: "http://localhost:61492" },
            },
          },
        },
      },
    },
  },
};

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const name = url.searchParams.get("name") ?? `whoami-${Date.now()}`;

  await ensureImage("traefik/whoami:latest");

  const container = await docker.createContainer({
    Image: "traefik/whoami:latest",
    name,
    ExposedPorts: { "80/tcp": {} },
    HostConfig: {
      PortBindings: { "80/tcp": [{ HostPort: "" }] },
    },
  });

  await container.start();
  const info = await container.inspect();

  const hostPort = (info.NetworkSettings.Ports as Record<string, { HostPort: string }[]>)
    ?.["80/tcp"]?.[0]?.HostPort;

  res.writeHead(201, { "Content-Type": "application/json" }).end(
    JSON.stringify({
      id: info.Id.slice(0, 12),
      name: info.Name.replace(/^\//, ""),
      port: hostPort,
      url: `http://localhost:${hostPort}`,
    }, null, 2)
  );
}

async function ensureImage(image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
  } catch {
    await new Promise<void>((resolve, reject) => {
      docker.pull(image, (err: Error, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (err: Error | null) => {
          if (err) reject(err); else resolve();
        });
      });
    });
  }
}
