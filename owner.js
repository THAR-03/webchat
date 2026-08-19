import WebSocket from "ws";
import readline from "node:readline";

const SERVER =
  process.env.SERVER;

const OWNER_KEY =
  process.env.OWNER_KEY;

if (!SERVER || !OWNER_KEY) {
  console.error(
    "Gunakan:"
  );

  console.error(
    "SERVER='https://webchat-anda.workers.dev' OWNER_KEY='rahasia' node owner.js"
  );

  process.exit(1);
}

const rl =
  readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "owner> "
  });

let ws = null;
let active = null;

const chats =
  new Map();

const receivedMessages =
  new Set();

/*
 * =========================
 * CONNECT
 * =========================
 */

function connect() {
  const url =
    new URL(
      "/ws",
      SERVER.replace(/^http/, "ws")
    );

  ws =
    new WebSocket(url);

  ws.on("open", () => {
    console.log(
      "Terhubung ke Cloudflare."
    );

    ws.send(
      JSON.stringify({
        type: "join",
        role: "owner",
        ownerKey: OWNER_KEY
      })
    );
  });

  ws.on(
    "message",
    raw => {
      let data;

      try {
        data =
          JSON.parse(raw);
      } catch {
        return;
      }

      /*
       * LOGIN
       */

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

      /*
       * OWNER READY
       */

      if (
        data.type ===
        "owner_ready"
      ) {
        console.log(
          "Owner siap."
        );

        console.log(
          "Menunggu pengunjung..."
        );

        rl.prompt();

        return;
      }

      /*
       * CHAT BARU
       */

      if (
        data.type ===
        "chat_new"
      ) {
        chats.set(
          data.chatId,
          {
            name: data.name,
            online: data.online
          }
        );

        console.log(
          `\n[CHAT BARU] ${data.chatId} | ${data.name} | ${data.online ? "🟢 ONLINE" : "🔴 OFFLINE"}`
        );

        console.log(
          `Gunakan: use ${data.chatId}`
        );

        rl.prompt();

        return;
      }

      /*
       * CHAT YANG SUDAH ADA
       */

      if (
        data.type ===
        "chat_available"
      ) {
        chats.set(
          data.chatId,
          {
            name: data.name,
            online: data.online
          }
        );

        return;
      }

      /*
       * STATUS
       */

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
              old.name,
            online:
              data.online
          }
        );

        console.log(
          `\n[STATUS] ${data.chatId} | ${data.online ? "🟢 ONLINE" : "🔴 OFFLINE"}`
        );

        rl.prompt();

        return;
      }

      /*
       * MESSAGE
       */

      if (
        data.type ===
        "message"
      ) {
        /*
         * Jangan tampilkan pesan
         * yang sama dua kali.
         */

        if (
          data.messageId &&
          receivedMessages.has(
            data.messageId
          )
        ) {
          return;
        }

        if (data.messageId) {
          receivedMessages.add(
            data.messageId
          );
        }

        const name =
          data.name ||
          chats.get(
            data.chatId
          )?.name ||
          "Pengunjung";

        if (
          data.sender ===
          "visitor"
        ) {
          active =
            data.chatId;
        }

        chats.set(
          data.chatId,
          {
            ...(chats.get(
              data.chatId
            ) || {}),
            name,
            online: true
          }
        );

        const sender =
          data.sender ===
          "visitor"
            ? "PENGUNJUNG"
            : "OWNER";

        console.log(
          `\n[${data.chatId}] ${name} [${sender}] ${data.text}`
        );

        rl.prompt();

        return;
      }

      if (
        data.type ===
        "error"
      ) {
        console.error(
          "\nERROR:",
          data.message
        );

        rl.prompt();
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
    error => {
      console.log(
        "\nWS:",
        error.message
      );
    }
  );
}

/*
 * =========================
 * SEND
 * =========================
 */

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
      "Belum terhubung."
    );

    return;
  }

  ws.send(
    JSON.stringify({
      type: "message",
      chatId,
      text
    })
  );
}

/*
 * =========================
 * LIST
 * =========================
 */

function list() {
  console.log(
    "\n===== DAFTAR PENGUNJUNG ====="
  );

  if (!chats.size) {
    console.log(
      "(belum ada pengunjung)"
    );

    return;
  }

  for (
    const [id, chat] of chats
  ) {
    console.log(
      `${id} | ${chat.online ? "🟢 ONLINE" : "🔴 OFFLINE"} | ${chat.name || "Pengunjung"}`
    );
  }
}

/*
 * =========================
 * HELP
 * =========================
 */

function help() {
  console.log(`
Perintah:

list
  Menampilkan semua pengunjung.

use <ID>
  Memilih chat.

reply <pesan>
  Membalas chat aktif.

 /reply <ID> <pesan>
  Membalas pengunjung tertentu.

exit
  Keluar.
`);
}

console.log(`
======================================
          WEBCHAT OWNER v4
======================================
`);

help();

connect();

/*
 * =========================
 * COMMAND LINE
 * =========================
 */

rl.on(
  "line",
  line => {
    const input =
      line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (
      input === "list"
    ) {
      list();
    }

    else if (
      input === "help"
    ) {
      help();
    }

    else if (
      input.startsWith(
        "use "
      )
    ) {
      const id =
        input
          .slice(4)
          .trim();

      if (!chats.has(id)) {
        console.log(
          "ID pengunjung belum dikenal."
        );
      } else {
        active = id;

        console.log(
          "Chat aktif:",
          active
        );
      }
    }

    else if (
      input.startsWith(
        "reply "
      )
    ) {
      if (!active) {
        console.log(
          "Pilih chat terlebih dahulu:"
        );

        console.log(
          "use <ID>"
        );
      } else {
        send(
          active,
          input.slice(6)
        );
      }
    }

    else if (
      input.startsWith(
        "/reply "
      )
    ) {
      const content =
        input.slice(7).trim();

      const space =
        content.indexOf(" ");

      if (space === -1) {
        console.log(
          "Format:"
        );

        console.log(
          "/reply <ID> <pesan>"
        );
      } else {
        const id =
          content.slice(
            0,
            space
          );

        const text =
          content.slice(
            space + 1
          );

        send(
          id,
          text
        );
      }
    }

    else if (
      input === "exit"
    ) {
      process.exit(0);
    }

    else {
      console.log(
        "Perintah tidak dikenal. Ketik help."
      );
    }

    rl.prompt();
  }
);
