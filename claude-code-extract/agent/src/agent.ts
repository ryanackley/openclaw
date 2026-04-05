/**
 * Agent loop — wraps the Claude Agent SDK with our system prompt, tools, and safety hooks.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  ClaudeAgentOptions,
  HookCallback,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { buildSystemPrompt } from "./system-prompt.js";
import { checkToolSafety } from "./safety.js";

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
// Session state
// ---------------------------------------------------------------------------

interface SessionState {
  sessionId?: string;
  systemPrompt: string;
}

let sessionState: SessionState | null = null;

export async function initSession(): Promise<void> {
  const systemPrompt = await buildSystemPrompt();
  sessionState = { systemPrompt };
  console.log("[agent] System prompt built (%d chars)", systemPrompt.length);
}

// ---------------------------------------------------------------------------
// Message streaming types
// ---------------------------------------------------------------------------

export interface StreamCallback {
  onText: (text: string) => void;
  onToolUse: (name: string, id: string) => void;
  onToolResult: (id: string, result: string) => void;
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
          // Accumulate text from assistant messages
          const text = extractText(message);
          if (text) {
            fullText += text;
            callbacks.onText(text);
          }

          // Report tool calls
          const toolCalls = extractToolCalls(message);
          for (const tc of toolCalls) {
            callbacks.onToolUse(tc.name, tc.id);
          }
          break;
        }

        case "user": {
          // Tool results coming back
          const results = extractToolResults(message);
          for (const r of results) {
            callbacks.onToolResult(r.id, r.summary);
          }
          break;
        }

        case "result": {
          if (message.session_id) {
            sessionState!.sessionId = message.session_id;
          }
          if (message.subtype === "error") {
            callbacks.onError(
              (message as Record<string, unknown>).error_message as string ??
                "Agent error",
            );
          }
          break;
        }
      }
    }

    callbacks.onComplete(fullText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.onError(msg);
  }
}

// ---------------------------------------------------------------------------
// Message extraction helpers
// ---------------------------------------------------------------------------

function extractText(message: Record<string, unknown>): string {
  // AssistantMessage may have content array or direct text
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
