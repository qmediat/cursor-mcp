#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { sandboxArgs } from "./cursor-argv.js";
import { installShutdownHandlers } from "./executor.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  sandboxArgs(); // a bad CURSOR_SANDBOX ends the server here, not at the first call
  installShutdownHandlers(); // no cursor-agent group outlives the server
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
