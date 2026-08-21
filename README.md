# WebChat Cloudflare V6

## Cara kerja Webchat Cloudeflare V6

1. Pesan pengunjung disimpan ke Durable Object **sebelum** dikirim lewat WebSocket.
2. Setiap kali `owner.js` tersambung atau reconnect, server mengirim ulang riwayat tersimpan untuk semua chat.
3. `owner.js` mempunyai deduplikasi berdasarkan `message.id`, sehingga pesan yang sudah tampil tidak ditampilkan dua kali.
4. Pesan lama dari versi server sebelumnya tetap bisa ditampilkan menggunakan fallback key.
5. Riwayat disimpan sampai 2000 pesan per chat.

## Deploy

Upload project ke GitHub/Cloudflare seperti biasa.

```bash
npx wrangler deploy
```

Pastikan Worker Secret `OWNER_KEY` sudah dibuat.

## Termux

```bash
pkg update && pkg upgrade
pkg install git
git clone https://github.com/THAR-03/webchat.git
cd Webchat
npm install ws --ignore-scripts
SERVER='https://YOUR-WORKER.workers.dev' OWNER_KEY='YOUR_KEY' node owner.js
```

Agar Android tidak terlalu agresif menghentikan proses:

```bash
termux-wake-lock
```

Tetap disarankan mematikan battery optimization untuk Termux di pengaturan Android.

## Pengujian Webchat V6

1. Jalankan `owner.js`.
2. Pastikan visitor bisa mengirim pesan.
3. Tutup/koneksi owner terputus.
4. Kirim beberapa pesan dari website visitor.
5. Jalankan/reconnect `owner.js`.
6. Pesan yang dikirim saat owner offline harus muncul dari bagian `Sinkronisasi pesan dimulai`.
