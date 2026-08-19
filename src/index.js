import { DurableObject } from "cloudflare:workers";

const MAX_TEXT = 2000;
const MAX_NAME = 40;
const MAX_MESSAGES = 500;

function cleanText(value, max = MAX_TEXT) {
  return String(value ?? "").trim().slice(0, max);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "webchat",
        version: 4
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
  }
};

export class ChatHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.initPromise = this.init();
  }

  async init() {
    // SQLite is persistent storage for this Durable Object.
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        chat_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        online INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        name TEXT NOT NULL,
        text TEXT NOT NULL,
        time TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_chat
        ON messages(chat_id, id);

      CREATE INDEX IF NOT EXISTS idx_chats_updated
        ON chats(updated_at DESC);
    `);
  }

  async fetch(request) {
    await this.initPromise;

    const url = new URL(request.url);
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
    try {
      ws.send(JSON.stringify(data));
    } catch {}
  }

  broadcast(data, predicate = () => true) {
    const message = JSON.stringify(data);

    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() || {};
      if (!predicate(attachment, ws)) continue;

      try {
        ws.send(message);
      } catch {}
    }
  }

  getChats() {
    return this.ctx.storage.sql.exec(`
      SELECT chat_id, name, created_at, updated_at, online
      FROM chats
      ORDER BY updated_at DESC
    `).toArray();
  }

  getMessages(chatId, limit = 100) {
    return this.ctx.storage.sql.exec(`
      SELECT id, chat_id, sender, name, text, time
      FROM messages
      WHERE chat_id = ?
      ORDER BY id DESC
      LIMIT ?
    `, chatId, limit).toArray().reverse();
  }

  saveChat(chatId, name, online) {
    const now = Date.now();

    this.ctx.storage.sql.exec(`
      INSERT INTO chats(chat_id, name, created_at, updated_at, online)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        name = excluded.name,
        updated_at = excluded.updated_at,
        online = excluded.online
    `, chatId, name, now, now, online ? 1 : 0);
  }

  saveMessage(chatId, sender, name, text) {
    const time = new Date().toISOString();

    this.ctx.storage.sql.exec(`
      INSERT INTO messages(chat_id, sender, name, text, time)
      VALUES (?, ?, ?, ?, ?)
    `, chatId, sender, name, text, time);

    // Keep each chat bounded so storage does not grow forever.
    this.ctx.storage.sql.exec(`
      DELETE FROM messages
      WHERE chat_id = ?
        AND id NOT IN (
          SELECT id FROM messages
          WHERE chat_id = ?
          ORDER BY id DESC
          LIMIT ?
        )
    `, chatId, chatId, MAX_MESSAGES);

    return { time };
  }

  async webSocketMessage(ws, raw) {
    await this.initPromise;

    let d;
    try {
      d = JSON.parse(raw);
    } catch {
      return;
    }

    const current = ws.deserializeAttachment() || {};

    if (d.type === "join") {
      const role = d.role === "owner" ? "owner" : "visitor";

      if (role === "owner") {
        const supplied = String(d.ownerKey || "");
        const expected = String(this.env.OWNER_KEY || "");

        if (!expected || supplied !== expected) {
          this.send(ws, {
            type: "auth_error",
            message: "OWNER_KEY salah atau belum diatur di Cloudflare."
          });

          try {
            ws.close(1008, "Unauthorized");
          } catch {}

          return;
        }

        ws.serializeAttachment({
          role: "owner",
          chatId: "",
          name: "Owner"
        });

        for (const chat of this.getChats()) {
          this.send(ws, {
            type: "chat_available",
            chatId: chat.chat_id,
            name: chat.name,
            online: !!chat.online,
            updated: chat.updated_at
          });
        }

        this.send(ws, { type: "owner_ready" });
        return;
      }

      let chatId = cleanText(d.chatId, 100);

      if (!chatId) {
        chatId = crypto.randomUUID();
      }

      let name = cleanText(d.name, MAX_NAME) || "Pengunjung";

      this.saveChat(chatId, name, true);

      ws.serializeAttachment({
        role: "visitor",
        chatId,
        name
      });

      const history = this.getMessages(chatId, 100);

      this.send(ws, {
        type: "joined",
        chatId,
        name,
        history
      });

      // Owner gets the chat and its existing history.
      this.broadcast(
        {
          type: "chat_available",
          chatId,
          name,
          online: true,
          updated: Date.now()
        },
        a => a.role === "owner"
      );

      return;
    }

    if (current.role === "visitor" && d.type === "message") {
      const text = cleanText(d.text);
      if (!text) return;

      this.saveChat(current.chatId, current.name || "Pengunjung", true);

      const saved = this.saveMessage(
        current.chatId,
        "visitor",
        current.name || "Pengunjung",
        text
      );

      this.broadcast(
        {
          type: "message",
          chatId: current.chatId,
          sender: "visitor",
          name: current.name || "Pengunjung",
          text,
          time: saved.time
        },
        a =>
          a.role === "owner" ||
          (a.role === "visitor" && a.chatId === current.chatId)
      );

      return;
    }

    if (current.role === "owner" && d.type === "message") {
      const chatId = cleanText(d.chatId, 100);
      const text = cleanText(d.text);

      if (!chatId || !text) return;

      const chats = this.ctx.storage.sql.exec(
        `SELECT chat_id, name FROM chats WHERE chat_id = ?`,
        chatId
      ).toArray();

      if (!chats.length) return;

      const saved = this.saveMessage(
        chatId,
        "owner",
        "Owner",
        text
      );

      this.ctx.storage.sql.exec(
        `UPDATE chats SET updated_at = ? WHERE chat_id = ?`,
        Date.now(),
        chatId
      );

      this.broadcast(
        {
          type: "message",
          chatId,
          sender: "owner",
          name: "Owner",
          text,
          time: saved.time
        },
        a =>
          (a.role === "visitor" && a.chatId === chatId) ||
          a.role === "owner"
      );
    }

    if (current.role === "owner" && d.type === "history") {
      const chatId = cleanText(d.chatId, 100);
      if (!chatId) return;

      const history = this.getMessages(chatId, 200);

      this.send(ws, {
        type: "history",
        chatId,
        history
      });
    }
  }

  async webSocketClose(ws) {
    await this.initPromise;

    const a = ws.deserializeAttachment() || {};

    if (a.role !== "visitor" || !a.chatId) return;

    this.ctx.storage.sql.exec(`
      UPDATE chats
      SET online = 0, updated_at = ?
      WHERE chat_id = ?
    `, Date.now(), a.chatId);

    this.broadcast(
      {
        type: "chat_status",
        chatId: a.chatId,
        name: a.name || "Pengunjung",
        online: false
      },
      x => x.role === "owner"
    );
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
}