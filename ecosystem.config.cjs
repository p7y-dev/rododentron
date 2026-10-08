module.exports = {
  apps: [
    {
      name: "api",
      script: "node_modules/.bin/tsx",
      args: "server.ts",
    },
    {
      name: "mcp",
      script: "node_modules/.bin/tsx",
      args: "mcp.ts",
    },
    {
      name: "inspector",
      script: "node_modules/.bin/mcp-inspector",
      env: {
        HOST: "0.0.0.0",
        PORT: "6274",
        DANGEROUSLY_OMIT_AUTH: "true",
      },
    },
  ],
};
