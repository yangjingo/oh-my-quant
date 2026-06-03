/**
 * MCP client — connects to MCP servers defined in .claude/mcp.json
 * using the official @modelcontextprotocol/sdk.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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

/** Load MCP server configs from settings.json mcp.servers, fallback to .claude/mcp.json */
function loadMcpConfig(): Record<string, McpServerConfig> {
  // Primary: settings.json mcp.servers
  try {
    const sp = join(process.cwd(), ".ohquant", "settings.json");
    if (existsSync(sp)) {
      const settings = JSON.parse(readFileSync(sp, "utf-8"));
      const servers = settings?.mcp?.servers;
      if (servers && Object.keys(servers).length > 0) {
        const configs: Record<string, McpServerConfig> = {};
        for (const [name, cfg] of Object.entries(servers)) {
          const s = cfg as Record<string, unknown>;
          if (!s.enabled) continue;
          configs[name] = { transport: (s.transport as McpServerConfig["transport"]) || (s.command ? "stdio" : "http"), command: s.command as string, args: s.args as string[], url: s.url as string, env: s.env as Record<string, string>, headers: s.headers as Record<string, string> };
        }
        return resolveEnvVars(configs);
      }
    }
  } catch { /* fallback to .claude/mcp.json */ }

  // Fallback: .claude/mcp.json
  const root = process.cwd();
  const paths = [join(root, ".claude", "mcp.json"), join(root, ".mcp.json")];
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, "utf-8")) as McpJson;
        return resolveEnvVars(raw.mcpServers);
      } catch { /* continue */ }
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

/** Connection error with diagnostics */
export class McpConnectError extends Error {
  constructor(
    message: string,
    public server: string,
    public reason: "auth" | "network" | "timeout" | "unknown",
  ) {
    super(message);
    this.name = "McpConnectError";
  }
}

export interface McpServerStatus {
  name: string;
  connected: boolean;
  tools: number;
  error?: string;
}

const serverStatus = new Map<string, McpServerStatus>();

/** Connect to all configured MCP servers and discover tools */
export async function connectAll(): Promise<McpTool[]> {
  const configs = loadMcpConfig();
  const allTools: McpTool[] = [];

  for (const [name, cfg] of Object.entries(configs)) {
    try {
      let transport;
      if (cfg.transport === "stdio" || cfg.command) {
        transport = new StdioClientTransport({
          command: cfg.command || "npx",
          args: cfg.args || [],
          env: cfg.env,
        });
      } else if (cfg.transport === "sse") {
        if (!cfg.url) throw new McpConnectError("Missing URL for SSE transport", name, "network");
        transport = new SSEClientTransport(new URL(cfg.url));
      } else if (cfg.transport === "http" && cfg.url) {
        transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
          requestInit: cfg.headers ? { headers: cfg.headers as Record<string, string> } : undefined,
        });
      } else {
        serverStatus.set(name, { name, connected: false, tools: 0, error: `unsupported transport: ${cfg.transport}` });
        continue;
      }

      const client = new Client(
        { name: `whyj-quant-${name}`, version: "2.0.5" },
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
      serverStatus.set(name, { name, connected: true, tools: tools.length });
      allTools.push(...tools);
    } catch (err) {
      const reason = classifyError(err);
      const msg = err instanceof Error ? err.message : String(err);
      serverStatus.set(name, { name, connected: false, tools: 0, error: reason });
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

/** Get detailed server status for sidebar display */
export function getServerStatus(): McpServerStatus[] {
  return Array.from(serverStatus.values());
}

function classifyError(err: unknown): McpConnectError["reason"] {
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized")) return "auth";
  if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("fetch")) return "network";
  if (msg.includes("timeout") || msg.includes("abort")) return "timeout";
  return "unknown";
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
