import WebSocket from "ws";
import readline from "node:readline";

const SERVER =
  process.env.SERVER;

const OWNER_KEY =
  process.env.OWNER_KEY;

if (
  !SERVER ||
  !OWNER_KEY
) {
  console.error(
    "Gunakan:"
  );

  console.error(
    "SERVER='https://...workers.dev' OWNER_KEY='rahasia' node owner.js"
  );

  process.exit(1);
}

const rl =
  readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "owner> ",
  });

let ws = null;
let active = null;

const chats = new Map();

// Mencegah pesan yang sama
// ditampilkan berkali-kali.
const seenMessages =
  new Set();

function makeWSURL() {
  const url =
    new URL(
      "/ws",
      SERVER
    );

  url.protocol =
    url.protocol === "https:"
      ? "wss:"
      : "ws:";

  return url;
}

function connect() {
  console.log(
    "Menghubungkan ke Cloudflare..."
  );

  ws = new WebSocket(
    makeWSURL()
  );

  ws.on(
    "open",
    () => {
      ws.send(
        JSON.stringify({
          type: "join",
          role: "owner",
          ownerKey:
            OWNER_KEY,
        })
      );

      console.log(
        "Terhubung ke Cloudflare."
      );
    }
  );

  ws.on(
    "message",
    (raw) => {
      let data;

      try {
        data =
          JSON.parse(
            raw.toString()
          );
      } catch {
        return;
      }

      // =========================
      // AUTH ERROR
      // =========================

      if (
        data.type ===
        "auth_error"
      ) {
        console.error(
          "LOGIN OWNER GAGAL:",
          data.message
        );

        process.exit(1);
      }

      // =========================
      // OWNER READY
      // =========================

      if (
        data.type ===
        "owner_ready"
      ) {
        console.log(
          "Owner siap."
        );

        console.log(
          "Gunakan 'list' untuk melihat chat."
        );

        rl.prompt();

        return;
      }

      // =========================
      // CHAT AVAILABLE
      // =========================

      if (
        data.type ===
          "chat_available" ||
        data.type ===
          "chat_new"
      ) {
        chats.set(
          data.chatId,
          {
            name:
              data.name ||
              "Pengunjung",
            online:
              Boolean(
                data.online
              ),
            updatedAt:
              data.updatedAt ||
              Date.now(),
          }
        );

        if (
          data.type ===
          "chat_new"
        ) {
          console.log(
            `\n[CHAT BARU] ${data.chatId} | ${data.name}`
          );

          console.log(
            `Gunakan: use ${data.chatId}`
          );
        }

        rl.prompt();

        return;
      }

      // =========================
      // CHAT STATUS
      // =========================

      if (
        data.type ===
        "chat_status"
      ) {
        const old =
          chats.get(
            data.chatId
          ) || {};

        chats.set(
          data.chatId,
          {
            ...old,
            name:
              data.name ||
              old.name ||
              "Pengunjung",
            online:
              Boolean(
                data.online
              ),
            updatedAt:
              data.updatedAt ||
              Date.now(),
          }
        );

        console.log(
          `\n[STATUS] ${
            data.name ||
            old.name ||
            data.chatId
          }: ${
            data.online
              ? "ONLINE"
              : "OFFLINE"
          }`
        );

        rl.prompt();

        return;
      }

      // =========================
      // HISTORY
      // =========================

      if (
        data.type ===
        "history"
      ) {
        console.log(
          `\n========== RIWAYAT ${data.chatId} ==========`
        );

        if (
          !Array.isArray(
            data.messages
          ) ||
          data.messages.length === 0
        ) {
          console.log(
            "(belum ada pesan)"
          );
        } else {
          for (
            const message of
              data.messages
          ) {
            printMessage(
              message,
              false
            );
          }
        }

        console.log(
          "=========================================="
        );

        rl.prompt();

        return;
      }

      // =========================
      // MESSAGE
      // =========================

      if (
        data.type ===
        "message"
      ) {
        printMessage(
          data,
          true
        );

        // Chat otomatis menjadi aktif
        // ketika pengunjung mengirim pesan.
        if (
          data.sender ===
          "visitor"
        ) {
          active =
            data.chatId;
        }

        rl.prompt();

        return;
      }
    }
  );

  ws.on(
    "close",
    () => {
      console.log(
        "\nKoneksi terputus."
      );

      console.log(
        "Mencoba reconnect dalam 3 detik..."
      );

      setTimeout(
        connect,
        3000
      );
    }
  );

  ws.on(
    "error",
    (error) => {
      console.log(
        "\nWS ERROR:",
        error.message
      );
    }
  );
}

