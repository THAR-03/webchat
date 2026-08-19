const SERVER = location.origin;

/*
 * =========================
 * ID PENGUNJUNG
 * =========================
 */

let visitorId =
  localStorage.getItem("visitor_id");

if (!visitorId) {
  visitorId =
    "VIS-" +
    crypto.randomUUID()
      .replace(/-/g, "")
      .slice(0, 8)
      .toUpperCase();

  localStorage.setItem(
    "visitor_id",
    visitorId
  );
}

/*
 * =========================
 * ELEMENT
 * =========================
 */

const messages =
  document.querySelector("#messages");

const messageInput =
  document.querySelector("#message");

const sendButton =
  document.querySelector("#send");

const nameInput =
  document.querySelector("#name");

const visitorIdElement =
  document.querySelector("#visitor-id");

if (visitorIdElement) {
  visitorIdElement.textContent =
    visitorId;
}

/*
 * =========================
 * WEBSOCKET
 * =========================
 */

const wsUrl =
  SERVER.replace(/^http/, "ws") +
  "/ws?chat=" +
  encodeURIComponent(visitorId);

let ws;

function connect() {
  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    ws.send(
      JSON.stringify({
        type: "join",
        role: "visitor",
        chatId: visitorId,
        name:
          nameInput?.value?.trim() ||
          "Pengunjung"
      })
    );
  });

  ws.addEventListener(
    "message",
    event => {
      let data;

      try {
        data =
          JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.type === "joined") {
        if (visitorIdElement) {
          visitorIdElement.textContent =
            data.chatId;
        }

        return;
      }

      if (data.type === "message") {
        addMessage(data);
      }
    }
  );

  ws.addEventListener("close", () => {
    setTimeout(connect, 3000);
  });
}

connect();

/*
 * =========================
 * PESAN
 * =========================
 */

const displayedMessages =
  new Set();

function addMessage(data) {
  /*
   * Mencegah pesan muncul dua kali.
   */
  if (data.messageId) {
    if (
      displayedMessages.has(
        data.messageId
      )
    ) {
      return;
    }

    displayedMessages.add(
      data.messageId
    );
  }

  const div =
    document.createElement("div");

  div.className =
    data.sender === "owner"
      ? "message owner"
      : "message visitor";

  const name =
    data.sender === "owner"
      ? "Owner"
      : data.name || "Pengunjung";

  div.textContent =
    `${name}: ${data.text}`;

  messages.appendChild(div);

  messages.scrollTop =
    messages.scrollHeight;
}

/*
 * =========================
 * SEND
 * =========================
 */

function sendMessage() {
  const text =
    messageInput.value.trim();

  if (!text) return;

  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {
    alert(
      "Belum terhubung ke server."
    );

    return;
  }

  ws.send(
    JSON.stringify({
      type: "message",
      chatId: visitorId,
      text
    })
  );

  messageInput.value = "";
}

sendButton?.addEventListener(
  "click",
  sendMessage
);

messageInput?.addEventListener(
  "keydown",
  event => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendMessage();
    }
  }
);
