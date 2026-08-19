# WebChat Cloudflare + Termux

Versi ini memakai Cloudflare Workers + Durable Objects + WebSockets, bukan server Express/Render.

## Deploy

```bash
pkg update -y
pkg install nodejs git -y
git clone https://github.com/THAR-03/webchat.git
cd REPO
npm install
npx wrangler login
npx wrangler deploy
```

Cloudflare akan memberikan URL `workers.dev`.

## Owner

Di Termux:

```bash
SERVER='https://webchat.username.workers.dev' node owner.js
```

Saat ini owner menggunakan ID chat. Versi lanjutan sebaiknya menambahkan dashboard owner dan autentikasi owner.

## GitHub

Upload seluruh isi folder ini ke repository GitHub. Jangan upload `.env`, token, atau secret.

## Catatan Free

Workers Free saat ini memiliki batas 100.000 request/hari. WebSocket dan Durable Objects mempunyai aturan penggunaan/billing tersendiri; cek pricing Cloudflare sebelum penggunaan besar.

Dokumentasi:
- https://developers.cloudflare.com/workers/
- https://developers.cloudflare.com/durable-objects/
