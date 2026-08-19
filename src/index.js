import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "webchat",
        version: 6
      });
    }

    if (url.pathname === "/ws") {
      if (request.method !== "GET") {
        return new Response("GET required", { status: 400 });
      }

      const upgrade = request.headers.get("Upgrade");

      if (!upgrade || upgrade.toLowerCase() !== "websocket") {
        return new Response("WebSocket required", {
          status: 426
        });
      }

      try {
        const id = env.CHAT_HUB.idFromName("main");
        const stub = env.CHAT_HUB.get(id);

        return await stub.fetch(request);
      } catch (err) {
        console.error("WS ROUTE ERROR:", err);

        return new Response("WebSocket route error", {
          status: 500
        });
      }
    }

    return env.ASSETS.fetch(request);
  }
};

export class ChatHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    console.log("CHAT_HUB FETCH");

    try {
      const upgrade = request.headers.get("Upgrade");

      if (!upgrade || upgrade.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket", {
          status: 426
        });
      }

      const pair = new WebSocketPair();

      const client = pair[0];
      const server = pair[1];

      this.ctx.acceptWebSocket(server);

      server.serializeAttachment({
        role: "unknown",
        chatId: "",
        name: ""
      });

      console.log("WEBSOCKET ACCEPTED");

      return new Response(null, {
        status: 101,
        webSocket: client
      });

    } catch (err) {
      console.error("CHAT_HUB WS ERROR:", err);

      return new Response(
        "WebSocket server error: " + String(err?.message || err),
        {
          status: 500
        }
      );
    }
  }

  async webSocketMessage(ws, message) {
    console.log("WS MESSAGE:", message);

    try {
      ws.send(JSON.stringify({
        type: "test",
        message: "WebSocket berhasil terhubung."
      }));
    } catch (err) {
      console.error("MESSAGE ERROR:", err);
    }
  }

  async webSocketClose(ws, code, reason) {
    console.log(
      "WS CLOSE:",
      code,
      reason
    );
  }

  async webSocketError(ws, error) {
    console.error("WS ERROR:", error);
  }
}
