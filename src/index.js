import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "webchat",
        version: 3,
        ownerKeyConfigured: Boolean(env.OWNER_KEY),
      });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }

      const id = env.CHAT_HUB.idFromName("main");
      return env.CHAT_HUB.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

export class ChatHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.chats = new Map();
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    server.serializeAttachment({
      role: "unknown",
      chatId: "",
      name: "",
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  broadcast(data, filter = () => true) {
    const msg = JSON.stringify(data);

    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() || {};

      if (filter(attachment, ws)) {
        try {
          ws.send(msg);
        } catch {}
      }
    }
  }

  webSocketMessage(ws, raw) {
    let d;

    try {
      d = JSON.parse(raw);
    } catch {
      return;
    }

    const current = ws.deserializeAttachment() || {};

    if (d.type === "join") {
      const role = d.role === "owner" ? "owner" : "visitor";

      const chatId = String(
        d.chatId || crypto.randomUUID()
      );

      const name = String(
        d.name || "Pengunjung"
      )
        .trim()
        .slice(0, 40);

      // OWNER LOGIN
      if (role === "owner") {
        const supplied = String(d.ownerKey || "");
        const expected = String(this.env.OWNER_KEY || "");

        if (!expected || supplied !== expected) {
          ws.send(
            JSON.stringify({
              type: "auth_error",
              message:
                "OWNER_KEY salah atau belum diatur di Cloudflare.",
            })
          );

          try {
            ws.close(1008, "Unauthorized");
          } catch {}

          return;
        }

        ws.serializeAttachment({
          role: "owner",
          chatId: "",
          name: "Owner",
        });

        for (const chat of this.chats.values()) {
          ws.send(
            JSON.stringify({
              type: "chat_available",
              ...chat,
            })
          );
        }

        ws.send(
          JSON.stringify({
            type: "owner_ready",
          })
        );

        return;
      }

      // VISITOR LOGIN
      this.chats.set(chatId, {
        chatId,
        name,
        online: true,
        updated: Date.now(),
      });

      ws.serializeAttachment({
        role: "visitor",
        chatId,
        name,
      });

      ws.send(
        JSON.stringify({
          type: "joined",
          chatId,
          name,
        })
      );

      this.broadcast(
        {
          type: "chat_new",
          chatId,
          name,
          online: true,
        },
        (a) => a.role === "owner"
      );

      return;
    }

    // VISITOR SEND MESSAGE
    if (
      current.role === "visitor" &&
      d.type === "message"
    ) {
      const text = String(d.text || "")
        .trim()
        .slice(0, 2000);

      if (!text) return;

      this.chats.set(current.chatId, {
        ...(this.chats.get(current.chatId) || {}),
        chatId: current.chatId,
        name: current.name,
        online: true,
        updated: Date.now(),
      });

      this.broadcast(
        {
          type: "message",
          chatId: current.chatId,
          sender: "visitor",
          name: current.name || "Pengunjung",
          text,
          time: new Date().toISOString(),
        },
        (a) =>
          a.role === "owner" ||
          (a.role === "visitor" &&
            a.chatId === current.chatId)
      );

      return;
    }

    // OWNER SEND MESSAGE
    if (
      current.role === "owner" &&
      d.type === "message"
    ) {
      const chatId = String(d.chatId || "").trim();

      const text = String(d.text || "")
        .trim()
        .slice(0, 2000);

      if (!chatId || !text) return;

      this.broadcast(
        {
          type: "message",
          chatId,
          sender: "owner",
          name: "Owner",
          text,
          time: new Date().toISOString(),
        },
        (a) =>
          (a.role === "visitor" &&
            a.chatId === chatId) ||
          a.role === "owner"
      );
    }
  }

  webSocketClose(ws) {
    const attachment =
      ws.deserializeAttachment() || {};

    if (
      attachment.role === "visitor" &&
      attachment.chatId
    ) {
      const chat = this.chats.get(
        attachment.chatId
      );

      if (chat) {
        chat.online = false;
        chat.updated = Date.now();

        this.chats.set(
          attachment.chatId,
          chat
        );

        this.broadcast(
          {
            type: "chat_status",
            chatId: attachment.chatId,
            name: attachment.name,
            online: false,
          },
          (x) => x.role === "owner"
        );
      }
    }
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }
}
