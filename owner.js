import WebSocket from "ws";
import readline from "node:readline";

const SERVER = process.env.SERVER;
const OWNER_KEY = process.env.OWNER_KEY;

if (!SERVER || !OWNER_KEY) {
  console.error(
    "Gunakan: SERVER='https://DOMAIN.workers.dev' OWNER_KEY='rahasia' node owner.js"
  );
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "owner> "
});

let ws = null;
let active = null;
const chats = new Map();

function printPrompt() {
  rl.prompt();
}

function connect() {
  const base = SERVER.replace(/^http/, "ws");
  const url = new URL("/ws", base);

  ws = new WebSocket(url);

  ws.on("open", () => {
    ws.send(JSON.stringify({
      type: "join",
      role: "owner",
      ownerKey: OWNER_KEY
    }));

    console.log("Terhubung ke Cloudflare.");
  });

  ws.on("message", raw => {
    let d;
    try { d = JSON.parse(raw); } catch { return; }

    if (d.type === "owner_ready") {
      console.log("Owner siap. Chat tersimpan akan tetap tersedia.");
      printPrompt();
      return;
    }

    if (d.type === "auth_error") {
      console.error("LOGIN OWNER GAGAL:", d.message);
      process.exit(1);
    }

    if (d.type === "chat_available" || d.type === "chat_new") {
      chats.set(d.chatId, {
        name: d.name,
        online: d.online,
        updated: d.updated
      });

      console.log(
        `\n[CHAT ${d.chatId}] ${d.online ? "🟢" : "🔴"} ${d.name}`
      );

      if (d.type === "chat_new") {
        console.log("Gunakan: use " + d.chatId);
      }

      printPrompt();
      return;
    }

    if (d.type === "chat_status") {
      const old = chats.get(d.chatId) || {};

      chats.set(d.chatId, {
        ...old,
        name: d.name || old.name,
        online: d.online
      });

      console.log(
        `\n[STATUS] ${d.name || old.name || d.chatId}: ${
          d.online ? "ONLINE" : "OFFLINE"
        }`
      );

      printPrompt();
      return;
    }

    if (d.type === "message") {
      const marker = d.sender === "visitor" ? "PENGUNJUNG" : "OWNER";
      const name =
        d.name ||
        chats.get(d.chatId)?.name ||
        d.chatId;

      chats.set(d.chatId, {
        ...(chats.get(d.chatId) || {}),
        name,
        online: d.sender === "visitor"
          ? true
          : (chats.get(d.chatId)?.online ?? false)
      });

      console.log(
        `\n[${d.chatId}] ${name} [${marker}] ${d.text}`
      );

      if (d.sender === "visitor") {
        active = d.chatId;
      }

      printPrompt();
      return;
    }
  });

  ws.on("close", () => {
    console.log("\nKoneksi terputus. Mencoba reconnect...");
    setTimeout(connect, 3000);
  });

  ws.on("error", err => {
    console.log("\nWS:", err.message);
  });
}

function send(chatId, text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log("Belum terhubung.");
    return;
  }

  ws.send(JSON.stringify({
    type: "message",
    chatId,
    text
  }));
}

function requestHistory(chatId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log("Belum terhubung.");
    return;
  }

  ws.send(JSON.stringify({
    type: "history",
    chatId
  }));

  console.log("Meminta riwayat chat:", chatId);
}

function list() {
  console.log("\nDaftar chat tersimpan:");

  if (!chats.size) {
    console.log("(belum ada chat)");
    return;
  }

  for (const [id, c] of chats) {
    console.log(
      `${id} | ${c.online ? "🟢" : "🔴"} | ${c.name || "Pengunjung"}`
    );
  }
}

console.log(`
======================================
       WEBCHAT OWNER v4
======================================
Perintah:
  list
  use <ID>
  history <ID>
  reply <pesan>
  /reply <ID> <pesan>
  exit
`);

connect();

rl.on("line", line => {
  const x = line.trim();

  if (!x) {
    printPrompt();
    return;
  }

  if (x === "list") {
    list();
  } else if (x.startsWith("use ")) {
    active = x.slice(4).trim();
    console.log("Chat aktif:", active);
    requestHistory(active);
  } else if (x.startsWith("history ")) {
    requestHistory(x.slice(8).trim());
  } else if (x.startsWith("reply ")) {
    if (!active) {
      console.log("Pilih chat dulu: use <ID>");
    } else {
      send(active, x.slice(6));
    }
  } else if (x.startsWith("/reply ")) {
    const p = x.slice(7).trim().split(" ");
    const id = p.shift();
    send(id, p.join(" "));
  } else if (x === "exit") {
    process.exit(0);
  } else {
    console.log(
      "Perintah: list | use <ID> | history <ID> | reply <pesan> | /reply <ID> <pesan> | exit"
    );
  }

  printPrompt();
});