const messages = document.querySelector("#messages");
const form = document.querySelector("#form");
const input = document.querySelector("#text");
const statusEl = document.querySelector("#status");
const visitorIdEl = document.querySelector("#visitorId");

const STORAGE_KEY = "webchat_visitor_id";
const NAME_KEY = "webchat_visitor_name";

let visitorId = localStorage.getItem(STORAGE_KEY);
if (!visitorId) {
  visitorId = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, visitorId);
}

const name =
  localStorage.getItem(NAME_KEY) ||
  `Pengunjung-${visitorId.slice(0, 6)}`;

localStorage.setItem(NAME_KEY, name);
visitorIdEl.textContent = visitorId;

let ws;
let reconnectTimer;

function addMessage(data) {
  const div = document.createElement("div");
  div.className = `msg ${data.sender === "owner" ? "owner" : "visitor"}`;

  const label = document.createElement("strong");
  label.textContent = data.sender === "owner" ? "Owner" : name;

  const body = document.createElement("div");
  body.textContent = data.text;

  div.append(label, body);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function connect() {
  clearTimeout(reconnectTimer);

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(
    `${protocol}//${location.host}/ws?chat=${encodeURIComponent(visitorId)}`
  );

  ws.onopen = () => {
    statusEl.textContent = "Online";
    ws.send(JSON.stringify({
      type: "join",
      role: "visitor",
      chatId: visitorId,
      name
    }));
  };

  ws.onmessage = event => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }

    if (data.type === "joined") {
      visitorId = data.chatId;
      localStorage.setItem(STORAGE_KEY, visitorId);
      visitorIdEl.textContent = visitorId;
      return;
    }

    if (data.type === "message") {
      addMessage(data);
    }
  };

  ws.onclose = () => {
    statusEl.textContent = "Terputus — mencoba kembali...";
    reconnectTimer = setTimeout(connect, 2500);
  };

  ws.onerror = () => ws.close();
}

form.addEventListener("submit", event => {
  event.preventDefault();

  const text = input.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({
    type: "message",
    chatId: visitorId,
    text
  }));

  input.value = "";
  input.focus();
});

connect();


// UI adapter for the Linux terminal theme.
(() => {
  const list = document.getElementById("messageList");
  const input = document.getElementById("messageInput");
  const form = document.getElementById("chatForm");
  const status = document.getElementById("connectionStatus");
  const oldMessages = document.getElementById("messages");

  if (!list || !input || !form) return;

  // If the original client exposes a global appendMessage, wrap it.
  if (typeof window.appendMessage === "function") {
    const original = window.appendMessage;
    window.appendMessage = (...args) => {
      const before = list.children.length;
      const result = original(...args);
      if (list.children.length === before) {
        const [text, sender] = args;
        const el = document.createElement("div");
        el.className = "message " + (sender === "owner" ? "owner" : "visitor");
        el.textContent = String(text ?? "");
        list.appendChild(el);
      }
      oldMessages.scrollTop = oldMessages.scrollHeight;
      return result;
    };
  }

  form.addEventListener("submit", (e) => {
    // Original app.js should already own the send logic.
    // This listener only prevents accidental native navigation.
    e.preventDefault();
  });

  if (status) {
    const update = () => {
      const online = navigator.onLine;
      status.textContent = online ? "online" : "offline";
      status.classList.toggle("online", online);
    };
    addEventListener("online", update);
    addEventListener("offline", update);
    update();
  }
})();
