require('dotenv').config();
const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const db = require('../db');

async function seed() {
  await db.initDb();

  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@sukacoding.com').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'UbahPasswordIni123!';
  const adminName = process.env.ADMIN_NAME || 'Admin SukaCoding';

  const existingAdmin = await db.one('SELECT id FROM users WHERE email = $1', [adminEmail]);
  if (!existingAdmin) {
    const hash = await bcrypt.hash(adminPassword, 12);
    // Admin dibuat langsung dengan email_verified = 1 (tidak perlu klik link verifikasi
    // sendiri, karena email admin sudah dipastikan benar oleh pemilik saat setup).
    await db.query(
      `INSERT INTO users (name, email, password_hash, role, email_verified) VALUES ($1, $2, $3, 'admin', 1)`,
      [adminName, adminEmail, hash]
    );
    console.log(`✔ Akun admin dibuat: ${adminEmail} / ${adminPassword} (segera ganti password setelah login!)`);
  } else {
    console.log('ℹ Akun admin sudah ada, dilewati.');
  }

  const admin = await db.one('SELECT id FROM users WHERE email = $1', [adminEmail]);

  const courseCount = (await db.one('SELECT COUNT(*) c FROM courses')).c;
  if (parseInt(courseCount, 10) === 0) {
    const courses = [
      {
        title: 'Scratch untuk Pemula: Bikin Game Pertamamu',
        short_description: 'Belajar logika pemrograman dasar sambil bikin game seru pakai Scratch. Cocok untuk anak-anak & pemula.',
        description: 'Kursus ini mengajarkan dasar-dasar pemrograman menggunakan Scratch, mulai dari mengenal blok kode, membuat animasi karakter, hingga membuat game sederhana. Cocok untuk anak usia 7-12 tahun maupun pemula segala usia.',
        category: 'Scratch',
        level: 'pemula',
        price: 149000,
        access_duration_days: 365,
        lessons: [
          { section_title: 'Pengenalan Scratch', title: 'Mengenal Interface Scratch', video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', is_free: 1, order_index: 1 },
          { section_title: 'Pengenalan Scratch', title: 'Blok Gerakan & Suara', video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', is_free: 1, order_index: 2 },
          { section_title: 'Membuat Game', title: 'Membuat Karakter Bergerak', video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', is_free: 0, order_index: 3 },
          { section_title: 'Membuat Game', title: 'Menambahkan Skor & Nyawa', video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', is_free: 0, order_index: 4 },
        ],
      },
      {
        title: 'Python Dasar: Dari Nol Sampai Bisa Bikin Program',
        short_description: 'Kuasai Python dari dasar: variabel, percabangan, perulangan, hingga fungsi.',
        description: 'Kursus Python komprehensif untuk pemula. Kamu akan belajar sintaks dasar, struktur data, logika program, dan membuat beberapa mini proyek nyata.',
        category: 'Python',
        level: 'pemula',
        price: 199000,
        access_duration_days: 365,
        lessons: [
          { section_title: 'Dasar Python', title: 'Instalasi & Hello World', video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', is_free: 1, order_index: 1 },
          { section_title: 'Dasar Python', title: 'Variabel & Tipe Data', video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', is_free: 1, order_index: 2 },
          { section_title: 'Logika Program', title: 'Percabangan If-Else', video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', is_free: 0, order_index: 3 },
          { section_title: 'Logika Program', title: 'Perulangan For & While', video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', is_free: 0, order_index: 4 },
          { section_title: 'Proyek', title: 'Membuat Aplikasi Kalkulator', video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', is_free: 0, order_index: 5 },
        ],
      },
      {
        title: 'Roblox Studio: Bikin Game Roblox Sendiri',
        short_description: 'Belajar membuat game di Roblox Studio menggunakan Lua, dari dasar sampai publish.',
        description: 'Pelajari cara menggunakan Roblox Studio dan bahasa Lua untuk membuat game yang bisa dimainkan orang lain di Roblox. Termasuk desain map, scripting dasar, hingga monetisasi.',
        category: 'Roblox',
        level: 'menengah',
        price: 249000,
        access_duration_days: 365,
        lessons: [
          { section_title: 'Pengenalan Roblox Studio', title: 'Instalasi & Membuat Map Pertama', video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', is_free: 1, order_index: 1 },
          { section_title: 'Pengenalan Roblox Studio', title: 'Dasar Scripting Lua', video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', is_free: 1, order_index: 2 },
          { section_title: 'Membuat Gameplay', title: 'Membuat Sistem Skor', video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', is_free: 0, order_index: 3 },
          { section_title: 'Membuat Gameplay', title: 'Membuat NPC & Musuh', video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', is_free: 0, order_index: 4 },
        ],
      },
    ];

    for (const c of courses) {
      const slug = slugify(c.title, { lower: true, strict: true });
      const result = await db.one(
        `INSERT INTO courses (title, slug, short_description, description, thumbnail, category, level, price, access_duration_days, is_published, created_by)
         VALUES ($1, $2, $3, $4, '', $5, $6, $7, $8, 1, $9) RETURNING id`,
        [c.title, slug, c.short_description, c.description, c.category, c.level, c.price, c.access_duration_days, admin.id]
      );
      for (const l of c.lessons) {
        await db.query(
          `INSERT INTO lessons (course_id, section_title, title, video_url, is_free, order_index) VALUES ($1, $2, $3, $4, $5, $6)`,
          [result.id, l.section_title, l.title, l.video_url, l.is_free, l.order_index]
        );
      }
    }
    console.log(`✔ ${courses.length} contoh course berhasil dibuat.`);
  }

  const eventCount = (await db.one('SELECT COUNT(*) c FROM events')).c;
  if (parseInt(eventCount, 10) === 0) {
    const future = new Date();
    future.setDate(future.getDate() + 14);

    await db.query(
      `INSERT INTO events (title, slug, description, event_date, location, is_online, registration_link, is_published, created_by)
       VALUES ($1, $2, $3, $4, $5, 1, '', 1, $6)`,
      [
        'Workshop Gratis: Membuat Game Pertama dengan Scratch',
        slugify('Workshop Gratis Membuat Game Pertama dengan Scratch', { lower: true, strict: true }),
        'Ikuti workshop online gratis bersama mentor SukaCoding dan buat game sederhana dalam 90 menit!',
        future,
        'Zoom Online',
        admin.id,
      ]
    );
    console.log('✔ 1 contoh event berhasil dibuat.');
  }

  console.log('Seeding selesai.');
  await db.pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
