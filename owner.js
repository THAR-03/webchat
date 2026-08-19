import WebSocket from "ws";
import readline from "node:readline";

const SERVER = process.env.SERVER;
const OWNER_KEY = process.env.OWNER_KEY;

if (!SERVER || !OWNER_KEY) {
  console.error("Gunakan: SERVER='https://...workers.dev' OWNER_KEY='rahasia' node owner.js");
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
  const base = SERVER.replace(/^http/, "ws");
  const url = new URL("/ws", base);

  ws = new WebSocket(url);

  ws.on("open", () => {
    console.log("Terhubung ke Cloudflare.");
    ws.send(JSON.stringify({
      type: "join",
      role: "owner",
      ownerKey: OWNER_KEY
    }));
  });

  ws.on("message", raw => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === "owner_ready") {
      console.log("Owner siap.");
      console.log("Perintah: list | use <ID> | history <ID> | reply <pesan> | /reply <ID> <pesan> | exit");
      rl.prompt();
      return;
    }

    if (data.type === "auth_error") {
      console.error("LOGIN OWNER GAGAL:", data.message);
      process.exit(1);
    }

    if (data.type === "chat_available") {
      chats.set(data.chatId, {
        name: data.name || "Pengunjung",
        online: !!data.online
      });
      console.log(`\n[CHAT ${data.chatId}] ${data.online ? "🟢" : "🔴"} ${data.name || "Pengunjung"}`);
      rl.prompt();
      return;
    }

    if (data.type === "chat_status") {
      const old = chats.get(data.chatId) || {};
      chats.set(data.chatId, {
        ...old,
        name: data.name || old.name || "Pengunjung",
        online: !!data.online
      });
      console.log(`\n[STATUS] ${data.chatId}: ${data.online ? "ONLINE" : "OFFLINE"}`);
      rl.prompt();
      return;
    }

    if (data.type === "chat_list") {
      chats.clear();
      for (const c of data.chats || []) {
        chats.set(c.chatId, c);
      }
      list();
      rl.prompt();
      return;
    }

    if (data.type === "history") {
      console.log(`\n--- RIWAYAT ${data.chatId} ---`);
      for (const m of data.history || []) {
        console.log(`[${m.name}] [${m.sender === "visitor" ? "PENGUNJUNG" : "OWNER"}] ${m.text}`);
      }
      console.log("--- AKHIR RIWAYAT ---");
      rl.prompt();
      return;
    }

    if (data.type === "message") {
      const name = data.name || chats.get(data.chatId)?.name || "Pengunjung";

      chats.set(data.chatId, {
        ...(chats.get(data.chatId) || {}),
        name,
        online: data.sender === "visitor" ? true : (chats.get(data.chatId)?.online ?? true)
      });

      console.log(`\n[${data.chatId}] ${name} [${data.sender === "visitor" ? "PENGUNJUNG" : "OWNER"}] ${data.text}`);
      active = data.chatId;
      rl.prompt();
      return;
    }
  });

  ws.on("close", () => {
    console.log("\nKoneksi terputus. Reconnect 3 detik...");
    setTimeout(connect, 3000);
  });

  ws.on("error", error => {
    console.log("\nWS:", error.message);
  });
}

function list() {
  console.log("\nDaftar chat:");
  if (!chats.size) {
    console.log("(belum ada chat)");
    return;
  }

  for (const [id, chat] of chats) {
    console.log(`${id} | ${chat.online ? "🟢" : "🔴"} | ${chat.name || "Pengunjung"}`);
  }
}

function send(chatId, text) {
  if (!chatId || !text) return;

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

console.log("======================================");
console.log("       WEBCHAT OWNER v5");
console.log("======================================");

connect();

rl.on("line", line => {
  const x = line.trim();

  if (!x) {
    rl.prompt();
    return;
  }

  if (x === "list") {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "list" }));
    }
    return;
  }

  if (x.startsWith("use ")) {
    active = x.slice(4).trim();
    console.log("Chat aktif:", active);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "history",
        chatId: active
      }));
    }
    return;
  }

  if (x.startsWith("history ")) {
    const id = x.slice(8).trim();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "history",
        chatId: id
      }));
    }
    return;
  }

  if (x.startsWith("reply ")) {
    if (!active) {
      console.log("Pilih chat dahulu: use <ID>");
    } else {
      send(active, x.slice(6).trim());
    }
    return;
  }

  if (x.startsWith("/reply ")) {
    const parts = x.slice(7).trim().split(/\s+/);
    const id = parts.shift();
    send(id, parts.join(" "));
    return;
  }

  if (x === "exit") {
    process.exit(0);
  }

  console.log("Perintah: list | use <ID> | history <ID> | reply <pesan> | /reply <ID> <pesan> | exit");
  rl.prompt();
});
