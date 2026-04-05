/**
 * HTTP + WebSocket server for the web chat interface.
 *
 * HTTP serves the static frontend.
 * WebSocket streams agent messages in real time.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { sendMessage, initSession } from "./agent.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ---------------------------------------------------------------------------
// HTTP server — serves static files from public/
// ---------------------------------------------------------------------------

const httpServer = createServer(async (req, res) => {
  const url = req.url === "/" ? "/index.html" : req.url ?? "/index.html";
  const filePath = join(PUBLIC_DIR, url);

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    // SPA fallback
    try {
      const index = await readFile(join(PUBLIC_DIR, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(index);
    } catch {
      res.writeHead(404);
      res.end("Not Found");
    }
  }
});

// ---------------------------------------------------------------------------
// WebSocket server — handles chat messages
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server: httpServer });

/** Send a typed JSON message to a client */
function send(ws: WebSocket, type: string, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

wss.on("connection", (ws) => {
  console.log("[ws] Client connected");

  send(ws, "connected", { message: "OpenClaw Agent ready" });

  ws.on("message", async (raw) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      send(ws, "error", { message: "Invalid JSON" });
      return;
    }

    if (data.type === "chat") {
      const userMessage = data.message as string;
      if (!userMessage?.trim()) {
        send(ws, "error", { message: "Empty message" });
        return;
      }

      // Stream the agent response back over WebSocket
      const messageId = crypto.randomUUID();
      send(ws, "chat_start", { id: messageId });

      await sendMessage(userMessage, {
        onText(text) {
          send(ws, "chat_delta", { id: messageId, text });
        },
        onToolUse(name, toolId) {
          send(ws, "tool_use", { id: messageId, tool: name, toolId });
        },
        onToolResult(toolId, result) {
          send(ws, "tool_result", { id: messageId, toolId, result });
        },
        onComplete(fullText) {
          send(ws, "chat_end", { id: messageId, text: fullText });
        },
        onError(error) {
          send(ws, "error", { id: messageId, message: error });
        },
      });
    }
  });

  ws.on("close", () => {
    console.log("[ws] Client disconnected");
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export async function startServer(port: number = 3000): Promise<void> {
  await initSession();

  httpServer.listen(port, () => {
    console.log(`\n  OpenClaw Agent running at http://localhost:${port}\n`);
  });
}
