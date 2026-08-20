# WebChat Cloudflare

Upload all files to GitHub.

Cloudflare Build command: kosong
Deploy command: `npx wrangler deploy`

Create Worker Secret `OWNER_KEY` in Cloudflare.

For Termux owner client only: `npm install --no-save --ignore-scripts ws`
Then: `SERVER='https://YOUR-WORKER.workers.dev' OWNER_KEY='YOUR_SECRET' node owner.js`


## Riwayat chat persisten
Riwayat setiap pengunjung disimpan di Cloudflare Durable Object Storage menggunakan visitor ID. Saat refresh atau membuka kembali website pada browser yang sama, ID dari localStorage dipakai kembali dan server mengirimkan seluruh riwayat chat yang tersimpan. Pesan dari owner juga disimpan sehingga ikut muncul kembali.
