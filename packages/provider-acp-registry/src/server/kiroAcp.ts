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
  accessMode: Schema.optionalKey(Schema.String),
  accessModeFilteredServers: Schema.optionalKey(Schema.Array(Schema.String)),
});

/** Matches the stdio server name T3 sends in session/new. */
const T3_MCP_SERVER_NAME = "t3-code";

export function kiroT3McpBlockedReason(status: typeof KiroMcpStatus.Type): string | undefined {
  if (status.accessModeFilteredServers?.includes(T3_MCP_SERVER_NAME) !== true) return undefined;
  const policy =
    status.accessMode === "registry"
      ? "Kiro's MCP policy allows only servers from your organization's MCP registry"
      : "Kiro's MCP policy filtered T3 Code's MCP server";
  return `${policy}, so the agent calls T3 tools such as delegate_task through terminal commands instead.`;
}

export function registerKiroAcpExtensions(context: AcpAdapterV2ExtensionContext) {
  return context.runtime.handleExtNotification("_kiro/mcp/status", KiroMcpStatus, (status) => {
    const reason = kiroT3McpBlockedReason(status);
    return reason === undefined
      ? Effect.void
      : context.reportT3McpBlocked({ sessionId: status.sessionId, reason });
  });
}
