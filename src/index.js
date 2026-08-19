import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "webchat",
        ownerKeyConfigured: Boolean(env.OWNER_KEY)
      });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }

      const id = env.CHAT_HUB.idFromName("main");
      return env.CHAT_HUB.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
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
      name: ""
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  send(ws, data) {
    try { ws.send(JSON.stringify(data)); } catch {}
  }

  broadcast(data, predicate = () => true) {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() || {};
      if (predicate(attachment)) this.send(ws, data);
    }
  }

  webSocketMessage(ws, raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const current = ws.deserializeAttachment() || {};

    if (data.type === "join") {
      const role = data.role === "owner" ? "owner" : "visitor";

      if (role === "owner") {
        const supplied = String(data.ownerKey || "");
        const expected = String(this.env.OWNER_KEY || "");

        if (!expected || supplied !== expected) {
          this.send(ws, {
            type: "auth_error",
            message: "OWNER_KEY salah atau belum diatur di Cloudflare."
          });
          try { ws.close(1008, "Unauthorized"); } catch {}
          return;
        }

        ws.serializeAttachment({
          role: "owner",
          chatId: "",
          name: "Owner"
        });

        for (const chat of this.chats.values()) {
          this.send(ws, {
            type: "chat_available",
            ...chat
          });
        }

        this.send(ws, { type: "owner_ready" });
        return;
      }

      let chatId = String(data.chatId || "").trim();

      // ID dibuat sekali di browser dan dipakai lagi saat reconnect.
      if (!chatId) {
        chatId = crypto.randomUUID();
      }

      const name =
        String(data.name || "Pengunjung")
          .trim()
          .slice(0, 40) || "Pengunjung";

      const old = this.chats.get(chatId) || {};

      const chat = {
        chatId,
        name,
        online: true,
        createdAt: old.createdAt || Date.now(),
        updated: Date.now()
      };

      this.chats.set(chatId, chat);

      ws.serializeAttachment({
        role: "visitor",
        chatId,
        name
      });

      this.send(ws, {
        type: "joined",
        chatId,
        name
      });

      this.broadcast(
        { type: "chat_available", ...chat },
        a => a.role === "owner"
      );

      return;
    }

    if (current.role === "visitor" && data.type === "message") {
      const text = String(data.text || "").trim().slice(0, 2000);
      if (!text) return;

      const chat = this.chats.get(current.chatId) || {
        chatId: current.chatId,
        name: current.name || "Pengunjung"
      };

      chat.online = true;
      chat.updated = Date.now();
      this.chats.set(current.chatId, chat);

      this.broadcast(
        {
          type: "message",
          chatId: current.chatId,
          sender: "visitor",
          name: current.name || "Pengunjung",
          text,
          time: new Date().toISOString()
        },
        a =>
          a.role === "owner" ||
          (a.role === "visitor" && a.chatId === current.chatId)
      );

      return;
    }

    if (current.role === "owner" && data.type === "message") {
      const chatId = String(data.chatId || "").trim();
      const text = String(data.text || "").trim().slice(0, 2000);

      if (!chatId || !text) return;

      this.broadcast(
        {
          type: "message",
          chatId,
          sender: "owner",
          name: "Owner",
          text,
          time: new Date().toISOString()
        },
        a =>
          a.role === "owner" ||
          (a.role === "visitor" && a.chatId === chatId)
      );
    }
  }

  webSocketClose(ws) {
    const attachment = ws.deserializeAttachment() || {};

    if (attachment.role !== "visitor" || !attachment.chatId) return;

    const chat = this.chats.get(attachment.chatId);

    if (chat) {
      chat.online = false;
      chat.updated = Date.now();
      this.chats.set(attachment.chatId, chat);

      this.broadcast(
        {
          type: "chat_status",
          chatId: attachment.chatId,
          name: attachment.name,
          online: false
        },
        a => a.role === "owner"
      );
    }
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }
}
