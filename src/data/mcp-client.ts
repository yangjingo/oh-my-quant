/**
 * MCP client — connects to MCP servers defined in .claude/mcp.json
 * using the official @modelcontextprotocol/sdk.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface McpServerConfig {
  transport: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

interface McpJson {
  mcpServers: Record<string, McpServerConfig>;
}

interface ConnectedServer {
  name: string;
  client: Client;
  tools: McpTool[];
}

export interface McpTool {
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const connectedServers = new Map<string, ConnectedServer>();

/** Load MCP server configs from .claude/mcp.json at project root */
function loadMcpConfig(): Record<string, McpServerConfig> {
  const root = process.cwd();
  const paths = [join(root, ".claude", "mcp.json"), join(root, ".mcp.json")];
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, "utf-8")) as McpJson;
        // Resolve env vars in config values
        return resolveEnvVars(raw.mcpServers);
      } catch {
        // continue
      }
    }
  }
  return {};
}

function resolveEnvVars(
  configs: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  const resolved: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(configs)) {
    const cloned = JSON.parse(JSON.stringify(cfg)) as McpServerConfig;
    if (cloned.url) {
      cloned.url = cloned.url.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] || "");
    }
    if (cloned.env) {
      for (const [k, v] of Object.entries(cloned.env)) {
        cloned.env[k] = String(v).replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] || "");
      }
    }
    if (cloned.headers) {
      for (const [k, v] of Object.entries(cloned.headers)) {
        cloned.headers[k] = String(v).replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] || "");
      }
    }
    resolved[name] = cloned;
  }
  return resolved;
}

/** Connect to all configured MCP servers and discover tools */
export async function connectAll(): Promise<McpTool[]> {
  const configs = loadMcpConfig();
  const allTools: McpTool[] = [];

  for (const [name, cfg] of Object.entries(configs)) {
    try {
      let transport;
      if (cfg.command) {
        transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args || [],
          env: cfg.env,
        });
      } else if (cfg.url) {
        transport = new SSEClientTransport(new URL(cfg.url));
      } else {
        continue; // skip unconfigured
      }

      const client = new Client(
        { name: `whyj-quant-${name}`, version: "2.0.0" },
        { capabilities: {} },
      );

      await client.connect(transport);

      const toolsResult = await client.listTools();
      const tools: McpTool[] = toolsResult.tools.map((t) => ({
        serverName: name,
        name: t.name,
        description: t.description || "",
        inputSchema: (t.inputSchema || {}) as Record<string, unknown>,
      }));

      connectedServers.set(name, { name, client, tools });
      allTools.push(...tools);
    } catch {
      // Server connection failed — skip gracefully
      console.error(`[mcp] Failed to connect to "${name}"`);
    }
  }

  return allTools;
}

/** Execute a tool on a specific MCP server */
export async function callTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const server = connectedServers.get(serverName);
  if (!server) throw new Error(`MCP server "${serverName}" not connected`);
  const result = await server.client.callTool({ name: toolName, arguments: args });
  return result.content;
}

/** Get all connected server names */
export function getConnectedServers(): string[] {
  return Array.from(connectedServers.keys());
}

/** Get tools for a specific server */
export function getServerTools(serverName: string): McpTool[] {
  return connectedServers.get(serverName)?.tools || [];
}

/** Disconnect all MCP servers */
export async function disconnectAll(): Promise<void> {
  for (const [name, server] of connectedServers) {
    try {
      await server.client.close();
    } catch {
      // ignore close errors
    }
  }
  connectedServers.clear();
}
