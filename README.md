# WebChat v4 — Persistent History

Versi ini menyimpan chat di SQLite Durable Object.

## Struktur

- `src/index.js` — Worker + Durable Object + SQLite
- `public/index.html` — halaman chat
- `public/style.css` — tema Linux/terminal
- `public/app.js` — WebSocket visitor
- `owner.js` — console owner
- `wrangler.json` — konfigurasi Cloudflare
- `package.json` — dependency

## Cloudflare

Deploy command:

```bash
npx wrangler deploy
```

Pastikan Secret dibuat:

```bash
npx wrangler secret put OWNER_KEY
```

Jangan menaruh nilai OWNER_KEY di GitHub.

## Owner di Termux

Install hanya dependency `ws` untuk owner:

```bash
npm install ws --ignore-scripts
```

Kemudian:

```bash
SERVER='https://DOMAIN.workers.dev' OWNER_KEY='rahasia' node owner.js
```

Jangan menjalankan `npm install` jika Termux mencoba memasang `workerd`; Android tidak didukung oleh binary workerd. `owner.js` hanya membutuhkan `ws`.

## Riwayat

ID pengunjung disimpan di localStorage browser. Pesan disimpan di SQLite Durable Object, sehingga pesan tidak dihapus ketika pengunjung menutup halaman atau Worker melakukan restart.

Owner:

```text
list
use <ID>
history <ID>
reply <pesan>
/reply <ID> <pesan>
```
