import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const u = new URL(request.url);

    // Health check
    if (u.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "webchat",
        version: 7,
        ownerKeyConfigured: Boolean(env.OWNER_KEY)
      });
    }

    // WebSocket endpoint
    if (u.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }

      const id = env.CHAT_HUB.idFromName("main");
      const hub = env.CHAT_HUB.get(id);

      return hub.fetch(request);
    }

    // Website
    return env.ASSETS.fetch(request);
  }
};


export class ChatHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    this.ctx = ctx;
    this.env = env;

    // Cache chat di memory
    this.chats = new Map();
  }


  /*
   * =========================================================
   * WEBSOCKET UPGRADE
   * =========================================================
   *
   * Bagian ini penting.
   *
   * Tanpa fetch() ini:
   *
   * owner.js
   *    ↓
   * /ws
   *    ↓
   * Durable Object
   *    ↓
   * HTTP 500
   *
   * Dengan ini:
   *
   * owner.js
   *    ↓
   * /ws
   *    ↓
   * ChatHub
   *    ↓
   * WebSocket aktif
   */

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket required", {
        status: 426
      });
    }

    const pair = new WebSocketPair();

    const client = pair[0];
    const server = pair[1];

    // Terima WebSocket pada Durable Object
    this.ctx.acceptWebSocket(server);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }


  /*
   * =========================================================
   * SEND
   * =========================================================
   */

  send(ws, data) {
    try {
      ws.send(JSON.stringify(data));
    } catch {}
  }


  /*
   * =========================================================
   * BROADCAST
   * =========================================================
   */

  broadcast(data, filter = () => true) {
    const message = JSON.stringify(data);

    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() || {};

      if (!filter(attachment)) {
        continue;
      }

      try {
        ws.send(message);
      } catch {}
    }
  }


  /*
   * =========================================================
   * HISTORY
   * =========================================================
   */

  async getHistory(chatId) {
    return (
      (await this.ctx.storage.get(`history:${chatId}`)) || []
    );
  }


  /*
   * =========================================================
   * GET ALL CHATS
   * =========================================================
   */

  async getChats() {
    const entries = await this.ctx.storage.list({
      prefix: "chat:"
    });

    return new Map(entries);
  }


  /*
   * =========================================================
   * SAVE CHAT
   * =========================================================
   */

  async saveChat(chat) {
    await this.ctx.storage.put(
      `chat:${chat.chatId}`,
      chat
    );

    this.chats.set(chat.chatId, chat);
  }


  /*
   * =========================================================
   * SAVE MESSAGE
   * =========================================================
   *
   * Pesan disimpan SEBELUM broadcast.
   *
   * Jadi kalau owner sedang offline:
   *
   * Visitor → pesan
   *        ↓
   *     DATABASE
   *        ↓
   * owner offline
   *
   * Ketika owner reconnect:
   *
   * DATABASE → owner
   *
   * Pesan tidak hilang.
   */

  async saveMessage(chatId, message) {
    const key = `history:${chatId}`;

    const history = await this.getHistory(chatId);

    history.push(message);

    // Simpan maksimal 2000 pesan terakhir
    const trimmed = history.slice(-2000);

    await this.ctx.storage.put(
      key,
      trimmed
    );
  }


  /*
   * =========================================================
   * OWNER SYNC
   * =========================================================
   *
   * Setiap owner connect / reconnect:
   *
   * 1. Ambil semua chat
   * 2. Ambil history setiap chat
   * 3. Kirim ke owner
   *
   * Jadi owner tidak hanya bergantung pada realtime WebSocket.
   */

  async syncOwner(ws) {
    const storedChats = await this.getChats();

    this.send(ws, {
      type: "sync_start",
      totalChats: storedChats.size
    });

    for (const chat of storedChats.values()) {
      this.chats.set(chat.chatId, chat);

      const history = await this.getHistory(
        chat.chatId
      );

      this.send(ws, {
        type: "chat_sync",
        chatId: chat.chatId,
        name: chat.name,
        online: Boolean(chat.online),
        history
      });
    }

    this.send(ws, {
      type: "sync_end"
    });

    this.send(ws, {
      type: "owner_ready"
    });
  }


  /*
   * =========================================================
   * WEBSOCKET MESSAGE
   * =========================================================
   */

  async webSocketMessage(ws, raw) {
    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const current =
      ws.deserializeAttachment() || {};


    /*
     * =======================================================
     * JOIN
     * =======================================================
     */

    if (data.type === "join") {
      const role =
        data.role === "owner"
          ? "owner"
          : "visitor";


      /*
       * -----------------------------------------------------
       * OWNER LOGIN
       * -----------------------------------------------------
       */

      if (role === "owner") {
        const supplied =
          String(data.ownerKey || "");

        const expected =
          String(this.env.OWNER_KEY || "");


        // OWNER KEY salah
        if (!expected || supplied !== expected) {
          this.send(ws, {
            type: "auth_error",
            message:
              "OWNER_KEY salah atau belum diatur di Cloudflare."
          });

          try {
            ws.close(
              1008,
              "Unauthorized"
            );
          } catch {}

          return;
        }


        // Owner berhasil login
        ws.serializeAttachment({
          role: "owner",
          chatId: "",
          name: "Owner"
        });


        // Kirim seluruh history
        await this.syncOwner(ws);

        return;
      }


      /*
       * -----------------------------------------------------
       * VISITOR JOIN
       * -----------------------------------------------------
       */

      const chatId =
        String(data.chatId || "").trim()
        || crypto.randomUUID();

      const name =
        String(
          data.name || "Pengunjung"
        )
          .trim()
          .slice(0, 40)
        || "Pengunjung";


      // Coba ambil chat lama
      const old =
        this.chats.get(chatId)
        || await this.ctx.storage.get(
          `chat:${chatId}`
        );


      const chat = {
        chatId,

        name:
          name
          || old?.name
          || "Pengunjung",

        online: true,

        updated: Date.now()
      };


      // Simpan chat
      await this.saveChat(chat);


      // Simpan identitas WebSocket
      ws.serializeAttachment({
        role: "visitor",
        chatId,
        name
      });


      // Ambil history
      const history =
        await this.getHistory(chatId);


      // Kirim history ke visitor
      this.send(ws, {
        type: "joined",
        chatId,
        name,
        history
      });


      /*
       * Beritahu owner bahwa visitor masuk
       */

      this.broadcast(
        {
          type:
            old
              ? "chat_status"
              : "chat_new",

          ...chat
        },

        attachment =>
          attachment.role === "owner"
      );

      return;
    }


    /*
     * =======================================================
     * VISITOR → OWNER
     * =======================================================
     */

    if (
      current.role === "visitor"
      && data.type === "message"
    ) {
      const text =
        String(data.text || "")
          .trim()
          .slice(0, 2000);


      if (!text || !current.chatId) {
        return;
      }


      const message = {
        id: crypto.randomUUID(),

        chatId: current.chatId,

        sender: "visitor",

        name:
          current.name
          || "Pengunjung",

        text,

        time:
          new Date().toISOString()
      };


      /*
       * Update chat
       */

      const old =
        this.chats.get(
          current.chatId
        ) || {};


      await this.saveChat({
        ...old,

        chatId:
          current.chatId,

        name:
          current.name
          || old.name
          || "Pengunjung",

        online: true,

        updated: Date.now()
      });


      /*
       * PENTING:
       *
       * Simpan dahulu.
       *
       * Baru broadcast.
       */

      await this.saveMessage(
        current.chatId,
        message
      );


      /*
       * Kirim ke:
       *
       * - Owner
       * - Visitor yang sama
       */

      this.broadcast(
        {
          type: "message",
          ...message
        },

        attachment =>
          attachment.role === "owner"
          ||
          (
            attachment.role === "visitor"
            &&
            attachment.chatId ===
              current.chatId
          )
      );

      return;
    }


    /*
     * =======================================================
     * OWNER → VISITOR
     * =======================================================
     *
     * Balasan owner akan:
     *
     * 1. Disimpan
     * 2. Dikirim ke owner
     * 3. Dikirim ke visitor
     *
     * public/app.js dapat mendeteksi:
     *
     * sender === "owner"
     *
     * lalu menampilkan notifikasi.
     */

    if (
      current.role === "owner"
      && data.type === "message"
    ) {
      const chatId =
        String(data.chatId || "").trim();

      const text =
        String(data.text || "")
          .trim()
          .slice(0, 2000);


      if (!chatId || !text) {
        return;
      }


      const message = {
        id: crypto.randomUUID(),

        chatId,

        sender: "owner",

        name: "Owner",

        text,

        time:
          new Date().toISOString()
      };


      /*
       * Simpan dahulu agar tidak hilang
       */

      await this.saveMessage(
        chatId,
        message
      );


      /*
       * Broadcast:
       *
       * - owner
       * - visitor dengan chatId yang sama
       */

      this.broadcast(
        {
          type: "message",
          ...message
        },

        attachment =>
          attachment.role === "owner"
          ||
          (
            attachment.role === "visitor"
            &&
            attachment.chatId === chatId
          )
      );

      return;
    }
  }


  /*
   * =========================================================
   * VISITOR DISCONNECT
   * =========================================================
   */

  webSocketClose(ws) {
    const attachment =
      ws.deserializeAttachment()
      || {};


    if (
      attachment.role === "visitor"
      &&
      attachment.chatId
    ) {
      const chat =
        this.chats.get(
          attachment.chatId
        );


      if (chat) {
        const updated = {
          ...chat,

          online: false,

          updated: Date.now()
        };


        this.chats.set(
          attachment.chatId,
          updated
        );


        // Simpan status offline
        this.ctx.storage.put(
          `chat:${attachment.chatId}`,
          updated
        );


        // Beritahu owner
        this.broadcast(
          {
            type: "chat_status",

            chatId:
              attachment.chatId,

            name:
              attachment.name,

            online: false
          },

          item =>
            item.role === "owner"
        );
      }
    }
  }


  /*
   * =========================================================
   * WEBSOCKET ERROR
   * =========================================================
   */

  webSocketError(ws) {
    this.webSocketClose(ws);
  }
}
