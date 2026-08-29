# SukaCoding 

Platform belajar coding (Scratch, Python, Roblox, dan lainnya) lengkap dengan sistem pembayaran, verifikasi email, role admin & pelanggan, video preview gratis, dan manajemen event.

## Fitur Utama

- **Autentikasi**: Register & login dengan password di-hash (bcrypt), sesi via JWT httpOnly cookie.
- **Verifikasi Email**: Akun baru wajib verifikasi email lewat link sebelum bisa login. Ada fitur kirim ulang link verifikasi.
- **Role**: `admin` dan `customer` (pelanggan), dengan proteksi akses di level server (bukan hanya UI).
- **Course**: video per section, video gratis (preview) vs terkunci — validasi akses dilakukan di server.
- **Pembayaran** (Midtrans Snap, dengan fallback mode simulasi jika API key belum diisi):
  - Setelah bayar berhasil, pelanggan **otomatis dapat akses** ke course selama jangka waktu yang diatur admin.
  - **Validasi jumlah pembayaran**: sistem memverifikasi jumlah yang benar-benar dibayar sama persis dengan harga course di database sebelum memberi akses — mencegah manipulasi jumlah bayar.
  - **Idempotency & row locking**: notifikasi pembayaran duplikat (yang memang bisa terjadi dari Midtrans) tidak akan memproses ulang atau memberi akses dobel, berkat database transaction + row lock.
  - **Email struk otomatis** dikirim ke pelanggan setiap pembayaran berhasil.
  - Kegagalan pembayaran (`deny`/`cancel`/`expire`) otomatis membuat status order `failed` — **tidak ada akses course yang diberikan**.
- **Event**: CRUD lengkap oleh admin, halaman publik untuk pelanggan.
- **Dashboard Admin**: statistik, kelola course + video + setting, kelola event, kelola pengguna, riwayat transaksi.
- **Dashboard Pelanggan**: course aktif/kedaluwarsa, riwayat transaksi.

## Keamanan

- **PostgreSQL** dengan **parameterized queries** di semua query (`$1, $2, ...`) — mencegah SQL Injection.
- **CSRF protection** di semua form yang mengubah data.
- **XSS sanitization** pada input teks yang disimpan.
- **Helmet** (HTTP security headers + CSP), **rate limiting** global & khusus login/register.
- Password **bcrypt (12 rounds)**, JWT httpOnly cookie (`secure` + `sameSite=strict` di production).
- Verifikasi **signature Midtrans** pada setiap webhook notifikasi pembayaran.
- **Validasi jumlah pembayaran** & **database transaction lock** pada alur pemrosesan pembayaran (lihat `src/controllers/paymentController.js`).
- Error async di semua route ditangkap lewat `asyncHandler` — tidak ada request yang "menggantung" tanpa respons kalau terjadi error database.

## Teknologi

- **Backend**: Node.js + Express
- **Database**: **PostgreSQL** (`pg`)
- **View**: EJS + Tailwind CSS (CDN)
- **Payment**: Midtrans Snap (`midtrans-client`)
- **Email**: Nodemailer (SMTP apa saja — Gmail, Zoho, Mailgun, dll)

## Instalasi (Development)

### 1. Install & jalankan PostgreSQL

Kalau belum punya PostgreSQL di komputer:
- **Windows/Mac**: install [PostgreSQL.app](https://postgresapp.com/) (Mac) atau installer resmi [postgresql.org](https://www.postgresql.org/download/) (Windows).
- **Linux**: `sudo apt install postgresql postgresql-contrib`

Buat database:
```bash
psql -U postgres -c "CREATE DATABASE sukacoding;"
```

### 2. Setup project

```bash
npm install
cp .env.example .env
```

Edit `.env`:
- Isi `DATABASE_URL` sesuai koneksi PostgreSQL Anda, contoh: `postgres://postgres:password_anda@localhost:5432/sukacoding`
- Generate `JWT_SECRET` & `COOKIE_SECRET` baru: `openssl rand -hex 32`
- **SMTP opsional untuk development** — kalau dikosongkan, email verifikasi & struk pembayaran akan otomatis "disimulasikan" (dicatat di log server, bukan benar-benar terkirim), supaya Anda tetap bisa test alurnya. Untuk lihat isi email simulasi, cek terminal tempat `npm start` berjalan — link verifikasi akan tercetak di sana.

### 3. Seed data awal

```bash
npm run seed
```

### 4. Jalankan

```bash
npm start
```

Buka `http://localhost:3000`.

## Mengaktifkan Email Sungguhan (SMTP)

Isi di `.env`:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=email_anda@gmail.com
SMTP_PASS=app_password_16_digit
EMAIL_FROM="SukaCoding" <no-reply@sukacoding.com>
```
> Untuk Gmail, wajib pakai **App Password** (bukan password akun biasa) — aktifkan lewat myaccount.google.com/apppasswords setelah mengaktifkan 2-Step Verification. Untuk volume email lebih besar/production, pertimbangkan layanan khusus seperti Mailgun, Resend, Zoho Mail, atau Amazon SES.

## Mengaktifkan Pembayaran Sungguhan (Midtrans)

1. Daftar & verifikasi bisnis di [Midtrans](https://dashboard.midtrans.com).
2. Ambil **Server Key** & **Client Key** mode Production.
3. Isi di `.env`: `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `MIDTRANS_IS_PRODUCTION=true`.
4. Set **Payment Notification URL** di dashboard Midtrans ke: `https://domainanda.com/payment/notification`.

## Struktur Folder

```
sukacoding/
├── server.js                 # Entry point (inisialisasi DB sebelum listen)
├── src/
│   ├── db.js                  # Pool koneksi PostgreSQL + schema + helper query/transaction
│   ├── middleware/             # auth (JWT+role) & security (CSRF, sanitasi)
│   ├── controllers/            # Logic tiap fitur (semua async/await)
│   ├── routes/                 # Routing (dibungkus asyncHandler)
│   └── utils/
│       ├── asyncHandler.js     # Penangkap error async supaya tidak "menggantung"
│       ├── email.js            # Kirim email verifikasi & struk (SMTP / mode simulasi)
│       └── seed.js             # Script data awal
├── views/                      # Template EJS
└── public/                     # CSS, JS, file upload
```

## Catatan Sebelum Production

- Ganti semua secret (`JWT_SECRET`, `COOKIE_SECRET`) dan password admin default.
- Set `NODE_ENV=production`, jalankan di belakang HTTPS.
- Pastikan `DATABASE_URL` mengarah ke PostgreSQL yang punya **backup otomatis** (kebanyakan penyedia managed Postgres seperti Railway/Render/Neon sudah menyediakan ini).
- Test alur pembayaran production dengan nominal kecil terlebih dahulu sebelum diumumkan ke pelanggan.
- Lihat panduan deployment lengkap terpisah untuk langkah GitHub → hosting → domain → SSL.
