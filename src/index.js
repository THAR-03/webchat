import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === "/health")
      return Response.json({ ok: true, service: "webchat", version: 5, ownerKeyConfigured: Boolean(env.OWNER_KEY) });
    if (u.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
        return new Response("WebSocket required", { status: 426 });
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

  send(ws, d) {
    try { ws.send(JSON.stringify(d)); } catch {}
  }

  broadcast(d, p = () => true) {
    const m = JSON.stringify(d);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (p(a)) try { ws.send(m); } catch {}
    }
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Use the Durable Object WebSocket hibernation API. This is required
    // for webSocketMessage/webSocketClose/webSocketError to be called.
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async getHistory(chatId) {
    return (await this.ctx.storage.get(`history:${chatId}`)) || [];
  }

  async getChats() {
    const entries = await this.ctx.storage.list({ prefix: "chat:" });
    return new Map(entries);
  }

  async saveChat(chat) {
    await this.ctx.storage.put(`chat:${chat.chatId}`, chat);
    this.chats.set(chat.chatId, chat);
  }

  async saveMessage(chatId, message) {
    const key = `history:${chatId}`;
    const history = await this.getHistory(chatId);
    history.push(message);
    // Keep a generous limit so a single visitor cannot grow storage forever.
    const trimmed = history.slice(-1000);
    await this.ctx.storage.put(key, trimmed);
  }

  async webSocketMessage(ws, raw) {
    let d;
    try { d = JSON.parse(raw); } catch { return }

    const cur = ws.deserializeAttachment() || {};

    if (d.type === "join") {
      const role = d.role === "owner" ? "owner" : "visitor";

      if (role === "owner") {
        const supplied = String(d.ownerKey || "");
        const expected = String(this.env.OWNER_KEY || "");
        if (!expected || supplied !== expected) {
          this.send(ws, { type: "auth_error", message: "OWNER_KEY salah atau belum diatur di Cloudflare." });
          try { ws.close(1008, "Unauthorized"); } catch {}
          return;
        }

        ws.serializeAttachment({ role: "owner", chatId: "", name: "Owner" });
        const storedChats = await this.getChats();
        for (const c of storedChats.values()) {
          this.chats.set(c.chatId, c);
          this.send(ws, { type: "chat_available", ...c });
        }
        this.send(ws, { type: "owner_ready" });
        return;
      }

      const chatId = String(d.chatId || "").trim() || crypto.randomUUID();
      const name = String(d.name || "Pengunjung").trim().slice(0, 40) || "Pengunjung";
      const old = this.chats.get(chatId) || await this.ctx.storage.get(`chat:${chatId}`);
      const chat = { chatId, name: name || old?.name || "Pengunjung", online: true, updated: Date.now() };

      await this.saveChat(chat);
      ws.serializeAttachment({ role: "visitor", chatId, name });

      const history = await this.getHistory(chatId);
      this.send(ws, { type: "joined", chatId, name, history });

      this.broadcast(
        { type: old ? "chat_status" : "chat_new", ...chat },
        a => a.role === "owner"
      );
      return;
    }

    if (cur.role === "visitor" && d.type === "message") {
      const text = String(d.text || "").trim().slice(0, 2000);
      if (!text || !cur.chatId) return;

      const message = {
        chatId: cur.chatId,
        sender: "visitor",
        name: cur.name || "Pengunjung",
        text,
        time: new Date().toISOString()
      };

      const old = this.chats.get(cur.chatId) || {};
      await this.saveChat({
        ...old,
        chatId: cur.chatId,
        name: cur.name || old.name || "Pengunjung",
        online: true,
        updated: Date.now()
      });

      await this.saveMessage(cur.chatId, message);

      this.broadcast(
        { type: "message", ...message },
        a => a.role === "owner" || (a.role === "visitor" && a.chatId === cur.chatId)
      );
      return;
    }

    if (cur.role === "owner" && d.type === "message") {
      const chatId = String(d.chatId || "").trim();
      const text = String(d.text || "").trim().slice(0, 2000);
      if (!chatId || !text) return;

      const message = {
        chatId,
        sender: "owner",
        name: "Owner",
        text,
        time: new Date().toISOString()
      };

      await this.saveMessage(chatId, message);

      this.broadcast(
        { type: "message", ...message },
        a => a.role === "owner" || (a.role === "visitor" && a.chatId === chatId)
      );
    }
  }

  webSocketClose(ws) {
    const a = ws.deserializeAttachment() || {};
    if (a.role === "visitor" && a.chatId) {
      const c = this.chats.get(a.chatId);
      if (c) {
        const x = { ...c, online: false, updated: Date.now() };
        this.chats.set(a.chatId, x);
        this.ctx.storage.put(`chat:${a.chatId}`, x);
        this.broadcast(
          { type: "chat_status", chatId: a.chatId, name: a.name, online: false },
          z => z.role === "owner"
        );
      }
    }
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }
}
