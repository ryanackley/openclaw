/**
 * Agent loop — wraps the Claude Agent SDK with our system prompt, tools, and safety hooks.
 *
 * Includes:
 *   - Safety guardrails (PreToolUse)
 *   - Transcript logging (every message to JSONL)
 *   - Memory flush on context compaction (PreCompact hook)
 *   - Session persistence (resume across messages)
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  ClaudeAgentOptions,
  HookCallback,
  PreToolUseHookInput,
  PreCompactHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { buildSystemPrompt } from "./system-prompt.js";
import { checkToolSafety } from "./safety.js";
import {
  logUserMessage,
  logAssistantMessage,
  logToolUse,
  logToolResult,
  logSystemEvent,
} from "./transcript.js";
import {
  shouldFlush,
  buildFlushPrompt,
  markFlushed,
  ensureMemoryDir,
} from "./memory-flush.js";
import { memoryServer } from "./memory-tools.js";

// ---------------------------------------------------------------------------
// SDK message types — matches the actual shapes from @anthropic-ai/claude-agent-sdk
//
// AssistantMessage: { type: "assistant", message: BetaMessage, ... }
//   BetaMessage.content: Array<TextBlock | ToolUseBlock>
//
// UserMessage: { type: "user", message: MessageParam, ... }
//   MessageParam.content: Array<ToolResultBlock | TextBlock>
//
// SystemMessage: { type: "system", subtype: "init" | "compact_boundary" | "status", ... }
//
// ResultMessage: { type: "result", subtype: "success" | "error_*", session_id, ... }
// ---------------------------------------------------------------------------

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
}

interface SDKAssistantMessage {
  type: "assistant";
  uuid: string;
  session_id: string;
  message: {
    content: ContentBlock[];
    stop_reason?: string | null;
  };
}

interface SDKUserMessage {
  type: "user";
  uuid?: string;
  session_id: string;
  message: {
    content: ContentBlock[] | string;
  };
}

interface SDKSystemMessage {
  type: "system";
  subtype: "init" | "compact_boundary" | "status" | "local_command_output";
  uuid: string;
  session_id: string;
}

interface SDKResultMessage {
  type: "result";
  subtype:
    | "success"
    | "error_max_turns"
    | "error_during_execution"
    | "error_max_budget_usd"
    | "error_max_structured_output_retries";
  uuid: string;
  session_id: string;
  is_error: boolean;
  result?: string;
  errors?: string[];
  total_cost_usd: number;
  num_turns: number;
}

type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKSystemMessage
  | SDKResultMessage
  | { type: string; [key: string]: unknown }; // catch-all for other event types

const safetyGuardrail: HookCallback = async (input) => {
  const preInput = input as PreToolUseHookInput;
  const toolName = preInput.tool_name ?? "";
  const toolInput = (preInput.tool_input as Record<string, unknown>) ?? {};

  const result = checkToolSafety(toolName, toolInput);

  if (!result.allowed) {
    console.warn(`[safety] Blocked ${toolName}: ${result.reason}`);
    return {
      hookSpecificOutput: {
        hookEventName: preInput.hook_event_name,
        permissionDecision: "deny" as const,
        permissionDecisionReason: result.reason ?? "Blocked by safety guardrail",
      },
    };
  }

  return {};
};

// ---------------------------------------------------------------------------
// Pre-compaction hook — flush memories before context gets summarized
// ---------------------------------------------------------------------------

const preCompactFlush: HookCallback = async (input) => {
  const compactInput = input as PreCompactHookInput;
  console.log(
    `[memory] Context compaction triggered (${compactInput.trigger}), checking for memory flush...`,
  );

  const { needed, transcript } = await shouldFlush();
  if (needed && transcript) {
    console.log("[memory] Flushing conversation memories to disk...");
    markFlushed();
    await logSystemEvent("Memory flush triggered by context compaction");

    // Return a system message that tells the agent to flush memories
    // The agent will use its tools to write the memory file
    return {
      hookSpecificOutput: {
        systemMessage: buildFlushPrompt(transcript),
      },
    };
  }

  return {};
};

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

interface SessionState {
  sessionId?: string;
  systemPrompt: string;
}

let sessionState: SessionState | null = null;

export async function initSession(): Promise<void> {
  await ensureMemoryDir();
  const systemPrompt = await buildSystemPrompt();
  sessionState = { systemPrompt };
  console.log("[agent] System prompt built (%d chars)", systemPrompt.length);
  await logSystemEvent("Session initialized");
}

// ---------------------------------------------------------------------------
// Message streaming types
// ---------------------------------------------------------------------------

export interface StreamCallback {
  onText: (text: string) => void;
  onToolUse: (name: string, id: string) => void;
  onToolResult: (id: string, result: string) => void;
  onCompaction: () => void;
  onComplete: (fullText: string) => void;
  onError: (error: string) => void;
}

// ---------------------------------------------------------------------------
// Send a message through the agent loop
// ---------------------------------------------------------------------------

export async function sendMessage(
  userMessage: string,
  callbacks: StreamCallback,
): Promise<void> {
  if (!sessionState) {
    await initSession();
  }

  // Log user message to transcript
  await logUserMessage(userMessage);

  const options: ClaudeAgentOptions = {
    systemPrompt: sessionState!.systemPrompt,
    allowedTools: [
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Glob",
      "Grep",
      "WebSearch",
      "WebFetch",
      "Agent",
      "TodoWrite",
      "mcp__memory__*",
    ],
    permissionMode: "bypassPermissions",
    maxTurns: 50,
    mcpServers: {
      memory: memoryServer,
    },
    hooks: {
      PreToolUse: [
        {
          matcher: "Read|Write|Edit|Bash|Glob|Grep",
          hooks: [safetyGuardrail],
        },
      ],
      PreCompact: [{ hooks: [preCompactFlush] }],
    },
    ...(sessionState!.sessionId && { resume: sessionState!.sessionId }),
  };

  let fullText = "";

  try {
    for await (const message of query({
      prompt: userMessage,
      options,
    })) {
      const msg = message as SDKMessage;

      switch (msg.type) {
        case "assistant": {
          const assistantMsg = msg as SDKAssistantMessage;
          const content = assistantMsg.message?.content ?? [];

          // Extract text blocks
          for (const block of content) {
            if (block.type === "text" && block.text) {
              fullText += block.text;
              callbacks.onText(block.text);
            }
          }

          // Extract tool use blocks
          for (const block of content) {
            if (block.type === "tool_use" && block.name && block.id) {
              callbacks.onToolUse(block.name, block.id);
              await logToolUse(block.name, block.id, block.input);
            }
          }
          break;
        }

        case "user": {
          // Tool results come back as user messages
          const userMsg = msg as SDKUserMessage;
          const content = userMsg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "tool_result" && block.tool_use_id) {
                const summary = truncate(
                  JSON.stringify(block.content ?? ""),
                  200,
                );
                callbacks.onToolResult(block.tool_use_id, summary);
                await logToolResult(block.tool_use_id, summary);
              }
            }
          }
          break;
        }

        case "system": {
          const sysMsg = msg as SDKSystemMessage;
          if (sysMsg.subtype === "compact_boundary") {
            callbacks.onCompaction();
            await logSystemEvent("Context compacted");
          }
          break;
        }

        case "result": {
          const resultMsg = msg as SDKResultMessage;

          // Always capture session_id for resumption
          if (resultMsg.session_id) {
            sessionState!.sessionId = resultMsg.session_id;
          }

          // Handle errors
          if (resultMsg.is_error) {
            const errorText =
              resultMsg.errors?.join("; ") ??
              `Agent stopped: ${resultMsg.subtype}`;
            callbacks.onError(errorText);
          }
          break;
        }

        // Ignore other message types (stream_event, status, etc.)
      }
    }

    // Log the full assistant response
    if (fullText) {
      await logAssistantMessage(fullText);
    }

    callbacks.onComplete(fullText);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    callbacks.onError(errMsg);
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown — flush memories if needed
// ---------------------------------------------------------------------------

export async function flushOnShutdown(): Promise<void> {
  const { needed, transcript } = await shouldFlush();
  if (needed && transcript) {
    console.log("[memory] Flushing memories before shutdown...");
    markFlushed();
    await logSystemEvent("Memory flush triggered by shutdown");
    // In a real implementation, we'd run a final agent turn here.
    // For now, log the transcript summary as a system event.
    await logSystemEvent(
      "Unflushed transcript available at ~/memory/transcripts/",
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}
