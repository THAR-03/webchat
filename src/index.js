import { DurableObject } from "cloudflare:workers";

const MAX_TEXT = 2000;
const MAX_NAME = 40;

function text(value, max = MAX_TEXT) {
  return String(value ?? "").trim().slice(0, max);
}

function name(value) {
  return text(value, MAX_NAME) || "Pengunjung";
}

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
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }

      try {
        const id = env.CHAT_HUB.idFromName("main");
        const room = env.CHAT_HUB.get(id);
        return await room.fetch(request);
      } catch (error) {
        console.error("CHAT_HUB ERROR:", error);

        return new Response("WebSocket server error", {
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
    this.ready = this.initialize();
  }

  async initialize() {
    try {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id TEXT NOT NULL,
          sender TEXT NOT NULL,
          name TEXT NOT NULL,
          text TEXT NOT NULL,
          time TEXT NOT NULL
        )
      `);

      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS messages_chat_id
        ON messages(chat_id, id)
      `);
    } catch (error) {
      console.error("SQL INIT ERROR:", error);
      throw error;
    }
  }

  async fetch(request) {
    await this.ready;

    const upgrade = request.headers.get("Upgrade");

    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("WebSocket required", {
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

  broadcast(data, filter = () => true) {
    const message = JSON.stringify(data);

    for (const ws of this.ctx.getWebSockets()) {
      let attachment = {};

      try {
        attachment = ws.deserializeAttachment() || {};
      } catch {}

      if (!filter(attachment)) continue;

      try {
        ws.send(message);
      } catch {}
    }
  }

  async history(chatId) {
    const rows = this.ctx.storage.sql.exec(`
      SELECT id, chat_id, sender, name, text, time
      FROM messages
      WHERE chat_id = ?
      ORDER BY id ASC
      LIMIT 200
    `, chatId).toArray();

    return rows;
  }

  async save(chatId, sender, displayName, messageText) {
    const time = new Date().toISOString();

    const result = this.ctx.storage.sql.exec(`
      INSERT INTO messages
        (chat_id, sender, name, text, time)
      VALUES (?, ?, ?, ?, ?)
    `, chatId, sender, displayName, messageText);

    return {
      id: Number(result.lastInsertRowId),
      chatId,
      sender,
      name: displayName,
      text: messageText,
      time
    };
  }

  async webSocketMessage(ws, raw) {
    await this.ready;

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      this.send(ws, {
        type: "error",
        message: "JSON tidak valid."
      });
      return;
    }

    const current = ws.deserializeAttachment() || {};

    /*
     * JOIN
     */
    if (data.type === "join") {
      /*
       * OWNER
       */
      if (data.role === "owner") {
        const supplied = String(data.ownerKey ?? "");
        const expected = String(this.env.OWNER_KEY ?? "");

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

        this.send(ws, {
          type: "owner_ready"
        });

        return;
      }

      /*
       * VISITOR
       */
      const chatId =
        text(data.chatId, 100) ||
        crypto.randomUUID();

      const visitorName = name(data.name);

      ws.serializeAttachment({
        role: "visitor",
        chatId,
        name: visitorName
      });

      const messages = await this.history(chatId);

      this.send(ws, {
        type: "joined",
        chatId,
        name: visitorName,
        history: messages
      });

      this.broadcast({
        type: "chat_available",
        chatId,
        name: visitorName,
        online: true
      }, a => a.role === "owner");

      return;
    }

    /*
     * OWNER LIST
     */
    if (data.type === "list" && current.role === "owner") {
      const chats = new Map();

      for (const socket of this.ctx.getWebSockets()) {
        let a = {};

        try {
          a = socket.deserializeAttachment() || {};
        } catch {}

        if (a.role === "visitor" && a.chatId) {
          chats.set(a.chatId, {
            chatId: a.chatId,
            name: a.name || "Pengunjung",
            online: true
          });
        }
      }

      const rows = this.ctx.storage.sql.exec(`
        SELECT chat_id, MAX(id) AS last_id
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

    /*
     * OWNER HISTORY
     */
    if (data.type === "history" && current.role === "owner") {
      const chatId = text(data.chatId, 100);

      if (!chatId) return;

      const messages = await this.history(chatId);

      this.send(ws, {
        type: "history",
        chatId,
        history: messages
      });

      return;
    }

    /*
     * MESSAGE
     */
    if (data.type === "message") {
      const messageText = text(data.text);

      if (!messageText) return;

      let chatId;
      let sender;
      let displayName;

      /*
       * VISITOR
       */
      if (current.role === "visitor") {
        chatId = current.chatId;
        sender = "visitor";
        displayName = current.name || "Pengunjung";
      }

      /*
       * OWNER
       */
      else if (current.role === "owner") {
        chatId = text(data.chatId, 100);

        if (!chatId) return;

        sender = "owner";
        displayName = "Owner";
      }

      else {
        return;
      }

      const saved = await this.save(
        chatId,
        sender,
        displayName,
        messageText
      );

      /*
       * Kirim kembali ke semua visitor
       * yang mempunyai chat ID tersebut
       *
       * dan juga ke semua owner.
       */
      this.broadcast({
        type: "message",
        ...saved
      }, a => {
        return (
          a.role === "owner" ||
          (
            a.role === "visitor" &&
            a.chatId === chatId
          )
        );
      });

      return;
    }
  }

  async webSocketClose(ws) {
    let a = {};

    try {
      a = ws.deserializeAttachment() || {};
    } catch {}

    if (a.role === "visitor" && a.chatId) {
      this.broadcast({
        type: "chat_status",
        chatId: a.chatId,
        name: a.name || "Pengunjung",
        online: false
      }, x => x.role === "owner");
    }
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
}
