import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildTools, type ToolContext } from "./tools.js";

export const SERVER_NAME = "claude-sevdesk-connector";
export const SERVER_VERSION = "0.1.0";

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const tool of buildTools(ctx)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async (args: any) => {
        const result: any = await tool.handler(args);
        if (result && typeof result === "object" && result.isError === true) {
          return { isError: true, content: [{ type: "text" as const, text: String(result.message) }] };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    );
  }
  return server;
}
