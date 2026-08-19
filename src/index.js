import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "webchat",
        version: 4,
        ownerKeyConfigured: !!env.OWNER_KEY
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
  }

  async fetch(request) {
    const url = new URL(request.url);

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

  getClients() {
    return this.ctx.getWebSockets();
  }

  send(ws, data) {
    try {
      ws.send(JSON.stringify(data));
    } catch {}
  }

  broadcast(data, filter = () => true) {
    for (const ws of this.getClients()) {
      const attachment = ws.deserializeAttachment() || {};

      if (filter(attachment)) {
        this.send(ws, data);
      }
    }
  }

  async webSocketMessage(ws, raw) {
    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const current = ws.deserializeAttachment() || {};

    /*
     * =========================
     * JOIN
     * =========================
     */

    if (data.type === "join") {
      const role =
        data.role === "owner"
          ? "owner"
          : "visitor";

      /*
       * OWNER
       */
      if (role === "owner") {
        const supplied = String(data.ownerKey || "");
        const expected = String(this.env.OWNER_KEY || "");

        if (!expected || supplied !== expected) {
          this.send(ws, {
            type: "auth_error",
            message:
              "OWNER_KEY salah atau belum diatur di Cloudflare."
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

        /*
         * Kirim daftar chat yang sudah ada
         */
        const chats = await this.listChats();

        for (const chat of chats) {
          this.send(ws, {
            type: "chat_available",
            ...chat
          });
        }

        this.send(ws, {
          type: "owner_ready"
        });

        return;
      }

      /*
       * VISITOR
       *
       * ID dikirim oleh browser.
       * Contoh:
       * VIS-A1B2C3D4
       */

      const chatId = String(
        data.chatId || crypto.randomUUID()
      )
        .trim()
        .slice(0, 80);

      const name = String(
        data.name || "Pengunjung"
      )
        .trim()
        .slice(0, 40);

      ws.serializeAttachment({
        role: "visitor",
        chatId,
        name
      });

      const existing = await this.getChat(chatId);

      const chat = {
        chatId,
        name,
        online: true,
        updated: Date.now()
      };

      await this.saveChat(chat);

      /*
       * Kirim ID ke pengunjung
       */
      this.send(ws, {
        type: "joined",
        chatId
      });

      /*
       * Jika chat sebelumnya ada,
       * kirim riwayatnya.
       */
      if (existing?.messages?.length) {
        for (const message of existing.messages) {
          this.send(ws, {
            type: "message",
            chatId,
            sender: message.sender,
            name: message.name,
            text: message.text,
            time: message.time,
            messageId: message.messageId
          });
        }
      }

      /*
       * Beritahu owner bahwa visitor online.
       */
      this.broadcast(
        {
          type: existing
            ? "chat_status"
            : "chat_new",

          chatId,
          name,
          online: true
        },
        a => a.role === "owner"
      );

      return;
    }

    /*
     * =========================
     * VISITOR MESSAGE
     * =========================
     */

    if (
      current.role === "visitor" &&
      data.type === "message"
    ) {
      const text = String(data.text || "")
        .trim()
        .slice(0, 2000);

      if (!text) return;

      const chatId = current.chatId;

      const chat =
        (await this.getChat(chatId)) || {
          chatId,
          name: current.name || "Pengunjung",
          messages: []
        };

      const message = {
        messageId: crypto.randomUUID(),
        sender: "visitor",
        name: current.name || "Pengunjung",
        text,
        time: new Date().toISOString()
      };

      chat.name = current.name || chat.name;
      chat.online = true;
      chat.updated = Date.now();

      chat.messages ||= [];
      chat.messages.push(message);

      /*
       * Maksimal 100 pesan per chat.
       */
      if (chat.messages.length > 100) {
        chat.messages =
          chat.messages.slice(-100);
      }

      await this.saveChat(chat);

      /*
       * Kirim ke owner dan visitor.
       */
      this.broadcast(
        {
          type: "message",
          chatId,
          ...message
        },
        a =>
          a.role === "owner" ||
          (
            a.role === "visitor" &&
            a.chatId === chatId
          )
      );

      return;
    }

    /*
     * =========================
     * OWNER MESSAGE
     * =========================
     */

    if (
      current.role === "owner" &&
      data.type === "message"
    ) {
      const chatId = String(
        data.chatId || ""
      ).trim();

      const text = String(
        data.text || ""
      )
        .trim()
        .slice(0, 2000);

      if (!chatId || !text) return;

      const chat = await this.getChat(chatId);

      if (!chat) {
        this.send(ws, {
          type: "error",
          message: "Chat tidak ditemukan."
        });

        return;
      }

      const message = {
        messageId: crypto.randomUUID(),
        sender: "owner",
        name: "Owner",
        text,
        time: new Date().toISOString()
      };

      chat.messages ||= [];
      chat.messages.push(message);

      if (chat.messages.length > 100) {
        chat.messages =
          chat.messages.slice(-100);
      }

      chat.updated = Date.now();

      await this.saveChat(chat);

      /*
       * Kirim ke visitor yang sesuai
       * dan owner.
       */
      this.broadcast(
        {
          type: "message",
          chatId,
          ...message
        },
        a =>
          a.role === "owner" ||
          (
            a.role === "visitor" &&
            a.chatId === chatId
          )
      );

      return;
    }
  }

  /*
   * =========================
   * STORAGE
   * =========================
   */

  async getChat(chatId) {
    return await this.ctx.storage.get(
      `chat:${chatId}`
    );
  }

  async saveChat(chat) {
    await this.ctx.storage.put(
      `chat:${chat.chatId}`,
      chat
    );
  }

  async listChats() {
    const result =
      await this.ctx.storage.list({
        prefix: "chat:"
      });

    const chats = [];

    for (const value of result.values()) {
      chats.push({
        chatId: value.chatId,
        name: value.name,
        online: !!value.online,
        updated: value.updated || 0
      });
    }

    chats.sort(
      (a, b) =>
        (b.updated || 0) -
        (a.updated || 0)
    );

    return chats;
  }

  webSocketClose(ws) {
    const attachment =
      ws.deserializeAttachment() || {};

    if (
      attachment.role === "visitor" &&
      attachment.chatId
    ) {
      this.markOffline(
        attachment.chatId,
        attachment.name
      );
    }
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }

  async markOffline(chatId, name) {
    const chat = await this.getChat(chatId);

    if (!chat) return;

    chat.online = false;
    chat.updated = Date.now();

    await this.saveChat(chat);

    this.broadcast(
      {
        type: "chat_status",
        chatId,
        name,
        online: false
      },
      a => a.role === "owner"
    );
  }
}
