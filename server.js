require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { attachUser } = require('./src/middleware/auth');
const { csrfMiddleware } = require('./src/middleware/security');
const db = require('./src/db');

const pageRoutes = require('./src/routes/pageRoutes');
const authRoutes = require('./src/routes/authRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const adminRoutes = require('./src/routes/adminRoutes');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

// ---------- KEAMANAN DASAR ----------
// Helmet: mengatur berbagai HTTP header keamanan (CSP, X-Frame-Options, HSTS, dll)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://app.sandbox.midtrans.com', 'https://app.midtrans.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        frameSrc: ["'self'", 'https://www.youtube.com', 'https://player.vimeo.com', 'https://app.sandbox.midtrans.com', 'https://app.midtrans.com'],
        connectSrc: ["'self'", 'https://app.sandbox.midtrans.com', 'https://app.midtrans.com'],
      },
    },
  })
);

// Rate limiting global untuk mencegah flooding/DoS sederhana
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.static(path.join(__dirname, 'public')));

app.use(attachUser);

// Middleware global helper untuk views
app.use((req, res, next) => {
  res.locals.siteName = 'SukaCoding';
  res.locals.currentPath = req.path;
  res.locals.formatRupiah = (num) =>
    'Rp' + Number(num || 0).toLocaleString('id-ID');
  next();
});

// CSRF diterapkan ke semua route form (halaman non-API GET tetap bebas)
app.use(csrfMiddleware);

// ---------- ROUTES ----------
app.use('/', pageRoutes);
app.use('/', authRoutes);
app.use('/', paymentRoutes);
app.use('/admin', adminRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'Halaman Tidak Ditemukan', message: 'Halaman yang Anda cari tidak ada.' });
});

// Error handler terpusat - jangan pernah bocorkan stack trace ke user di production
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).render('error', {
    title: 'Terjadi Kesalahan',
    message: process.env.NODE_ENV === 'production' ? 'Terjadi kesalahan pada server. Silakan coba lagi nanti.' : err.message,
  });
});

// Jaring pengaman terakhir: catat error yang lolos dari semua try/catch supaya
// tidak membuat proses Node crash diam-diam tanpa log (penting untuk uptime production).
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

const PORT = process.env.PORT || 3000;

// Pastikan skema database sudah siap sebelum server mulai menerima request.
// Kalau koneksi database gagal (misal DATABASE_URL salah), server sengaja
// tidak dijalankan sama sekali daripada berjalan tapi semua halaman error.
db.initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`SukaCoding server berjalan di http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Gagal menyiapkan database, server tidak dijalankan:', err.message);
    process.exit(1);
  });
