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
let reconnectTimer = null;
let joined = false;
let visitorName = localStorage.getItem("webchat_name") || "";
let chatId = localStorage.getItem("webchat_chat_id") || "";

if (visitorName) nameEl.value = visitorName;

function setStatus(text) {
  statusEl.textContent = text;
}

function wsUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  setStatus("Menghubungkan...");

  ws = new WebSocket(wsUrl());

  ws.addEventListener("open", () => {
    setStatus("Terhubung");

    if (visitorName) {
      sendJoin();
    }
  });

  ws.addEventListener("message", event => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === "joined") {
      joined = true;
      chatId = data.chatId;
      visitorName = data.name;
      localStorage.setItem("webchat_chat_id", chatId);
      localStorage.setItem("webchat_name", visitorName);

      welcomeEl.classList.add("hidden");
      chatEl.classList.remove("hidden");

      renderHistory(data.history || []);
      inputEl.focus();
      return;
    }

    if (data.type === "message") {
      // Pesan milik kita sudah ditampilkan secara lokal.
      // Jika pesan yang sama datang dari server, jangan tampilkan dua kali.
      if (data.sender === "visitor" && data.chatId === chatId && data.name === visitorName) {
        const pending = document.querySelector(`[data-client-text="${CSS.escape(data.text)}"]`);
        if (pending) {
          pending.removeAttribute("data-client-text");
          pending.dataset.serverId = data.id || "";
          return;
        }
      }

      addMessage(data, false);
      return;
    }

    if (data.type === "error") {
      setStatus(data.message || "Error");
      return;
    }
  });

  ws.addEventListener("close", () => {
    setStatus("Offline — mencoba kembali...");
    joined = false;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2500);
  });

  ws.addEventListener("error", () => {
    setStatus("Koneksi error");
  });
}

function sendJoin() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !visitorName) return;

  ws.send(JSON.stringify({
    type: "join",
    role: "visitor",
    chatId,
    name: visitorName
  }));
}

function addMessage(message, local = false) {
  const box = document.createElement("div");
  box.className = `msg ${message.sender === "visitor" ? "mine" : "theirs"}`;

  if (local) {
    box.dataset.clientText = message.text;
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = message.sender === "visitor"
    ? "Kamu"
    : "Owner";

  const text = document.createElement("div");
  text.textContent = message.text;

  box.append(meta, text);
  messagesEl.appendChild(box);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderHistory(history) {
  messagesEl.innerHTML = "";
  for (const message of history) {
    addMessage(message, false);
  }
}

joinEl.addEventListener("click", () => {
  const name = nameEl.value.trim();
  if (!name) {
    nameEl.focus();
    return;
  }

  visitorName = name;
  localStorage.setItem("webchat_name", visitorName);

  if (ws && ws.readyState === WebSocket.OPEN) {
    sendJoin();
  } else {
    connect();
  }
});

nameEl.addEventListener("keydown", event => {
  if (event.key === "Enter") joinEl.click();
});

formEl.addEventListener("submit", event => {
  event.preventDefault();

  const text = inputEl.value.trim();
  if (!text || !joined) return;

  const message = {
    chatId,
    sender: "visitor",
    name: visitorName,
    text
  };

  // Tampilkan langsung di website.
  addMessage(message, true);
  inputEl.value = "";
  inputEl.focus();

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setStatus("Offline — pesan belum terkirim");
    return;
  }

  ws.send(JSON.stringify({
    type: "message",
    text
  }));
});

connect();
