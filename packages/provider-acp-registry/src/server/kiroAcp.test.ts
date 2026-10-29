import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { AcpRegistrySettings } from "../settings.ts";
import {
  isKiroAcpCommand,
  KIRO_HIDDEN_CONFIG_OPTION_IDS,
  kiroConfigOptionsForPolicy,
  kiroT3McpBlockedReason,
} from "./kiroAcp.ts";
import { normalizeAcpRegistryLiveConfiguration } from "./probe.ts";
import fixture from "../../test/fixtures/kiro-acp.json" with { type: "json" };
import { parseSessionModeState } from "@t3tools/provider-acp/server/runtimeModel";

const decodeSettings = Schema.decodeSync(AcpRegistrySettings);
const settings = (input: Partial<AcpRegistrySettings>) => decodeSettings(input);

describe("isKiroAcpCommand", () => {
  it.each([
    ["C:\\Users\\me\\AppData\\Local\\Kiro-Cli\\kiro-cli.exe", true],
    ["/usr/local/bin/kiro-cli", true],
    ["kiro-cli.cmd", true],
    ["/usr/local/bin/kiro", false],
    ["/opt/kiro-cli-wrapper", false],
  ])("%s → %s", (commandPath, expected) => {
    expect(isKiroAcpCommand(settings({ source: "local", commandPath }))).toBe(expected);
  });

  it("ignores registry agents that override the executable", () => {
    expect(
      isKiroAcpCommand(settings({ source: "registry", agentId: "devin", commandPath: "kiro-cli" })),
    ).toBe(false);
  });
});

describe("Kiro composer options", () => {
  const sessionNew = fixture.sessionNew as unknown as Parameters<
    typeof parseSessionModeState
  >[0] & {
    readonly configOptions: Parameters<typeof normalizeAcpRegistryLiveConfiguration>[0];
  };

  it("shows every Kiro IDE control without the filter", () => {
    const { configOptions } = normalizeAcpRegistryLiveConfiguration(
      sessionNew.configOptions,
      parseSessionModeState(sessionNew),
    );
    expect(configOptions.map((option) => option.id)).toEqual([
      "mode",
      "memoryReflection",
      "autopilot",
      "contentCollection",
    ]);
    // Bundled modes plus agents from ~/.kiro/agents.
    expect(configOptions[0]?.type === "select" ? configOptions[0].options.length : 0).toBe(9);
  });

  it("leaves only the model picker, with no synthetic mode picker", () => {
    const live = normalizeAcpRegistryLiveConfiguration(
      sessionNew.configOptions,
      parseSessionModeState(sessionNew),
      undefined,
      KIRO_HIDDEN_CONFIG_OPTION_IDS,
    );
    expect(live.configOptions).toEqual([]);
    expect(live.models.map((model) => model.id)).toEqual(["auto", "claude-sonnet-5.5"]);
  });

  it("keeps effort, which Kiro adds once a model is chosen", () => {
    const { configOptions } = normalizeAcpRegistryLiveConfiguration(
      [
        ...sessionNew.configOptions,
        {
          id: "effortLevel",
          name: "Effort",
          type: "select",
          currentValue: "high",
          options: [
            { value: "medium", name: "Medium" },
            { value: "high", name: "High" },
          ],
        },
      ],
      parseSessionModeState(sessionNew),
      undefined,
      KIRO_HIDDEN_CONFIG_OPTION_IDS,
    );
    expect(configOptions.map((option) => option.id)).toEqual(["effortLevel"]);
  });

  it.each([
    ["full-access", "on"],
    ["auto", "on"],
    ["auto-accept-edits", "off"],
    ["approval-required", "off"],
  ] as const)("runs %s threads with autopilot %s in the default mode", (runtimeMode, autopilot) => {
    expect(kiroConfigOptionsForPolicy({ runtimeMode })).toEqual([
      { id: "mode", value: "vibe" },
      { id: "autopilot", value: autopilot },
    ]);
  });
});

describe("kiroT3McpBlockedReason", () => {
  it("explains a registry-only policy that filtered T3's server", () => {
    for (const status of Object.values(fixture.mcpStatus)) {
      expect(kiroT3McpBlockedReason(status)).toMatch(/organization's MCP registry/);
    }
  });

  it("ignores policies that filtered only other servers", () => {
    const { settled } = fixture.mcpStatus;
    expect(
      kiroT3McpBlockedReason({
        ...settled,
        accessModeFilteredServers: settled.accessModeFilteredServers.filter(
          (name) => name !== "t3-code",
        ),
      }),
    ).toBeUndefined();
    expect(kiroT3McpBlockedReason({ sessionId: settled.sessionId })).toBeUndefined();
  });
});