function printMessage(
  message,
  deduplicate = true
) {
  const id =
    message.messageId ||
    (
      message.chatId +
      "|" +
      message.sender +
      "|" +
      message.time +
      "|" +
      message.text
    );

  if (
    deduplicate &&
    seenMessages.has(id)
  ) {
    return;
  }

  seenMessages.add(id);

  const marker =
    message.sender ===
    "visitor"
      ? "PENGUNJUNG"
      : "OWNER";

  const name =
    message.name ||
    chats.get(
      message.chatId
    )?.name ||
    message.chatId;

  let time = "";

  if (message.time) {
    time =
      new Date(
        message.time
      ).toLocaleTimeString(
        [],
        {
          hour: "2-digit",
          minute: "2-digit",
        }
      );
  }

  console.log(
    `\n[${message.chatId}] ${name} [${marker}] ${message.text} ${time ? "(" + time + ")" : ""}`
  );
}

function send(
  chatId,
  text
) {
  if (
    !ws ||
    ws.readyState !==
      WebSocket.OPEN
  ) {
    console.log(
      "Belum terhubung ke Cloudflare."
    );

    return;
  }

  if (
    !chatId ||
    !text.trim()
  ) {
    return;
  }

  ws.send(
    JSON.stringify({
      type: "message",
      chatId,
      text:
        text
          .trim()
          .slice(0, 2000),
    })
  );
}

function requestHistory(
  chatId
) {
  if (
    !ws ||
    ws.readyState !==
      WebSocket.OPEN
  ) {
    console.log(
      "Belum terhubung."
    );

    return;
  }

  ws.send(
    JSON.stringify({
      type: "history",
      chatId,
    })
  );
}

function list() {
  console.log(
    "\n========== DAFTAR CHAT =========="
  );

  if (!chats.size) {
    console.log(
      "(belum ada chat)"
    );

    console.log(
      "================================="
    );

    return;
  }

  for (
    const [id, chat] of
      chats
  ) {
    console.log(
      `${id} | ${
        chat.online
          ? "🟢 ONLINE"
          : "🔴 OFFLINE"
      } | ${
        chat.name ||
        "Pengunjung"
      }`
    );
  }

  console.log(
    "================================="
  );
}

console.log(
  `
======================================
       WEBCHAT OWNER v3
======================================
Perintah:

list
use <ID>
reply <pesan>
/reply <ID> <pesan>
history
exit
======================================
`
);

connect();

rl.on(
  "line",
  (line) => {
    const x =
      line.trim();

    if (!x) {
      rl.prompt();
      return;
    }

    // LIST
    if (
      x === "list"
    ) {
      list();

      rl.prompt();
      return;
    }

    // USE CHAT
    if (
      x.startsWith(
        "use "
      )
    ) {
      const id =
        x
          .slice(4)
          .trim();

      if (!id) {
        console.log(
          "Contoh: use ID_CHAT"
        );

        rl.prompt();
        return;
      }

      active = id;

      console.log(
        "Chat aktif:",
        active
      );

      // Langsung ambil history.
      requestHistory(
        active
      );

      rl.prompt();
      return;
    }

    // HISTORY
    if (
      x === "history"
    ) {
      if (!active) {
        console.log(
          "Pilih chat dulu: use <ID>"
        );
      } else {
        requestHistory(
          active
        );
      }

      rl.prompt();
      return;
    }

    // REPLY
    if (
      x.startsWith(
        "reply "
      )
    ) {
      if (!active) {
        console.log(
          "Pilih chat dulu: use <ID>"
        );

        rl.prompt();
        return;
      }

      const text =
        x.slice(6).trim();

      if (!text) {
        console.log(
          "Pesan kosong."
        );

        rl.prompt();
        return;
      }

      send(
        active,
        text
      );

      rl.prompt();
      return;
    }

    // /reply ID PESAN
    if (
      x.startsWith(
        "/reply "
      )
    ) {
      const rest =
        x
          .slice(7)
          .trim();

      const space =
        rest.indexOf(" ");

      if (
        space === -1
      ) {
        console.log(
          "Contoh: /reply ID_CHAT Halo"
        );

        rl.prompt();
        return;
      }

      const id =
        rest
          .slice(
            0,
            space
          )
          .trim();

      const text =
        rest
          .slice(
            space + 1
          )
          .trim();

      send(
        id,
        text
      );

      rl.prompt();
      return;
    }

    // EXIT
    if (
      x === "exit"
    ) {
      try {
        ws?.close();
      } catch {}

      process.exit(0);
    }

    console.log(
      "Perintah: list | use <ID> | reply <pesan> | /reply <ID> <pesan> | history | exit"
    );

    rl.prompt();
  }
);
