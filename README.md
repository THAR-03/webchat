# WebChat Cloudflare + Termux

Chat publik berjalan di Cloudflare Workers + Durable Objects.
Owner membalas dari Termux menggunakan owner.js.

## Cloudflare

Build command: kosongkan / tidak perlu build command.

Deploy command:
npx wrangler deploy

Set secret OWNER_KEY dari Cloudflare atau Wrangler.

## Termux

Node.js diperlukan untuk owner.js.

Install dependency owner:
npm install --omit=dev

Jalankan:
SERVER='https://NAMA.workers.dev' OWNER_KEY='RAHASIA' node owner.js

Catatan:
Jangan menjalankan `npm install` untuk memasang Wrangler di Termux Android.
Deployment Wrangler dilakukan oleh Cloudflare/GitHub build.
