# WebChat Cloudflare + Termux Owner v2

Versi ini memperbaiki versi pertama: owner otomatis menerima chat baru dan dapat melihat daftar chat dari Termux.

## Cloudflare
Build command: kosong. Deploy command: `npx wrangler deploy`. Root: `/`. Nama Worker: `webchat`.

Buat secret `OWNER_KEY` di Cloudflare Worker (Settings -> Variables and Secrets). Jangan commit secret ke GitHub.

## Termux
Termux tidak perlu Wrangler:

```bash
pkg update -y
pkg install nodejs git -y
git clone https://github.com/USERNAME/REPO.git
cd REPO
npm install --omit=dev
SERVER='https://webchat.xxxxx.workers.dev' OWNER_KEY='kunci-yang-sama' node owner.js
```

Perintah owner: `list`, `use <ID>`, `reply <pesan>`, `/reply <ID> <pesan>`, `exit`.

Saat visitor baru mulai chat, owner otomatis melihat `[CHAT ID] 🟢 Nama`. Saat visitor mengirim pesan, owner melihat pesan tersebut.
