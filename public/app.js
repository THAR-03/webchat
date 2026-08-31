```javascript
(() => {
  const $ = (id) => document.getElementById(id);

  const ID = "webchat_visitor_id";
  const NAME = "webchat_name";

  // =========================================================
  // STATE
  // =========================================================

  let ws = null;
  let manual = false;
  let retry = null;

  let chatId = localStorage.getItem(ID) || "";
  let name = localStorage.getItem(NAME) || "";
  let unread = 0;

  // =========================================================
  // ELEMENT
  // =========================================================

  const identity = $("identity");
  const chat = $("chat");
  const msgs = $("messages");
  const status = $("status");
  const nameIn = $("name");
  const text = $("text");

  nameIn.value = name;

  // =========================================================
  // CUSTOM NOTIFICATION SOUND
  // =========================================================
  //
  // File:
  // public/sounds/owner-reply.mp3
  //
  // URL:
  // /sounds/owner-reply.mp3
  //

  const ownerReplySound = new Audio("/sounds/owner-reply.mp3");

  ownerReplySound.preload = "auto";
  ownerReplySound.volume = 1.0;

  /*
   * Browser biasanya memblokir audio sebelum user
   * melakukan interaksi dengan halaman.
   *
   * Kita mencoba melakukan "unlock" audio ketika
   * user menekan tombol CONNECT.
   */
  let audioUnlocked = false;

  async function unlockAudio() {
    if (audioUnlocked) return;

    try {
      ownerReplySound.muted = true;
      ownerReplySound.currentTime = 0;

      await ownerReplySound.play();

      ownerReplySound.pause();
      ownerReplySound.currentTime = 0;
      ownerReplySound.muted = false;

      audioUnlocked = true;
    } catch {
      ownerReplySound.muted = false;
    }
  }

  /*
   * Memutar suara ketika owner membalas.
   */
  async function playOwnerReplySound() {
    try {
      ownerReplySound.pause();
      ownerReplySound.currentTime = 0;
      ownerReplySound.muted = false;
      ownerReplySound.volume = 1.0;

      await ownerReplySound.play();

      audioUnlocked = true;
    } catch {
      /*
       * Jika browser menolak autoplay, abaikan.
       * Chat tetap berjalan normal.
       */
    }
  }

  // =========================================================
  // STATUS
  // =========================================================

  function stat(ok) {
    status.textContent = ok ? "ONLINE" : "OFFLINE";
    status.classList.toggle("online", ok);
  }

  // =========================================================
  // TITLE / UNREAD
  // =========================================================

  function updateTitle() {
    document.title = unread
      ? `(${unread}) Pesan baru — WebChat Linux`
      : "WebChat Linux";
  }

  function resetUnread() {
    unread = 0;
    updateTitle();
  }

  // =========================================================
  // OWNER NOTIFICATION
  // =========================================================

  function notifyOwner(d) {
    unread++;
    updateTitle();

    /*
     * Browser Notification
     */
    if (
      document.hidden &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      try {
        new Notification(
          "WebChat — Owner membalas",
          {
            body: d.text || "Pesan baru dari Owner",
            tag: "webchat-owner",
            renotify: true
          }
        );
      } catch {}
    }

    /*
     * CUSTOM SOUND
     */
    playOwnerReplySound();
  }

  // =========================================================
  // REQUEST BROWSER NOTIFICATION
  // =========================================================

  function requestNotification() {
    if (
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission().catch(() => {});
    }
  }

  // =========================================================
  // ADD MESSAGE
  // =========================================================

  function add(sender, n, t, time) {
    const e = document.createElement("div");

    e.className =
      "msg " + (sender === "owner" ? "owner" : "visitor");

    const m = document.createElement("div");

    m.className = "meta";

    m.textContent =
      (n || "Pengunjung") +
      " " +
      (
        time
          ? new Date(time).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit"
            })
          : ""
      );

    const b = document.createElement("div");

    b.textContent = t;

    e.append(m, b);

    msgs.append(e);

    msgs.scrollTop = msgs.scrollHeight;
  }

  // =========================================================
  // SYSTEM MESSAGE
  // =========================================================

  function sys(t) {
    const e = document.createElement("div");

    e.className = "msg system";

    e.textContent = "[system] " + t;

    msgs.append(e);

    msgs.scrollTop = msgs.scrollHeight;
  }

  // =========================================================
  // CONNECT
  // =========================================================

  function connect() {
    if (
      manual ||
      ws?.readyState === WebSocket.OPEN ||
      ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    const protocol =
      location.protocol === "https:"
        ? "wss://"
        : "ws://";

    ws = new WebSocket(
      protocol + location.host + "/ws"
    );

    // =======================================================
    // OPEN
    // =======================================================

    ws.onopen = () => {
      stat(true);

      ws.send(
        JSON.stringify({
          type: "join",
          role: "visitor",
          chatId,
          name
        })
      );
    };

    // =======================================================
    // MESSAGE
    // =======================================================

    ws.onmessage = (e) => {
      let d;

      try {
        d = JSON.parse(e.data);
      } catch {
        return;
      }

      // -----------------------------------------------------
      // JOINED
      // -----------------------------------------------------

      if (d.type === "joined") {
        chatId = d.chatId;

        localStorage.setItem(ID, chatId);

        $("visitorId").textContent =
          "ID: " + chatId;

        identity.classList.add("hidden");
        chat.classList.remove("hidden");

        msgs.innerHTML = "";

        resetUnread();

        if (Array.isArray(d.history)) {
          d.history.forEach((m) => {
            add(
              m.sender,
              m.name,
              m.text,
              m.time
            );
          });
        }

        sys("Connected. Riwayat chat dipulihkan.");

        text.focus();

        return;
      }

      // -----------------------------------------------------
      // MESSAGE
      // -----------------------------------------------------

      if (d.type === "message") {
        add(
          d.sender,
          d.name,
          d.text,
          d.time
        );

        /*
         * HANYA owner yang memicu:
         *
         * - unread
         * - browser notification
         * - custom sound
         */
        if (d.sender === "owner") {
          notifyOwner(d);
        }

        return;
      }

      // -----------------------------------------------------
      // ERROR
      // -----------------------------------------------------

      if (d.type === "error") {
        sys(d.message);
      }
    };

    // =======================================================
    // CLOSE
    // =======================================================

    ws.onclose = () => {
      stat(false);

      if (!manual) {
        clearTimeout(retry);

        retry = setTimeout(
          connect,
          2500
        );
      }
    };

    // =======================================================
    // ERROR
    // =======================================================

    ws.onerror = () => {
      stat(false);
    };
  }

  // =========================================================
  // START / CONNECT BUTTON
  // =========================================================

  $("start").onclick = async () => {
    name =
      nameIn.value.trim() ||
      "Pengunjung";

    localStorage.setItem(
      NAME,
      name
    );

    /*
     * Unlock audio melalui interaksi user.
     */
    await unlockAudio();

    /*
     * Browser notification.
     */
    requestNotification();

    /*
     * WebSocket.
     */
    connect();
  };

  // =========================================================
  // SEND MESSAGE
  // =========================================================

  $("form").onsubmit = (e) => {
    e.preventDefault();

    resetUnread();

    const t = text.value.trim();

    if (!t) {
      return;
    }

    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN
    ) {
      sys("Belum terhubung.");

      connect();

      return;
    }

    ws.send(
      JSON.stringify({
        type: "message",
        chatId,
        text: t
      })
    );

    text.value = "";

    text.focus();
  };

  // =========================================================
  // SCROLL
  // =========================================================

  msgs.addEventListener("scroll", () => {
    if (
      msgs.scrollTop +
        msgs.clientHeight >=
      msgs.scrollHeight - 20
    ) {
      resetUnread();
    }
  });

  // =========================================================
  // VISIBILITY
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
  // NEW CHAT
  // =========================================================

  $("newChat").onclick = () => {
    if (
      !confirm(
        "Buat ID baru? Riwayat chat ID saat ini tetap tersimpan, tetapi chat baru akan dimulai."
      )
    ) {
      return;
    }

    localStorage.removeItem(ID);

    chatId = "";

    msgs.innerHTML = "";

    resetUnread();

    manual = true;

    ws?.close();

    manual = false;

    identity.classList.remove("hidden");

    chat.classList.add("hidden");
  };

  // =========================================================
  // INITIAL TITLE
  // =========================================================

  updateTitle();

  // =========================================================
  // RESTORE PREVIOUS CHAT
  // =========================================================

  if (chatId && name) {
    $("visitorId").textContent =
      "ID: " + chatId;

    identity.classList.add("hidden");

    chat.classList.remove("hidden");

    connect();
  }
})();
```
