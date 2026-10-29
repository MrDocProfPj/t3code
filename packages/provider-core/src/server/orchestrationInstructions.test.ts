import { assert, describe, it } from "@effect/vitest";

import {
  T3_CODE_DEVICE_TOOL_INSTRUCTIONS,
  T3_CODE_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH,
  T3_CODE_ORCHESTRATION_INSTRUCTIONS,
  t3AcpPromptWithInstructions,
  t3OrchestrationPrompt,
  t3OrchestrationSystemPrompt,
} from "./orchestrationInstructions.ts";

describe("T3 device instructions", () => {
  it("route device work through device_open and give Claude the line that loads the tools", () => {
    for (const intent of ["`device_list`", "`device_open`", "`agent-device`", "ssh", "`hostId`"]) {
      assert.include(T3_CODE_DEVICE_TOOL_INSTRUCTIONS, intent);
    }
    assert.notInclude(T3_CODE_DEVICE_TOOL_INSTRUCTIONS, "ToolSearch");
    const loadLine =
      " Load them with ToolSearch `select:mcp__t3-code__device_list,mcp__t3-code__device_open,mcp__t3-code__device_screenshot,mcp__t3-code__device_close`.";
    assert.include(T3_CODE_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH, loadLine);
    assert.equal(
      T3_CODE_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH.replace(loadLine, ""),
      T3_CODE_DEVICE_TOOL_INSTRUCTIONS,
    );
  });

  it("open the app before the returned command's snapshots, screenshots and input", () => {
    assert.include(
      T3_CODE_DEVICE_TOOL_INSTRUCTIONS,
      "its snapshots, screenshots and input need `open <app>` first,",
    );
  });

  it("keep the failure rule from taking over or closing a session another thread holds", () => {
    // agent-device's DEVICE_IN_USE advice is to rerun with the owner's --session or close it first.
    assert.include(
      T3_CODE_DEVICE_TOOL_INSTRUCTIONS,
      "follow its advice once, but never reuse or close another session; if it still fails,",
    );
  });

  it("reach OpenCode and Cursor only when the session holds device access", () => {
    assert.include(t3OrchestrationSystemPrompt(true, true), T3_CODE_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(t3OrchestrationSystemPrompt(true, false), "## T3 Code devices");
    assert.isUndefined(t3OrchestrationSystemPrompt(false, true));

    const firstRun = (hasDeviceTools: boolean) =>
      t3OrchestrationPrompt({
        prompt: "Check the login screen.",
        hasT3Mcp: true,
        hasDeviceTools,
        orchestrationDelivered: false,
        deviceInstructionsDelivered: false,
      });
    assert.include(firstRun(true), T3_CODE_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(firstRun(false), "## T3 Code devices");

    const laterRun = (deviceInstructionsDelivered: boolean) =>
      t3OrchestrationPrompt({
        prompt: "Check the login screen.",
        hasT3Mcp: true,
        hasDeviceTools: true,
        orchestrationDelivered: true,
        deviceInstructionsDelivered,
      });
    assert.include(laterRun(false), T3_CODE_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(laterRun(false), T3_CODE_ORCHESTRATION_INSTRUCTIONS.trim());
    assert.equal(laterRun(true), "Check the login screen.");
  });

  it("reach ACP agents again when device access changes mid-thread", () => {
    const state = { interactionMode: "default", hasT3Mcp: true, hasDeviceTools: false } as const;
    const withDevices = t3AcpPromptWithInstructions({
      prompt: "Check the login screen.",
      state: { ...state, hasDeviceTools: true },
      previousState: state,
    });
    assert.include(withDevices, T3_CODE_DEVICE_TOOL_INSTRUCTIONS);
    assert.equal(
      t3AcpPromptWithInstructions({ prompt: "Again.", state, previousState: state }),
      "Again.",
    );
    assert.notInclude(t3AcpPromptWithInstructions({ prompt: "Hi.", state }), "## T3 Code devices");
  });
});

describe("T3 ACP terminal fallback", () => {
  const state = { interactionMode: "default", hasT3Mcp: true, hasDeviceTools: false } as const;
  const prompt = (overrides: Partial<Parameters<typeof t3AcpPromptWithInstructions>[0]["state"]>) =>
    t3AcpPromptWithInstructions({ prompt: "Hi.", state: { ...state, ...overrides } });

  it("uses POSIX syntax unless the agent's terminal is PowerShell", () => {
    assert.include(prompt({}), `ELECTRON_RUN_AS_NODE=1 "$T3_ACP_MCP_NODE"`);
    const powershell = prompt({ terminal: "powershell" });
    // pwsh rejects VAR=value prefixes and mangles quoted JSON passed to native programs.
    assert.notInclude(powershell, "ELECTRON_RUN_AS_NODE=1 ");
    assert.include(
      powershell,
      "`$env:ELECTRON_RUN_AS_NODE='1'; $env:T3_ACP_MCP_ARGUMENTS='{}'; & $env:T3_ACP_MCP_NODE $env:T3_ACP_MCP_ENTRYPOINT acp-mcp-call orchestrator_capabilities`",
    );
  });

  it("states the block instead of a conditional once the agent reports it", () => {
    assert.include(prompt({}), "if the T3 tools are absent");
    const blocked = prompt({ t3McpBlocked: true, terminal: "powershell" });
    assert.include(blocked, "MCP policy blocked T3 Code's MCP server");
    assert.notInclude(blocked, "if the T3 tools are absent");
  });

  it("resends the instructions when a block is reported after the first turn", () => {
    const resent = t3AcpPromptWithInstructions({
      prompt: "Next.",
      state: { ...state, t3McpBlocked: true },
      previousState: state,
    });
    assert.include(resent, "MCP policy blocked T3 Code's MCP server");
  });
});
