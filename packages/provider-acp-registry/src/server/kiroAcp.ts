import type { AcpAdapterV2ExtensionContext } from "@t3tools/provider-acp/server/adapter";
import type { ProviderAdapterV2RuntimePolicy } from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { AcpRegistrySettings } from "../settings.ts";

// Kiro is not in the ACP Registry, so only a local `kiro-cli acp` command identifies it.
export function isKiroAcpCommand(settings: AcpRegistrySettings): boolean {
  return (
    settings.source === "local" &&
    /^kiro-cli(\.exe|\.cmd)?$/i.test(settings.commandPath.split(/[\\/]/).pop() ?? "")
  );
}

// Kiro IDE controls: modes are IDE workflows, autopilot mirrors T3's runtime mode, and the
// rest are account settings that do not belong in a per-thread composer.
export const KIRO_HIDDEN_CONFIG_OPTION_IDS: ReadonlySet<string> = new Set([
  "mode",
  "autopilot",
  "memoryReflection",
  "contentCollection",
]);

export function kiroConfigOptionsForPolicy(
  policy: Pick<ProviderAdapterV2RuntimePolicy, "runtimeMode">,
): ReadonlyArray<{ readonly id: string; readonly value: string }> {
  return [
    { id: "mode", value: "vibe" },
    // Supervised Kiro asks before acting, so T3's own policy decides; autopilot skips that.
    {
      id: "autopilot",
      value: policy.runtimeMode === "full-access" || policy.runtimeMode === "auto" ? "on" : "off",
    },
  ];
}

// Kiro (KAS 0.66) streams this after session/new while MCP servers connect.
export const KiroMcpStatus = Schema.Struct({
  sessionId: Schema.String,
  servers: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        status: Schema.String,
        error: Schema.optionalKey(Schema.Unknown),
        tools: Schema.optionalKey(Schema.Array(Schema.Unknown)),
      }),
    ),
  ),
  accessMode: Schema.optionalKey(Schema.String),
  accessModeFilteredServers: Schema.optionalKey(Schema.Array(Schema.String)),
  unresolvedRegistryServers: Schema.optionalKey(Schema.Array(Schema.String)),
});
type KiroMcpStatus = typeof KiroMcpStatus.Type;

/** Matches the stdio server name T3 sends in session/new. */
const T3_MCP_SERVER_NAME = "t3-code";

export function kiroT3McpBlockedReason(status: KiroMcpStatus): string | undefined {
  if (status.accessModeFilteredServers?.includes(T3_MCP_SERVER_NAME) !== true) return undefined;
  const policy =
    status.accessMode === "registry"
      ? "Kiro's MCP policy allows only servers from your organization's MCP registry"
      : "Kiro's MCP policy filtered T3 Code's MCP server";
  return `${policy}, so the agent calls T3 tools such as delegate_task through terminal commands instead.`;
}

const isSettledStatus = (status: string) => status !== "connecting";

/** One notice per failed server, and a summary once no server is still connecting. */
export function kiroMcpStatusNotices(
  status: KiroMcpStatus,
): ReadonlyArray<{ readonly key: string; readonly title: string; readonly description?: string }> {
  const servers = status.servers ?? [];
  const failed = servers.filter(
    (server) => server.status !== "connected" && isSettledStatus(server.status),
  );
  const notices: Array<{ key: string; title: string; description?: string }> = failed.map(
    (server) => ({
      key: `server:${server.name}:${server.status}`,
      title: `Kiro MCP server ${server.name}: ${server.status}`,
      ...(typeof server.error === "string" && server.error.trim().length > 0
        ? { description: server.error.trim().slice(0, 1_024) }
        : {}),
    }),
  );
  if (servers.length === 0 || !servers.every((server) => isSettledStatus(server.status))) {
    return notices;
  }
  const blocked = (status.accessModeFilteredServers ?? []).filter(
    (name) => name !== T3_MCP_SERVER_NAME,
  );
  const lines = [
    `Connected: ${
      servers
        .filter((server) => server.status === "connected")
        .map((server) => `${server.name} (${server.tools?.length ?? 0} tools)`)
        .join(", ") || "none"
    }`,
    ...(failed.length === 0
      ? []
      : [
          `Not connected: ${failed.map((server) => `${server.name} (${server.status})`).join(", ")}`,
        ]),
    ...(blocked.length === 0 ? [] : [`Blocked by MCP policy: ${blocked.join(", ")}`]),
    ...((status.unresolvedRegistryServers ?? []).length === 0
      ? []
      : [`Not in the MCP registry: ${(status.unresolvedRegistryServers ?? []).join(", ")}`]),
  ];
  notices.push({
    key: "settled",
    title: failed.length === 0 ? "Kiro MCP servers ready" : "Kiro MCP servers started with errors",
    description: lines.join("\n"),
  });
  return notices;
}

export function registerKiroAcpExtensions(context: AcpAdapterV2ExtensionContext) {
  return context.runtime.handleExtNotification("_kiro/mcp/status", KiroMcpStatus, (status) =>
    Effect.gen(function* () {
      const reason = kiroT3McpBlockedReason(status);
      if (reason !== undefined) {
        yield* context.reportT3McpBlocked({ sessionId: status.sessionId, reason });
      }
      for (const notice of kiroMcpStatusNotices(status)) {
        yield* context.reportSessionNotice({ sessionId: status.sessionId, ...notice });
      }
    }),
  );
}
