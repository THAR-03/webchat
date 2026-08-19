const $ = id => document.getElementById(id);

const statusEl = $("status");
const welcomeEl = $("welcome");
const chatEl = $("chat");
const messagesEl = $("messages");
const nameEl = $("name");
const inputEl = $("input");
const joinEl = $("join");
const formEl = $("form");

let ws = null;
let joined = false;
let visitorName = "";
let chatId = "";

function status(text) {
  statusEl.textContent = text;
  console.log("[WEBCHAT]", text);
}

function wsUrl() {
  const protocol =
    location.protocol === "https:" ? "wss:" : "ws:";

  return `${protocol}//${location.host}/ws`;
}

function connect() {
  status("Menghubungkan WebSocket...");

  ws = new WebSocket(wsUrl());

  ws.onopen = () => {
    console.log("[WS] OPEN");
    status("WebSocket terhubung");

    /*
     * Jangan join otomatis.
     * Tunggu tombol Masuk Chat.
     */
  };

  ws.onmessage = event => {
    console.log("[WS] MESSAGE:", event.data);

    let data;

    try {
      data = JSON.parse(event.data);
    } catch {
      status("Server mengirim data tidak valid.");
      return;
    }

    console.log("[SERVER]", data);

    if (data.type === "joined") {
      joined = true;

      chatId = String(data.chatId || "");
      visitorName = String(data.name || visitorName);

      localStorage.setItem(
        "webchat_chat_id",
        chatId
      );

      localStorage.setItem(
        "webchat_name",
        visitorName
      );

      welcomeEl.classList.add("hidden");
      chatEl.classList.remove("hidden");

      messagesEl.innerHTML = "";

      for (const message of data.history || []) {
        addMessage(message);
      }

      status("Online");

      inputEl.focus();

      return;
    }

    if (data.type === "message") {
      addMessage(data);
      return;
    }

    if (data.type === "error") {
      status("ERROR: " + data.message);
      return;
    }

    if (data.type === "test") {
      status("WebSocket hidup, tetapi server masih versi TEST.");
      return;
    }
  };

  ws.onerror = error => {
    console.error("[WS] ERROR:", error);
    status("WebSocket ERROR");
  };

  ws.onclose = event => {
    console.log(
      "[WS] CLOSE:",
      event.code,
      event.reason
    );

    joined = false;

    status(
      `WebSocket terputus (${event.code})`
    );

    /*
     * Coba reconnect.
     */
    setTimeout(() => {
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        connect();
      }
    }, 3000);
  };
}

function addMessage(message) {
  const box = document.createElement("div");

  box.className =
    message.sender === "visitor"
      ? "msg mine"
      : "msg theirs";

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent =
    message.sender === "visitor"
      ? "Kamu"
      : "Owner";

  const text = document.createElement("div");
  text.className = "text";
  text.textContent = message.text || "";

  box.append(meta, text);

  messagesEl.appendChild(box);

  messagesEl.scrollTop =
    messagesEl.scrollHeight;
}

/*
 * MASUK CHAT
 */
joinEl.addEventListener("click", () => {
  const value = nameEl.value.trim();

  console.log("[JOIN BUTTON]", value);

  if (!value) {
    status("Nama belum diisi.");
    nameEl.focus();
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    status("WebSocket belum terhubung.");

    /*
     * Coba koneksi lagi.
     */
    connect();

    return;
  }

  visitorName = value.slice(0, 40);

  /*
   * Kalau belum punya ID,
   * server akan membuat ID.
   */
  if (!chatId) {
    chatId = "";
  }

  status("Mengirim data nama...");

  ws.send(JSON.stringify({
    type: "join",
    role: "visitor",
    chatId: chatId,
    name: visitorName
  }));
});

nameEl.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    joinEl.click();
  }
});

/*
 * KIRIM PESAN
 */
formEl.addEventListener("submit", event => {
  event.preventDefault();

  const message = inputEl.value.trim();

  if (!message) return;

  if (!joined) {
    status("Belum masuk chat.");
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    status("WebSocket terputus.");
    return;
  }

  ws.send(JSON.stringify({
    type: "message",
    text: message
  }));

  inputEl.value = "";
  inputEl.focus();
});

connect();
