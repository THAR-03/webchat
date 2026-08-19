# WebChat v5

Cloudflare Worker + Durable Object SQLite + WebSocket.

## Cloudflare
Build command: kosong
Deploy command:
npx wrangler deploy

Set secret:
npx wrangler secret put OWNER_KEY

## Termux
Jangan gunakan `npm install` biasa jika workerd memicu error Android.

Install WebSocket client saja:
npm install ws --ignore-scripts

Run:
SERVER='https://NAMA.workers.dev' OWNER_KEY='RAHASIA' node owner.js

## GitHub
Upload seluruh isi paket. Jangan memasukkan node_modules.
