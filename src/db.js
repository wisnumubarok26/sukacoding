const { Pool } = require('pg');

// Pool koneksi ke PostgreSQL. DATABASE_URL disediakan otomatis oleh kebanyakan
// platform hosting (Railway, Render, Neon, dll) - format:
// postgres://user:password@host:port/database
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL belum diset di .env. Lihat .env.example untuk contoh.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  // Sebagian besar penyedia Postgres cloud (Neon, Render, dsb) mewajibkan SSL.
  // Untuk Postgres lokal (development), SSL biasanya tidak diperlukan.
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
});

pool.on('error', (err) => {
  console.error('Unexpected error pada idle client PostgreSQL', err);
});

// Helper query terpusat. SEMUA akses database di aplikasi ini WAJIB lewat
// fungsi ini dengan parameterized query ($1, $2, ...) - TIDAK PERNAH
// menggabungkan input pengguna langsung ke dalam string SQL. Ini mencegah SQL Injection.
async function query(text, params = []) {
  return pool.query(text, params);
}

// Ambil 1 baris saja (mirip .get() di better-sqlite3), atau null kalau kosong.
async function one(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows[0] || null;
}

// Ambil semua baris (mirip .all() di better-sqlite3).
async function all(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

// Menjalankan beberapa query dalam SATU transaction dengan lock baris (FOR UPDATE)
// - dipakai khusus untuk alur pembayaran supaya tidak terjadi race condition
// (misal notifikasi Midtrans terpanggil 2x bersamaan lalu mengaktifkan enrollment 2x).
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('admin','customer')),
  is_active INTEGER NOT NULL DEFAULT 1,
  email_verified INTEGER NOT NULL DEFAULT 0,
  verification_token TEXT,
  verification_token_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  short_description TEXT,
  description TEXT,
  thumbnail TEXT,
  category TEXT NOT NULL DEFAULT 'umum',
  level TEXT NOT NULL DEFAULT 'pemula',
  price INTEGER NOT NULL DEFAULT 0,
  access_duration_days INTEGER NOT NULL DEFAULT 365,
  is_published INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lessons (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  section_title TEXT NOT NULL DEFAULT 'Materi',
  title TEXT NOT NULL,
  video_url TEXT NOT NULL,
  duration_minutes INTEGER DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0,
  is_free INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS enrollments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, course_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','failed','expired')),
  payment_method TEXT,
  transaction_id TEXT,
  snap_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  banner_image TEXT,
  event_date TIMESTAMPTZ NOT NULL,
  location TEXT,
  is_online INTEGER NOT NULL DEFAULT 1,
  registration_link TEXT,
  is_published INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lessons_course ON lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token);
`;

async function initDb() {
  await pool.query(schema);
  console.log('✔ Skema database PostgreSQL siap.');
}

module.exports = { pool, query, one, all, withTransaction, initDb };
