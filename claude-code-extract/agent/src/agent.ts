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

// ---------------------------------------------------------------------------
// Safety hook — runs before every tool call
// ---------------------------------------------------------------------------

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
    ],
    permissionMode: "bypassPermissions",
    maxTurns: 50,
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
      switch (message.type) {
        case "assistant": {
          const text = extractText(message);
          if (text) {
            fullText += text;
            callbacks.onText(text);
          }

          const toolCalls = extractToolCalls(message);
          for (const tc of toolCalls) {
            callbacks.onToolUse(tc.name, tc.id);
            await logToolUse(tc.name, tc.id);
          }
          break;
        }

        case "user": {
          const results = extractToolResults(message);
          for (const r of results) {
            callbacks.onToolResult(r.id, r.summary);
            await logToolResult(r.id, r.summary);
          }
          break;
        }

        case "system": {
          // Detect compaction boundary
          const subtype = (message as Record<string, unknown>).subtype;
          if (subtype === "compact_boundary") {
            callbacks.onCompaction();
            await logSystemEvent("Context compacted");
          }
          break;
        }

        case "result": {
          if (message.session_id) {
            sessionState!.sessionId = message.session_id;
          }
          if (message.subtype === "error") {
            callbacks.onError(
              ((message as Record<string, unknown>).error_message as string) ??
                "Agent error",
            );
          }
          break;
        }
      }
    }

    // Log the full assistant response
    if (fullText) {
      await logAssistantMessage(fullText);
    }

    callbacks.onComplete(fullText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.onError(msg);
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
// Message extraction helpers
// ---------------------------------------------------------------------------

function extractText(message: Record<string, unknown>): string {
  if (typeof message.text === "string") return message.text;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((b: Record<string, unknown>) => b.type === "text")
      .map((b: Record<string, unknown>) => b.text as string)
      .join("");
  }
  return "";
}

function extractToolCalls(
  message: Record<string, unknown>,
): Array<{ name: string; id: string }> {
  if (!Array.isArray(message.content)) return [];
  return message.content
    .filter((b: Record<string, unknown>) => b.type === "tool_use")
    .map((b: Record<string, unknown>) => ({
      name: (b.name as string) ?? "unknown",
      id: (b.id as string) ?? "",
    }));
}

function extractToolResults(
  message: Record<string, unknown>,
): Array<{ id: string; summary: string }> {
  if (!Array.isArray(message.content)) return [];
  return message.content
    .filter((b: Record<string, unknown>) => b.type === "tool_result")
    .map((b: Record<string, unknown>) => ({
      id: (b.tool_use_id as string) ?? "",
      summary: truncate(JSON.stringify(b.content ?? ""), 200),
    }));
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}
