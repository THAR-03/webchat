(() => {
  "use strict";

  const SERVER =
    window.location.origin;

  const WS_URL =
    window.location.origin
      .replace(/^http/, "ws") +
    "/ws";

  const CHAT_STORAGE =
    "webchat_chat_id";

  const NAME_STORAGE =
    "webchat_name";

  let ws = null;
  let chatId =
    localStorage.getItem(
      CHAT_STORAGE
    ) || "";

  let name =
    localStorage.getItem(
      NAME_STORAGE
    ) || "";

  let connected = false;

  const seenMessages =
    new Set();

  // =========================
  // ELEMENTS
  // =========================

  function createUI() {
    document.body.innerHTML = `
      <div class="webchat">
        <div class="chat-header">
          <div>
            <h2>WebChat</h2>
            <div id="status">
              Menghubungkan...
            </div>
          </div>
        </div>

        <div
          id="messages"
          class="messages"
        ></div>

        <div
          id="nameBox"
          class="name-box"
        >
          <input
            id="nameInput"
            type="text"
            maxlength="40"
            placeholder="Nama Anda"
            autocomplete="name"
          />

          <button id="saveName">
            Mulai Chat
          </button>
        </div>

        <div
          id="composer"
          class="composer"
          style="display:none"
        >
          <input
            id="messageInput"
            type="text"
            maxlength="2000"
            placeholder="Tulis pesan..."
            autocomplete="off"
          />

          <button id="sendButton">
            Kirim
          </button>
        </div>
      </div>
    `;
  }

  createUI();

  const messagesEl =
    document.getElementById(
      "messages"
    );

  const statusEl =
    document.getElementById(
      "status"
    );

  const nameBox =
    document.getElementById(
      "nameBox"
    );

  const nameInput =
    document.getElementById(
      "nameInput"
    );

  const saveName =
    document.getElementById(
      "saveName"
    );

  const composer =
    document.getElementById(
      "composer"
    );

  const messageInput =
    document.getElementById(
      "messageInput"
    );

  const sendButton =
    document.getElementById(
      "sendButton"
    );

  nameInput.value = name;

  // =========================
  // STATUS
  // =========================

  function setStatus(text) {
    statusEl.textContent =
      text;
  }

  // =========================
  // ESCAPE
  // =========================

  function escapeHTML(text) {
    const div =
      document.createElement(
        "div"
      );

    div.textContent = text;

    return div.innerHTML;
  }

  // =========================
  // ADD MESSAGE
  // =========================

  function addMessage(message) {
    if (!message) return;

    const messageId =
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

    // Mencegah pesan muncul dua kali.
    if (
      seenMessages.has(messageId)
    ) {
      return;
    }

    seenMessages.add(messageId);

    const item =
      document.createElement(
        "div"
      );

    item.className =
      "message " +
      (
        message.sender === "owner"
          ? "owner"
          : "visitor"
      );

    const time =
      message.time
        ? new Date(
            message.time
          ).toLocaleTimeString(
            [],
            {
              hour: "2-digit",
              minute: "2-digit",
            }
          )
        : "";

    item.innerHTML = `
      <div class="message-name">
        ${escapeHTML(
          message.name ||
          (
            message.sender ===
            "owner"
              ? "Owner"
              : "Anda"
          )
        )}
      </div>

      <div class="message-text">
        ${escapeHTML(
          message.text || ""
        )}
      </div>

      <div class="message-time">
        ${escapeHTML(time)}
      </div>
    `;

    messagesEl.appendChild(item);

    messagesEl.scrollTop =
      messagesEl.scrollHeight;
  }

  // =========================
  // HISTORY
  // =========================

  function loadHistory(messages) {
    if (!Array.isArray(messages)) {
      return;
    }

    for (const message of messages) {
      addMessage(message);
    }

    messagesEl.scrollTop =
      messagesEl.scrollHeight;
  }

  // =========================
  // CONNECT
  // =========================

  function connect() {
    setStatus(
      "Menghubungkan..."
    );

    try {
      ws = new WebSocket(
        WS_URL
      );
    } catch (error) {
      setStatus(
        "Gagal membuat koneksi."
      );

      setTimeout(
        connect,
        3000
      );

      return;
    }

    ws.addEventListener(
      "open",
      () => {
        connected = true;

        setStatus(
          "Terhubung"
        );

        ws.send(
          JSON.stringify({
            type: "join",
            role: "visitor",
            chatId,
            name:
              name ||
              "Pengunjung",
          })
        );
      }
    );

    ws.addEventListener(
      "message",
      (event) => {
        let data;

        try {
          data =
            JSON.parse(
              event.data
            );
        } catch {
          return;
        }

        // JOINED
        if (
          data.type ===
          "joined"
        ) {
          chatId =
            data.chatId;

          name =
            data.name ||
            name ||
            "Pengunjung";

          localStorage.setItem(
            CHAT_STORAGE,
            chatId
          );

          localStorage.setItem(
            NAME_STORAGE,
            name
          );

          nameBox.style.display =
            "none";

          composer.style.display =
            "flex";

          setStatus(
            "Terhubung"
          );

          return;
        }

        // HISTORY
        if (
          data.type ===
          "history"
        ) {
          if (
            data.chatId ===
            chatId
          ) {
            loadHistory(
              data.messages
            );
          }

          return;
        }

        // MESSAGE
        if (
          data.type ===
          "message"
        ) {
          if (
            data.chatId ===
            chatId
          ) {
            addMessage(data);
          }

          return;
        }
      }
    );

    ws.addEventListener(
      "close",
      () => {
        connected = false;

        setStatus(
          "Terputus. Menghubungkan kembali..."
        );

        setTimeout(
          connect,
          2000
        );
      }
    );

    ws.addEventListener(
      "error",
      () => {
        connected = false;

        setStatus(
          "Koneksi bermasalah..."
        );
      }
    );
  }

  // =========================
  // SEND
  // =========================

  function sendMessage() {
    const text =
      messageInput.value.trim();

    if (!text) return;

    if (
      !ws ||
      ws.readyState !==
        WebSocket.OPEN
    ) {
      setStatus(
        "Belum terhubung."
      );

      return;
    }

    ws.send(
      JSON.stringify({
        type: "message",
        text,
      })
    );

    messageInput.value = "";

    messageInput.focus();
  }

  // =========================
  // SAVE NAME
  // =========================

  saveName.addEventListener(
    "click",
    () => {
      const value =
        nameInput.value
          .trim()
          .slice(0, 40);

      if (!value) {
        alert(
          "Masukkan nama terlebih dahulu."
        );

        return;
      }

      name = value;

      localStorage.setItem(
        NAME_STORAGE,
        name
      );

      nameBox.style.display =
        "none";

      composer.style.display =
        "flex";

      if (
        ws &&
        ws.readyState ===
          WebSocket.OPEN
      ) {
        ws.send(
          JSON.stringify({
            type: "join",
            role: "visitor",
            chatId,
            name,
          })
        );
      }
    }
  );

  // =========================
  // BUTTON
  // =========================

  sendButton.addEventListener(
    "click",
    sendMessage
  );

  messageInput.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Enter"
      ) {
        event.preventDefault();

        sendMessage();
      }
    }
  );

  nameInput.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Enter"
      ) {
        event.preventDefault();

        saveName.click();
      }
    }
  );

  // =========================
  // START
  // =========================

  if (name) {
    nameBox.style.display =
      "none";

    composer.style.display =
      "flex";
  }

  connect();
})();
