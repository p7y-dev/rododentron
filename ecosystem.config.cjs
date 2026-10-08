const apps = [
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
];

// MCP Inspector csak INSPECTOR=on esetén, auth-tal (a session token a konténer logjában)
if (process.env.INSPECTOR === "on") {
  apps.push({
    name: "inspector",
    script: "node_modules/.bin/mcp-inspector",
    env: {
      HOST: "0.0.0.0",
      PORT: "6274",
    },
  });
}

module.exports = { apps };
