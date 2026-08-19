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
let manuallyJoined = false;

let visitorName =
  localStorage.getItem("webchat_name") || "";

let chatId =
  localStorage.getItem("webchat_chat_id") || "";

if (visitorName) {
  nameEl.value = visitorName;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function wsUrl() {
  const protocol =
    location.protocol === "https:" ? "wss:" : "ws:";

  return `${protocol}//${location.host}/ws`;
}

function connect() {
  if (
    ws &&
    (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  setStatus("Menghubungkan...");

  ws = new WebSocket(wsUrl());

  ws.addEventListener("open", () => {
    setStatus("Terhubung");

    if (manuallyJoined && visitorName) {
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

    /*
     * VISITOR JOIN BERHASIL
     */
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

      renderHistory(data.history || []);

      setStatus("Online");

      inputEl.focus();

      return;
    }

    /*
     * PESAN
     */
    if (data.type === "message") {

      /*
       * Jangan tampilkan pesan visitor dua kali.
       */
      if (
        data.sender === "visitor" &&
        data.chatId === chatId &&
        data.name === visitorName
      ) {
        const pending =
          document.querySelector(
            `[data-client-id="${CSS.escape(
              String(data.id)
            )}"]`
          );

        if (pending) {
          pending.removeAttribute("data-client-id");
          return;
        }
      }

      addMessage(data, false);

      return;
    }

    /*
     * ERROR
     */
    if (data.type === "error") {
      setStatus(
        data.message || "Terjadi kesalahan."
      );

      return;
    }

    /*
     * OWNER AUTH ERROR
     * Tidak seharusnya muncul di visitor.
     */
    if (data.type === "auth_error") {
      setStatus("Server menolak koneksi.");

      return;
    }
  });

  ws.addEventListener("close", () => {
    joined = false;

    setStatus(
      manuallyJoined
        ? "Offline — mencoba kembali..."
        : "Terputus"
    );

    clearTimeout(reconnectTimer);

    if (manuallyJoined) {
      reconnectTimer = setTimeout(
        connect,
        2500
      );
    }
  });

  ws.addEventListener("error", () => {
    setStatus("Koneksi error.");
  });
}

function sendJoin() {
  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN ||
    !visitorName
  ) {
    return;
  }

  ws.send(JSON.stringify({
    type: "join",
    role: "visitor",
    chatId: chatId || "",
    name: visitorName
  }));
}

function addMessage(message, local = false) {
  const box =
    document.createElement("div");

  box.className =
    `msg ${
      message.sender === "visitor"
        ? "mine"
        : "theirs"
    }`;

  /*
   * ID server digunakan supaya
   * pesan lokal tidak muncul dua kali.
   */
  if (local && message.id) {
    box.dataset.clientId =
      String(message.id);
  }

  const meta =
    document.createElement("div");

  meta.className = "meta";

  meta.textContent =
    message.sender === "visitor"
      ? "Kamu"
      : "Owner";

  const text =
    document.createElement("div");

  text.className = "text";

  text.textContent =
    message.text || "";

  box.appendChild(meta);
  box.appendChild(text);

  messagesEl.appendChild(box);

  messagesEl.scrollTop =
    messagesEl.scrollHeight;
}

function renderHistory(history) {
  messagesEl.innerHTML = "";

  for (const message of history) {
    addMessage(message, false);
  }
}

/*
 * TOMBOL MASUK CHAT
 */
joinEl.addEventListener("click", () => {
  const value =
    nameEl.value.trim();

  if (!value) {
    nameEl.focus();
    return;
  }

  visitorName =
    value.slice(0, 40);

  manuallyJoined = true;

  localStorage.setItem(
    "webchat_name",
    visitorName
  );

  if (
    ws &&
    ws.readyState === WebSocket.OPEN
  ) {
    sendJoin();
  } else {
    connect();
  }
});

/*
 * ENTER DI KOLOM NAMA
 */
nameEl.addEventListener(
  "keydown",
  event => {
    if (event.key === "Enter") {
      event.preventDefault();
      joinEl.click();
    }
  }
);

/*
 * KIRIM PESAN
 */
formEl.addEventListener(
  "submit",
  event => {
    event.preventDefault();

    const messageText =
      inputEl.value.trim();

    if (!messageText) {
      return;
    }

    if (!joined) {
      setStatus(
        "Belum masuk chat."
      );
      return;
    }

    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN
    ) {
      setStatus(
        "Koneksi terputus."
      );
      return;
    }

    /*
     * Server yang membuat ID pesan.
     * Jadi jangan membuat ID palsu
     * di browser.
     */
    ws.send(JSON.stringify({
      type: "message",
      text: messageText
    }));

    inputEl.value = "";
    inputEl.focus();
  }
);

/*
 * Jangan otomatis join hanya karena
 * nama tersimpan.
 *
 * Pengunjung tetap bisa melihat
 * halaman nama terlebih dahulu.
 */
connect();
