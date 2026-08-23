import WebSocket from "ws";
import readline from "node:readline";

const SERVER = process.env.SERVER;
const KEY = process.env.OWNER_KEY;

if (!SERVER || !KEY) {
  console.error("SERVER='https://YOUR-WORKER.workers.dev' OWNER_KEY='RAHASIA' node owner.js");
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "owner> " });
let ws = null;
let active = null;
let stop = false;
let retryTimer = null;
const chats = new Map();
const seen = new Set();

function messageKey(m) {
  if (m?.id) return m.id;
  // Backward compatibility for messages created by the old server version.
  return [m?.chatId, m?.sender, m?.time, m?.text].join("|");
}

function showMessage(d) {
  const key = messageKey(d);
  if (seen.has(key)) return;
  seen.add(key);
  // Prevent unlimited memory use in a long-running Termux process.
  if (seen.size > 10000) {
    const first = seen.values().next().value;
    seen.delete(first);
  }

  const c = chats.get(d.chatId) || {};
  chats.set(d.chatId, { ...c, name: d.name || c.name, online: true });
  console.log(`\n[${d.chatId}] ${d.name || c.name || "Pengunjung"} [${d.sender === "owner" ? "OWNER" : "PENGUNJUNG"}] ${d.text}`);
  if (d.sender === "visitor") active = d.chatId;
  rl.prompt();
}

function syncHistory(d) {
  const old = chats.get(d.chatId) || {};
  chats.set(d.chatId, {
    ...old,
    name: d.name || old.name || "Pengunjung",
    online: Boolean(d.online)
  });

  if (Array.isArray(d.history)) {
    for (const m of d.history) showMessage(m);
  }
}

function connect() {
  if (stop || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  const base = SERVER.replace(/\/$/, "");
  const url = new URL("/ws", base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  console.log("Menghubungkan ke server...");
  ws = new WebSocket(url);

  ws.on("open", () => {
    ws.send(JSON.stringify({ type: "join", role: "owner", ownerKey: KEY }));
  });

  ws.on("message", raw => {
    let d;
    try { d = JSON.parse(raw); } catch { return; }

    if (d.type === "sync_start") {
      console.log(`\nSinkronisasi pesan dimulai (${d.totalChats || 0} chat)...`);
    } else if (d.type === "chat_sync") {
      syncHistory(d);
    } else if (d.type === "sync_end") {
      console.log("Sinkronisasi selesai. Tidak ada pesan tersimpan yang dilewati.");
    } else if (d.type === "owner_ready") {
      console.log("Owner siap. Menunggu chat realtime...");
      rl.prompt();
    } else if (d.type === "auth_error") {
      console.error("LOGIN OWNER GAGAL:", d.message);
      stop = true;
      process.exit(1);
    } else if (d.type === "chat_available" || d.type === "chat_new") {
      const c = chats.get(d.chatId) || {};
      chats.set(d.chatId, { ...c, name: d.name || c.name, online: d.online });
      console.log(`\n[CHAT ${d.chatId}] ${d.online ? "ONLINE" : "OFFLINE"} ${d.name || "Pengunjung"}`);
      if (d.type === "chat_new") console.log("Gunakan: use " + d.chatId);
      rl.prompt();
    } else if (d.type === "chat_status") {
      const c = chats.get(d.chatId) || {};
      chats.set(d.chatId, { ...c, name: d.name || c.name, online: d.online });
      console.log(`\n[STATUS] ${d.name || c.name || "Pengunjung"}: ${d.online ? "ONLINE" : "OFFLINE"}`);
      rl.prompt();
    } else if (d.type === "message") {
      showMessage(d);
    }
  });

  ws.on("close", () => {
    if (stop) return;
    console.log("\nKoneksi terputus. Pesan tetap aman di server. Reconnect 3 detik...");
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, 3000);
  });

  ws.on("error", e => console.log("WS:", e.message));
}

function send(id, text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log("Belum terhubung. Balasan tidak dikirim.");
    return;
  }
  ws.send(JSON.stringify({ type: "message", chatId: id, text }));
}

function list() {
  console.log("\nDaftar chat:");
  for (const [id, c] of chats) console.log(`${id} | ${c.online ? "ONLINE" : "OFFLINE"} | ${c.name || "Pengunjung"}`);
  if (!chats.size) console.log("(belum ada pengunjung)");
}

console.log("WEBCHAT OWNER v7 - ANTI PESAN TERLEWAT + NOTIFIKASI");
console.log("Perintah: list | use <ID> | reply <pesan> | /reply <ID> <pesan> | exit");
connect();

rl.on("line", line => {
  const x = line.trim();
  if (x === "list") list();
  else if (x.startsWith("use ")) {
    active = x.slice(4).trim();
    console.log("Chat aktif:", active);
  } else if (x.startsWith("reply ")) {
    active ? send(active, x.slice(6).trim()) : console.log("Pilih chat: use <ID>");
  } else if (x.startsWith("/reply ")) {
    const p = x.slice(7).trim().split(/\s+/);
    const id = p.shift();
    send(id, p.join(" "));
  } else if (x === "exit") {
    stop = true;
    clearTimeout(retryTimer);
    ws?.close();
    process.exit(0);
  } else {
    console.log("Perintah tidak dikenal.");
  }
  rl.prompt();
});
