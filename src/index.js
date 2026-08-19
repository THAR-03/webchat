import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "webchat",
        version: 4,
        ownerKeyConfigured: Boolean(env.OWNER_KEY),
      });
    }

    // WebSocket
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket required", {
          status: 426,
        });
      }

      const id = env.CHAT_HUB.idFromName("main");
      const room = env.CHAT_HUB.get(id);

      return room.fetch(request);
    }

    // Website
    return env.ASSETS.fetch(request);
  },
};

export class ChatHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    this.ctx = ctx;
    this.env = env;

    // SQLite persistent storage.
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        chat_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        online INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        name TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_chat
      ON messages(chat_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_chats_updated
      ON chats(updated_at);
    `);
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

  send(ws, data) {
    try {
      ws.send(JSON.stringify(data));
    } catch {}
  }

  broadcast(data, filter = () => true) {
    const message = JSON.stringify(data);

    for (const ws of this.ctx.getWebSockets()) {
      const attachment =
        ws.deserializeAttachment() || {};

      if (!filter(attachment, ws)) {
        continue;
      }

      try {
        ws.send(message);
      } catch {}
    }
  }

  getChat(chatId) {
    const rows = this.ctx.storage.sql
      .exec(
        `
        SELECT
          chat_id,
          name,
          created_at,
          updated_at,
          online
        FROM chats
        WHERE chat_id = ?
        LIMIT 1
        `,
        chatId
      )
      .toArray();

    return rows[0] || null;
  }

  getAllChats() {
    return this.ctx.storage.sql
      .exec(`
        SELECT
          chat_id,
          name,
          created_at,
          updated_at,
          online
        FROM chats
        ORDER BY updated_at DESC
      `)
      .toArray()
      .map((chat) => ({
        chatId: chat.chat_id,
        name: chat.name,
        createdAt: chat.created_at,
        updatedAt: chat.updated_at,
        online: Boolean(chat.online),
      }));
  }

  getHistory(chatId, limit = 100) {
    const safeLimit = Math.max(
      1,
      Math.min(Number(limit) || 100, 500)
    );

    return this.ctx.storage.sql
      .exec(
        `
        SELECT
          message_id,
          chat_id,
          sender,
          name,
          text,
          created_at
        FROM messages
        WHERE chat_id = ?
        ORDER BY created_at DESC
        LIMIT ${safeLimit}
        `,
        chatId
      )
      .toArray()
      .reverse()
      .map((message) => ({
        messageId: message.message_id,
        chatId: message.chat_id,
        sender: message.sender,
        name: message.name,
        text: message.text,
        time: new Date(
          Number(message.created_at)
        ).toISOString(),
      }));
  }

  saveChat(chatId, name, online = true) {
    const now = Date.now();

    const existing = this.getChat(chatId);

    if (existing) {
      this.ctx.storage.sql.exec(
        `
        UPDATE chats
        SET
          name = ?,
          updated_at = ?,
          online = ?
        WHERE chat_id = ?
        `,
        name,
        now,
        online ? 1 : 0,
        chatId
      );
    } else {
      this.ctx.storage.sql.exec(
        `
        INSERT INTO chats
          (chat_id, name, created_at, updated_at, online)
        VALUES
          (?, ?, ?, ?, ?)
        `,
        chatId,
        name,
        now,
        now,
        online ? 1 : 0
      );
    }
  }

  saveMessage(chatId, sender, name, text) {
    const messageId = crypto.randomUUID();
    const now = Date.now();

    this.ctx.storage.sql.exec(
      `
      INSERT INTO messages
        (message_id, chat_id, sender, name, text, created_at)
      VALUES
        (?, ?, ?, ?, ?, ?)
      `,
      messageId,
      chatId,
      sender,
      name,
      text,
      now
    );

    this.ctx.storage.sql.exec(
      `
      UPDATE chats
      SET updated_at = ?
      WHERE chat_id = ?
      `,
      now,
      chatId
    );

    return {
      messageId,
      chatId,
      sender,
      name,
      text,
      time: new Date(now).toISOString(),
    };
  }

  async webSocketMessage(ws, raw) {
    let d;

    try {
      d =
        typeof raw === "string"
          ? JSON.parse(raw)
          : JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return;
    }

    const current =
      ws.deserializeAttachment() || {};

    // =========================
    // JOIN
    // =========================

    if (d.type === "join") {
      const role =
        d.role === "owner"
          ? "owner"
          : "visitor";

      const name = String(
        d.name || "Pengunjung"
      )
        .trim()
        .slice(0, 40);

      // =========================
      // OWNER LOGIN
      // =========================

      if (role === "owner") {
        const supplied = String(
          d.ownerKey || ""
        );

        const expected = String(
          this.env.OWNER_KEY || ""
        );

        if (
          !expected ||
          supplied !== expected
        ) {
          this.send(ws, {
            type: "auth_error",
            message:
              "OWNER_KEY salah atau belum diatur di Cloudflare.",
          });

          try {
            ws.close(
              1008,
              "Unauthorized"
            );
          } catch {}

          return;
        }

        ws.serializeAttachment({
          role: "owner",
          chatId: "",
          name: "Owner",
        });

        // Kirim semua chat yang pernah ada.
        const chats =
          this.getAllChats();

        for (const chat of chats) {
          this.send(ws, {
            type: "chat_available",
            ...chat,
          });
        }

        this.send(ws, {
          type: "owner_ready",
        });

        return;
      }

      // =========================
      // VISITOR LOGIN
      // =========================

      let chatId = String(
        d.chatId || ""
      ).trim();

      // Chat baru
      if (!chatId) {
        chatId = crypto.randomUUID();
      }

      const existing =
        this.getChat(chatId);

      this.saveChat(
        chatId,
        name,
        true
      );

      ws.serializeAttachment({
        role: "visitor",
        chatId,
        name,
      });

      this.send(ws, {
        type: "joined",
        chatId,
        name,
        returning: Boolean(existing),
      });

      // Kirim riwayat maksimal 100 pesan.
      const history =
        this.getHistory(
          chatId,
          100
        );

      this.send(ws, {
        type: "history",
        chatId,
        messages: history,
      });

      // Beri tahu owner.
      this.broadcast(
        {
          type: existing
            ? "chat_status"
            : "chat_new",
          chatId,
          name,
          online: true,
          updatedAt: Date.now(),
        },
        (a) => a.role === "owner"
      );

      return;
    }

    // =========================
    // OWNER REQUEST HISTORY
    // =========================

    if (
      current.role === "owner" &&
      d.type === "history"
    ) {
      const chatId = String(
        d.chatId || ""
      ).trim();

      if (!chatId) return;

      const chat =
        this.getChat(chatId);

      if (!chat) {
        this.send(ws, {
          type: "history",
          chatId,
          messages: [],
        });

        return;
      }

      const history =
        this.getHistory(
          chatId,
          500
        );

      this.send(ws, {
        type: "history",
        chatId,
        messages: history,
      });

      return;
    }

    // =========================
    // VISITOR MESSAGE
    // =========================

    if (
      current.role === "visitor" &&
      d.type === "message"
    ) {
      const text = String(
        d.text || ""
      )
        .trim()
        .slice(0, 2000);

      if (!text || !current.chatId) {
        return;
      }

      this.saveChat(
        current.chatId,
        current.name || "Pengunjung",
        true
      );

      const message =
        this.saveMessage(
          current.chatId,
          "visitor",
          current.name ||
            "Pengunjung",
          text
        );

      this.broadcast(
        {
          type: "message",
          ...message,
        },
        (a) =>
          a.role === "owner" ||
          (
            a.role === "visitor" &&
            a.chatId === current.chatId
          )
      );

      return;
    }

    // =========================
    // OWNER MESSAGE
    // =========================

    if (
      current.role === "owner" &&
      d.type === "message"
    ) {
      const chatId = String(
        d.chatId || ""
      ).trim();

      const text = String(
        d.text || ""
      )
        .trim()
        .slice(0, 2000);

      if (!chatId || !text) {
        return;
      }

      const chat =
        this.getChat(chatId);

      if (!chat) {
        return;
      }

      const message =
        this.saveMessage(
          chatId,
          "owner",
          "Owner",
          text
        );

      this.broadcast(
        {
          type: "message",
          ...message,
        },
        (a) =>
          a.role === "owner" ||
          (
            a.role === "visitor" &&
            a.chatId === chatId
          )
      );

      return;
    }
  }

  webSocketClose(
    ws,
    code,
    reason,
    wasClean
  ) {
    const attachment =
      ws.deserializeAttachment() || {};

    if (
      attachment.role === "visitor" &&
      attachment.chatId
    ) {
      const chat =
        this.getChat(
          attachment.chatId
        );

      if (chat) {
        this.ctx.storage.sql.exec(
          `
          UPDATE chats
          SET
            online = 0,
            updated_at = ?
          WHERE chat_id = ?
          `,
          Date.now(),
          attachment.chatId
        );

        this.broadcast(
          {
            type: "chat_status",
            chatId:
              attachment.chatId,
            name:
              attachment.name ||
              chat.name,
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
