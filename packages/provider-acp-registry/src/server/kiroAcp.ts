import type { ProviderAdapterV2RuntimePolicy } from "@t3tools/provider-core/server/ProviderAdapter";

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
