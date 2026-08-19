(() => {
  const messages = document.querySelector("#messages");
  const form = document.querySelector("#form");
  const input = document.querySelector("#input");
  const send = document.querySelector("#send");
  const status = document.querySelector("#status");
  const identity = document.querySelector("#identity");

  const STORAGE_KEY = "webchat_visitor_id_v4";
  let visitorId = localStorage.getItem(STORAGE_KEY);

  if (!visitorId) {
    visitorId = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, visitorId);
  }

  identity.textContent = "ID: " + visitorId;

  let ws;
  let reconnectTimer;
  let reconnecting = false;

  function addSystem(text) {
    const el = document.createElement("div");
    el.className = "system";
    el.textContent = "[system] " + text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  }

  function addMessage(m) {
    const el = document.createElement("div");
    el.className = "msg " + (m.sender === "owner" ? "owner" : "visitor");

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent =
      (m.sender === "owner" ? "OWNER" : "YOU") +
      " · " +
      new Date(m.time).toLocaleString();

    const text = document.createElement("div");
    text.className = "text";
    text.textContent = m.text;

    el.append(meta, text);
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  }

  function setConnected(ok) {
    input.disabled = !ok;
    send.disabled = !ok;
    status.textContent = ok ? "ONLINE" : "OFFLINE";
  }

  function connect() {
    clearTimeout(reconnectTimer);

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host + "/ws");

    ws.onopen = () => {
      setConnected(true);
      reconnecting = false;

      ws.send(JSON.stringify({
        type: "join",
        role: "visitor",
        chatId: visitorId,
        name: "Pengunjung"
      }));
    };

    ws.onmessage = event => {
      let d;
      try { d = JSON.parse(event.data); } catch { return; }

      if (d.type === "joined") {
        visitorId = d.chatId;
        localStorage.setItem(STORAGE_KEY, visitorId);
        identity.textContent = "ID: " + visitorId;

        // History comes from SQLite, so refreshing/reconnecting does not erase it.
        messages.replaceChildren();

        for (const m of d.history || []) {
          addMessage(m);
        }

        if (!d.history?.length) {
          addSystem("Chat aktif. ID pengunjung: " + visitorId);
        }

        return;
      }

      if (d.type === "message") {
        addMessage(d);
      }
    };

    ws.onclose = () => {
      setConnected(false);

      if (!reconnecting) {
        addSystem("Koneksi terputus. Mencoba kembali...");
        reconnecting = true;
      }

      reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = () => {};
  }

  form.addEventListener("submit", e => {
    e.preventDefault();

    const text = input.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      type: "message",
      text
    }));

    input.value = "";
    input.focus();
  });

  connect();
})();