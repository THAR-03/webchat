import { DurableObject } from "cloudflare:workers";

const MAX_TEXT = 2000;
const MAX_NAME = 40;

function cleanText(value) {
  return String(value ?? "").trim().slice(0, MAX_TEXT);
}

function cleanName(value) {
  return String(value ?? "Pengunjung").trim().slice(0, MAX_NAME) || "Pengunjung";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "webchat", version: 5 });
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
    this.initPromise = this.init();
  }

  async init() {
    await this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        name TEXT NOT NULL,
        text TEXT NOT NULL,
        time TEXT NOT NULL
      )
    `);

    await this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_chat_id_id
      ON messages(chat_id, id)
    `);
  }

  async fetch(request) {
    await this.initPromise;

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

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
      return true;
    } catch {
      return false;
    }
  }

  broadcast(data, predicate = () => true) {
    const message = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() || {};
      if (!predicate(attachment)) continue;
      try {
        ws.send(message);
      } catch {}
    }
  }

  async getHistory(chatId, limit = 100) {
    const rows = this.ctx.storage.sql.exec(`
      SELECT id, chat_id, sender, name, text, time
      FROM messages
      WHERE chat_id = ?
      ORDER BY id DESC
      LIMIT ?
    `, chatId, limit).toArray();

    return rows.reverse();
  }

  async saveMessage(chatId, sender, name, text) {
    const time = new Date().toISOString();

    const result = this.ctx.storage.sql.exec(`
      INSERT INTO messages (chat_id, sender, name, text, time)
      VALUES (?, ?, ?, ?, ?)
    `, chatId, sender, name, text);

    return {
      id: Number(result.lastInsertRowId),
      chatId,
      sender,
      name,
      text,
      time
    };
  }

  async webSocketMessage(ws, raw) {
    await this.initPromise;

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return this.send(ws, {
        type: "error",
        message: "Format pesan tidak valid."
      });
    }

    const current = ws.deserializeAttachment() || {};

    if (data.type === "join") {
      const role = data.role === "owner" ? "owner" : "visitor";

      if (role === "owner") {
        const supplied = String(data.ownerKey ?? "");
        const expected = String(this.env.OWNER_KEY ?? "");

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

        this.send(ws, { type: "owner_ready" });
        return;
      }

      const chatId = cleanText(data.chatId) || crypto.randomUUID();
      const name = cleanName(data.name);

      ws.serializeAttachment({
        role: "visitor",
        chatId,
        name
      });

      const history = await this.getHistory(chatId);

      this.send(ws, {
        type: "joined",
        chatId,
        name,
        history
      });

      this.broadcast({
        type: "chat_available",
        chatId,
        name,
        online: true
      }, a => a.role === "owner");

      return;
    }

    if (data.type === "list" && current.role === "owner") {
      const chats = new Map();

      for (const ws2 of this.ctx.getWebSockets()) {
        const a = ws2.deserializeAttachment() || {};
        if (a.role === "visitor" && a.chatId) {
          chats.set(a.chatId, {
            chatId: a.chatId,
            name: a.name || "Pengunjung",
            online: true
          });
        }
      }

      const rows = this.ctx.storage.sql.exec(`
        SELECT chat_id, MAX(id) AS last_id, MAX(time) AS updated
        FROM messages
        GROUP BY chat_id
        ORDER BY last_id DESC
      `).toArray();

      for (const row of rows) {
        if (!chats.has(row.chat_id)) {
          chats.set(row.chat_id, {
            chatId: row.chat_id,
            name: "Pengunjung",
            online: false
          });
        }
      }

      this.send(ws, {
        type: "chat_list",
        chats: [...chats.values()]
      });
      return;
    }

    if (data.type === "history" && current.role === "owner") {
      const chatId = cleanText(data.chatId);
      if (!chatId) return;

      const history = await this.getHistory(chatId);
      this.send(ws, {
        type: "history",
        chatId,
        history
      });
      return;
    }

    if (data.type === "message") {
      const text = cleanText(data.text);
      if (!text) return;

      let chatId = "";
      let sender = "";
      let name = "";

      if (current.role === "visitor") {
        chatId = current.chatId;
        sender = "visitor";
        name = current.name || "Pengunjung";
      } else if (current.role === "owner") {
        chatId = cleanText(data.chatId);
        sender = "owner";
        name = "Owner";
      } else {
        return;
      }

      if (!chatId) return;

      const message = await this.saveMessage(
        chatId,
        sender,
        name,
        text
      );

      this.broadcast({
        type: "message",
        ...message
      }, attachment =>
        attachment.role === "owner" ||
        (attachment.role === "visitor" && attachment.chatId === chatId)
      );

      return;
    }
  }

  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment() || {};

    if (attachment.role === "visitor" && attachment.chatId) {
      this.broadcast({
        type: "chat_status",
        chatId: attachment.chatId,
        name: attachment.name || "Pengunjung",
        online: false
      }, a => a.role === "owner");
    }
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
}
