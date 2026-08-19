import WebSocket from "ws";
import readline from "node:readline";

const SERVER = process.env.SERVER;
const OWNER_KEY = process.env.OWNER_KEY;

if (!SERVER || !OWNER_KEY) {
  console.error(
    "Gunakan: SERVER='https://webchat.xxx.workers.dev' OWNER_KEY='rahasia' node owner.js"
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

function connect() {
  const base = SERVER.replace(/\/$/, "");
  const u = new URL("/ws", base.replace(/^http/, "ws"));

  ws = new WebSocket(u);

  ws.on("open", () => {
    console.log("Terhubung ke Cloudflare.");
    ws.send(JSON.stringify({
      type: "join",
      role: "owner",
      ownerKey: OWNER_KEY
    }));
  });

  ws.on("message", raw => {
    let d;
    try { d = JSON.parse(raw); } catch { return; }

    if (d.type === "owner_ready") {
      console.log("Owner siap. Menunggu chat...");
      rl.prompt();
      return;
    }

    if (d.type === "auth_error") {
      console.error("LOGIN OWNER GAGAL:", d.message);
      process.exit(1);
    }

    if (d.type === "chat_available") {
      chats.set(d.chatId, d);
      console.log(
        `\n[CHAT ${d.chatId}] ${d.online ? "🟢" : "🔴"} ${d.name}`
      );
      rl.prompt();
      return;
    }

    if (d.type === "chat_status") {
      const old = chats.get(d.chatId) || {};
      chats.set(d.chatId, { ...old, ...d });
      console.log(
        `\n[STATUS] ${d.name || d.chatId}: ${d.online ? "ONLINE" : "OFFLINE"}`
      );
      rl.prompt();
      return;
    }

    if (d.type === "message") {
      const marker = d.sender === "visitor" ? "PENGUNJUNG" : "OWNER";
      const chat = chats.get(d.chatId) || {};
      chats.set(d.chatId, {
        ...chat,
        chatId: d.chatId,
        name: d.name || chat.name || "Pengunjung",
        online: true
      });

      console.log(
        `\n[${d.chatId}] ${d.name || "Pengunjung"} [${marker}] ${d.text}`
      );

      if (d.sender === "visitor") active = d.chatId;
      rl.prompt();
    }
  });

  ws.on("close", () => {
    console.log("\nKoneksi terputus. Reconnect dalam 3 detik...");
    setTimeout(connect, 3000);
  });

  ws.on("error", e => {
    console.log("\nWS:", e.message);
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

function list() {
  console.log("\nDaftar chat:");

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
          WEBCHAT OWNER
======================================
Perintah:
  list
  use <ID>
  reply <pesan>
  /reply <ID> <pesan>
  exit
`);

connect();

rl.on("line", line => {
  const x = line.trim();

  if (!x) {
    rl.prompt();
    return;
  }

  if (x === "list") {
    list();
  } else if (x.startsWith("use ")) {
    active = x.slice(4).trim();
    console.log("Chat aktif:", active);
  } else if (x.startsWith("reply ")) {
    if (!active) {
      console.log("Pilih chat dahulu: use <ID>");
    } else {
      send(active, x.slice(6));
    }
  } else if (x.startsWith("/reply ")) {
    const parts = x.slice(7).trim().split(" ");
    const id = parts.shift();
    send(id, parts.join(" "));
  } else if (x === "exit") {
    process.exit(0);
  } else {
    console.log("Perintah: list | use <ID> | reply <pesan> | /reply <ID> <pesan> | exit");
  }

  rl.prompt();
});
