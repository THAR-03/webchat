```javascript
(() => {
  "use strict";

  // =========================================================
  // ELEMENT
  // =========================================================

  const $ = (id) => document.getElementById(id);

  const identity = $("identity");
  const chat = $("chat");
  const msgs = $("messages");
  const status = $("status");
  const nameInput = $("name");
  const textInput = $("text");
  const startButton = $("start");
  const form = $("form");
  const newChatButton = $("newChat");
  const visitorId = $("visitorId");

  // Pastikan semua element HTML tersedia
  if (
    !identity ||
    !chat ||
    !msgs ||
    !status ||
    !nameInput ||
    !textInput ||
    !startButton ||
    !form ||
    !newChatButton ||
    !visitorId
  ) {
    console.error("WebChat: element HTML tidak lengkap.");
    return;
  }

  // =========================================================
  // STORAGE
  // =========================================================

  const ID_KEY = "webchat_visitor_id";
  const NAME_KEY = "webchat_name";

  let chatId = localStorage.getItem(ID_KEY) || "";
  let name = localStorage.getItem(NAME_KEY) || "";

  // =========================================================
  // STATE
  // =========================================================

  let ws = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let manualDisconnect = false;
  let connecting = false;
  let unread = 0;

  // =========================================================
  // CUSTOM NOTIFICATION SOUND
  // =========================================================
  //
  // File harus berada di:
  //
  // public/sounds/owner-reply.mp3
  //
  // dan diakses melalui:
  //
  // /sounds/owner-reply.mp3
  //

  const ownerReplySound = new Audio(
    "/sounds/owner-reply.mp3"
  );

  ownerReplySound.preload = "auto";
  ownerReplySound.volume = 1.0;

  let audioUnlocked = false;

  // =========================================================
  // AUDIO UNLOCK
  // =========================================================

  async function unlockAudio() {
    if (audioUnlocked) {
      return;
    }

    try {
      ownerReplySound.muted = true;
      ownerReplySound.currentTime = 0;

      await ownerReplySound.play();

      ownerReplySound.pause();
      ownerReplySound.currentTime = 0;
      ownerReplySound.muted = false;

      audioUnlocked = true;

      console.log(
        "WebChat: audio notification aktif."
      );
    } catch (error) {
      ownerReplySound.muted = false;

      console.warn(
        "WebChat: audio belum dapat diaktifkan.",
        error
      );
    }
  }

  // =========================================================
  // PLAY OWNER SOUND
  // =========================================================

  async function playOwnerReplySound() {
    try {
      ownerReplySound.pause();

      ownerReplySound.currentTime = 0;

      ownerReplySound.muted = false;
      ownerReplySound.volume = 1.0;

      await ownerReplySound.play();

      audioUnlocked = true;
    } catch (error) {
      console.warn(
        "WebChat: suara notifikasi tidak dapat diputar.",
        error
      );
    }
  }

  // =========================================================
  // STATUS
  // =========================================================

  function setStatus(online) {
    status.textContent = online
      ? "ONLINE"
      : "OFFLINE";

    status.classList.toggle(
      "online",
      online
    );
  }

  // =========================================================
  // TITLE / UNREAD
  // =========================================================

  function updateTitle() {
    document.title = unread > 0
      ? `(${unread}) Pesan baru — WebChat Linux`
      : "WebChat Linux";
  }

  function resetUnread() {
    unread = 0;
    updateTitle();
  }

  // =========================================================
  // SYSTEM MESSAGE
  // =========================================================

  function systemMessage(message) {
    const element =
      document.createElement("div");

    element.className = "msg system";

    element.textContent =
      "[system] " + message;

    msgs.appendChild(element);

    msgs.scrollTop =
      msgs.scrollHeight;
  }

  // =========================================================
  // ADD CHAT MESSAGE
  // =========================================================

  function addMessage(
    sender,
    messageName,
    messageText,
    time
  ) {
    const element =
      document.createElement("div");

    element.className =
      "msg " +
      (
        sender === "owner"
          ? "owner"
          : "visitor"
      );

    const meta =
      document.createElement("div");

    meta.className = "meta";

    let formattedTime = "";

    if (time) {
      try {
        formattedTime =
          new Date(time)
            .toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit"
            });
      } catch {}
    }

    meta.textContent =
      (messageName || "Pengunjung") +
      (formattedTime
        ? " " + formattedTime
        : "");

    const body =
      document.createElement("div");

    body.textContent =
      messageText || "";

    element.appendChild(meta);
    element.appendChild(body);

    msgs.appendChild(element);

    msgs.scrollTop =
      msgs.scrollHeight;
  }

  // =========================================================
  // BROWSER NOTIFICATION
  // =========================================================

  function requestNotificationPermission() {
    if (
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission()
        .catch(() => {});
    }
  }

  // =========================================================
  // OWNER NOTIFICATION
  // =========================================================

  function notifyOwner(message) {
    unread++;

    updateTitle();

    // Browser notification jika tab sedang tidak aktif
    if (
      document.hidden &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      try {
        new Notification(
          "WebChat — Owner membalas",
          {
            body:
              message.text ||
              "Pesan baru dari Owner",

            tag: "webchat-owner",

            renotify: true
          }
        );
      } catch {}
    }

    // Suara custom
    playOwnerReplySound();
  }

  // =========================================================
  // SHOW CHAT
  // =========================================================

  function showChat() {
    identity.classList.add("hidden");
    chat.classList.remove("hidden");

    visitorId.textContent =
      "ID: " + chatId;

    textInput.focus();
  }

  // =========================================================
  // SHOW IDENTITY
  // =========================================================

  function showIdentity() {
    chat.classList.add("hidden");
    identity.classList.remove("hidden");
  }

  // =========================================================
  // CLOSE CURRENT SOCKET
  // =========================================================

  function closeSocket() {
    if (!ws) {
      return;
    }

    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;

      ws.close();
    } catch {}

    ws = null;
  }

  // =========================================================
  // CONNECT
  // =========================================================

  function connect() {
    // Jangan membuat koneksi ganda
    if (
      ws &&
      (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      )
    ) {
      return;
    }

    if (connecting) {
      return;
    }

    connecting = true;

    clearTimeout(reconnectTimer);

    setStatus(false);

    const protocol =
      location.protocol === "https:"
        ? "wss://"
        : "ws://";

    const websocketUrl =
      protocol +
      location.host +
      "/ws";

    console.log(
      "WebChat: connecting to",
      websocketUrl
    );

    try {
      ws = new WebSocket(
        websocketUrl
      );
    } catch (error) {
      connecting = false;

      console.error(
        "WebChat: gagal membuat WebSocket.",
        error
      );

      systemMessage(
        "Gagal membuat koneksi WebSocket."
      );

      scheduleReconnect();

      return;
    }

    // =======================================================
    // OPEN
    // =======================================================

    ws.onopen = () => {
      console.log(
        "WebChat: WebSocket connected."
      );

      connecting = false;

      reconnectAttempts = 0;

      setStatus(true);

      /*
       * Kirim identitas visitor ke server.
       */
      const joinData = {
        type: "join",
        role: "visitor",
        chatId: chatId || "",
        name: name || "Pengunjung"
      };

      console.log(
        "WebChat: sending join",
        joinData
      );

      try {
        ws.send(
          JSON.stringify(joinData)
        );
      } catch (error) {
        console.error(
          "WebChat: gagal mengirim join.",
          error
        );
      }
    };

    // =======================================================
    // MESSAGE
    // =======================================================

    ws.onmessage = (event) => {
      let data;

      try {
        data =
          JSON.parse(event.data);
      } catch (error) {
        console.warn(
          "WebChat: pesan server bukan JSON.",
          event.data
        );

        return;
      }

      console.log(
        "WebChat: received",
        data
      );

      // -----------------------------------------------------
      // JOINED
      // -----------------------------------------------------

      if (data.type === "joined") {
        chatId =
          String(data.chatId || "");

        if (!chatId) {
          console.error(
            "WebChat: server tidak mengirim chatId."
          );

          systemMessage(
            "Server tidak memberikan ID pengunjung."
          );

          return;
        }

        // Simpan ID
        localStorage.setItem(
          ID_KEY,
          chatId
        );

        // Pastikan nama juga tersimpan
        localStorage.setItem(
          NAME_KEY,
          name
        );

        // Tampilkan halaman chat
        showChat();

        // Bersihkan pesan lama dari UI
        msgs.innerHTML = "";

        resetUnread();

        // Tampilkan history
        if (
          Array.isArray(data.history)
        ) {
          data.history.forEach(
            (message) => {
              addMessage(
                message.sender,
                message.name,
                message.text,
                message.time
              );
            }
          );
        }

        systemMessage(
          "Connected. Riwayat chat dipulihkan."
        );

        return;
      }

      // -----------------------------------------------------
      // CHAT MESSAGE
      // -----------------------------------------------------

      if (data.type === "message") {
        addMessage(
          data.sender,
          data.name,
          data.text,
          data.time
        );

        /*
         * Hanya pesan owner yang memicu
         * notifikasi suara.
         */
        if (
          data.sender === "owner"
        ) {
          notifyOwner(data);
        }

        return;
      }

      // -----------------------------------------------------
      // ERROR
      // -----------------------------------------------------

      if (data.type === "error") {
        console.error(
          "WebChat server error:",
          data.message
        );

        systemMessage(
          data.message ||
          "Terjadi kesalahan pada server."
        );

        return;
      }

      // -----------------------------------------------------
      // AUTH ERROR
      // -----------------------------------------------------

      if (data.type === "auth_error") {
        systemMessage(
          data.message ||
          "Autentikasi gagal."
        );

        return;
      }
    };

    // =======================================================
    // ERROR
    // =======================================================

    ws.onerror = (error) => {
      console.error(
        "WebChat: WebSocket error.",
        error
      );

      connecting = false;

      setStatus(false);
    };

    // =======================================================
    // CLOSE
    // =======================================================

    ws.onclose = (event) => {
      console.warn(
        "WebChat: WebSocket closed.",
        event.code,
        event.reason
      );

      connecting = false;

      setStatus(false);

      ws = null;

      if (!manualDisconnect) {
        scheduleReconnect();
      }
    };
  }

  // =========================================================
  // RECONNECT
  // =========================================================

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);

    if (manualDisconnect) {
      return;
    }

    reconnectAttempts++;

    const delay =
      Math.min(
        10000,
        1500 * reconnectAttempts
      );

    console.log(
      `WebChat: reconnect dalam ${delay}ms`
    );

    reconnectTimer =
      setTimeout(() => {
        connect();
      }, delay);
  }

  // =========================================================
  // CONNECT BUTTON
  // =========================================================

  startButton.addEventListener(
    "click",
    async () => {
      /*
       * Ambil nickname
       */
      name =
        nameInput.value.trim();

      if (!name) {
        name = "Pengunjung";
      }

      /*
       * Batasi nama sesuai server.
       */
      name =
        name.slice(0, 40);

      /*
       * Simpan nama
       */
      localStorage.setItem(
        NAME_KEY,
        name
      );

      /*
       * Aktifkan audio melalui
       * interaksi pengguna.
       */
      await unlockAudio();

      /*
       * Minta izin browser notification.
       */
      requestNotificationPermission();

      /*
       * Jika socket lama bermasalah,
       * bersihkan terlebih dahulu.
       */
      if (
        ws &&
        ws.readyState === WebSocket.CLOSED
      ) {
        ws = null;
      }

      manualDisconnect = false;

      /*
       * Mulai koneksi.
       */
      connect();
    }
  );

  // =========================================================
  // SEND MESSAGE
  // =========================================================

  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      const message =
        textInput.value.trim();

      if (!message) {
        return;
      }

      if (
        !ws ||
        ws.readyState !== WebSocket.OPEN
      ) {
        systemMessage(
          "Belum terhubung ke server."
        );

        return;
      }

      try {
        ws.send(
          JSON.stringify({
            type: "message",
            chatId,
            text: message
          })
        );

        textInput.value = "";

        textInput.focus();

        resetUnread();
      } catch (error) {
        console.error(
          "WebChat: gagal mengirim pesan.",
          error
        );

        systemMessage(
          "Pesan gagal dikirim."
        );
      }
    }
  );

  // =========================================================
  // NEW CHAT
  // =========================================================

  newChatButton.addEventListener(
    "click",
    () => {
      const confirmed =
        window.confirm(
          "Buat ID baru?"
        );

      if (!confirmed) {
        return;
      }

      /*
       * Hentikan reconnect sementara.
       */
      manualDisconnect = true;

      clearTimeout(
        reconnectTimer
      );

      /*
       * Tutup WebSocket.
       */
      closeSocket();

      /*
       * Hapus ID lama.
       */
      localStorage.removeItem(
        ID_KEY
      );

      chatId = "";

      /*
       * Bersihkan pesan.
       */
      msgs.innerHTML = "";

      resetUnread();

      /*
       * Kembali ke halaman nickname.
       */
      showIdentity();

      /*
       * Izinkan koneksi baru.
       */
      manualDisconnect = false;
    }
  );

  // =========================================================
  // RESET UNREAD WHEN USER READS CHAT
  // =========================================================

  msgs.addEventListener(
    "scroll",
    () => {
      const nearBottom =
        msgs.scrollTop +
          msgs.clientHeight >=
        msgs.scrollHeight - 20;

      if (nearBottom) {
        resetUnread();
      }
    }
  );

  // =========================================================
  // TAB ACTIVE
  // =========================================================

  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden) {
        resetUnread();
      }
    }
  );

  // =========================================================
  // INITIAL STATE
  // =========================================================

  updateTitle();

  nameInput.value = name;

  /*
   * Jika browser sudah memiliki
   * chatId + nickname, otomatis
   * lanjut ke chat.
   */
  if (chatId && name) {
    showChat();

    visitorId.textContent =
      "ID: " + chatId;

    manualDisconnect = false;

    connect();
  } else {
    showIdentity();
  }

  // =========================================================
  // DEBUG
  // =========================================================

  console.log(
    "WebChat visitor initialized."
  );
})();
```
