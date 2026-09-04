const db = require('../db');
const slugify = require('slugify');

async function uniqueSlug(table, text, ignoreId = null) {
  const base = slugify(text, { lower: true, strict: true });
  let slug = base;
  let i = 1;
  while (true) {
    const row = ignoreId
      ? await db.one(`SELECT id FROM ${table} WHERE slug = $1 AND id != $2`, [slug, ignoreId])
      : await db.one(`SELECT id FROM ${table} WHERE slug = $1`, [slug]);
    if (!row) return slug;
    i += 1;
    slug = `${base}-${i}`;
  }
}

// ---------- DASHBOARD ----------
exports.dashboard = async (req, res) => {
  const totalUsers = (await db.one(`SELECT COUNT(*) c FROM users WHERE role = 'customer'`)).c;
  const totalCourses = (await db.one(`SELECT COUNT(*) c FROM courses`)).c;
  const totalEvents = (await db.one(`SELECT COUNT(*) c FROM events`)).c;
  const revenue = (await db.one(`SELECT COALESCE(SUM(amount),0) s FROM orders WHERE status = 'paid'`)).s;
  const totalOrders = (await db.one(`SELECT COUNT(*) c FROM orders WHERE status = 'paid'`)).c;

  const recentOrders = await db.all(
    `SELECT o.*, u.name AS user_name, c.title AS course_title
     FROM orders o
     JOIN users u ON u.id = o.user_id
     JOIN courses c ON c.id = o.course_id
     ORDER BY o.created_at DESC LIMIT 10`
  );

  const popularCourses = await db.all(
    `SELECT c.title, c.slug, COUNT(e.id) AS total_enroll
     FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id
     GROUP BY c.id ORDER BY total_enroll DESC LIMIT 5`
  );

  res.render('admin/dashboard', {
    title: 'Dashboard Admin',
    stats: { totalUsers, totalCourses, totalEvents, revenue, totalOrders },
    recentOrders,
    popularCourses,
  });
};

// ---------- COURSES ----------
exports.listCoursesAdmin = async (req, res) => {
  const courses = await db.all('SELECT * FROM courses ORDER BY created_at DESC');
  res.render('admin/courses', { title: 'Kelola Course', courses });
};

exports.newCourseForm = (req, res) => {
  res.render('admin/course-form', { title: 'Tambah Course', course: null, lessons: [], errors: [] });
};

exports.createCourse = async (req, res) => {
  const { title, short_description, description, category, level, price, access_duration_days, thumbnail, is_published } = req.body;

  if (!title || title.trim().length < 3) {
    return res.status(400).render('admin/course-form', {
      title: 'Tambah Course',
      course: req.body,
      lessons: [],
      errors: [{ msg: 'Judul course wajib diisi minimal 3 karakter.' }],
    });
  }

  const slug = await uniqueSlug('courses', title);
  const result = await db.one(
    `INSERT INTO courses (title, slug, short_description, description, thumbnail, category, level, price, access_duration_days, is_published, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      title.trim(),
      slug,
      short_description || '',
      description || '',
      thumbnail || '',
      category || 'umum',
      level || 'pemula',
      parseInt(price, 10) || 0,
      parseInt(access_duration_days, 10) || 365,
      is_published ? 1 : 0,
      req.user.id,
    ]
  );

  res.redirect(`/admin/courses/${result.id}/edit`);
};

exports.editCourseForm = async (req, res) => {
  const course = await db.one('SELECT * FROM courses WHERE id = $1', [req.params.id]);
  if (!course) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Course tidak ditemukan.' });

  const lessons = await db.all('SELECT * FROM lessons WHERE course_id = $1 ORDER BY order_index ASC, id ASC', [course.id]);
  const promos = await db.all('SELECT * FROM promo_codes WHERE course_id = $1 ORDER BY created_at DESC', [course.id]);

  res.render('admin/course-form', { title: 'Edit Course', course, lessons, promos, errors: [] });
};

exports.updateCourse = async (req, res) => {
  const { title, short_description, description, category, level, price, access_duration_days, thumbnail, is_published } = req.body;
  const course = await db.one('SELECT * FROM courses WHERE id = $1', [req.params.id]);
  if (!course) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Course tidak ditemukan.' });

  const slug = title.trim() !== course.title ? await uniqueSlug('courses', title, course.id) : course.slug;

  await db.query(
    `UPDATE courses SET title=$1, slug=$2, short_description=$3, description=$4, thumbnail=$5, category=$6, level=$7, price=$8, access_duration_days=$9, is_published=$10, updated_at=NOW()
     WHERE id = $11`,
    [
      title.trim(),
      slug,
      short_description || '',
      description || '',
      thumbnail || '',
      category || 'umum',
      level || 'pemula',
      parseInt(price, 10) || 0,
      parseInt(access_duration_days, 10) || 365,
      is_published ? 1 : 0,
      course.id,
    ]
  );

  res.redirect(`/admin/courses/${course.id}/edit`);
};

exports.deleteCourse = async (req, res) => {
  await db.query('DELETE FROM courses WHERE id = $1', [req.params.id]);
  res.redirect('/admin/courses');
};

// ---------- LESSONS (video per section, & setting free/berbayar) ----------
exports.addLesson = async (req, res) => {
  const courseId = req.params.id;
  const { section_title, title, video_url, duration_minutes, order_index, is_free } = req.body;

  if (!title || !video_url) {
    return res.redirect(`/admin/courses/${courseId}/edit`);
  }

  await db.query(
    `INSERT INTO lessons (course_id, section_title, title, video_url, duration_minutes, order_index, is_free)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      courseId,
      section_title || 'Materi',
      title.trim(),
      video_url.trim(),
      parseInt(duration_minutes, 10) || 0,
      parseInt(order_index, 10) || 0,
      is_free ? 1 : 0,
    ]
  );

  res.redirect(`/admin/courses/${courseId}/edit`);
};

exports.updateLesson = async (req, res) => {
  const { section_title, title, video_url, duration_minutes, order_index, is_free } = req.body;
  await db.query(
    `UPDATE lessons SET section_title=$1, title=$2, video_url=$3, duration_minutes=$4, order_index=$5, is_free=$6 WHERE id = $7 AND course_id = $8`,
    [
      section_title || 'Materi',
      title.trim(),
      video_url.trim(),
      parseInt(duration_minutes, 10) || 0,
      parseInt(order_index, 10) || 0,
      is_free ? 1 : 0,
      req.params.lessonId,
      req.params.id,
    ]
  );
  res.redirect(`/admin/courses/${req.params.id}/edit`);
};

exports.deleteLesson = async (req, res) => {
  await db.query('DELETE FROM lessons WHERE id = $1 AND course_id = $2', [req.params.lessonId, req.params.id]);
  res.redirect(`/admin/courses/${req.params.id}/edit`);
};

exports.createPromo = async (req, res) => {
  const { code, discount_type, discount_value, max_uses, starts_at, expires_at } = req.body;
  const courseId = req.params.id;
  const value = parseInt(discount_value, 10);
  if (!code || !['percent', 'fixed'].includes(discount_type) || !value || value < 1 || (discount_type === 'percent' && value > 100)) {
    return res.status(400).redirect(`/admin/courses/${courseId}/edit`);
  }
  await db.query(
    `INSERT INTO promo_codes (course_id, code, discount_type, discount_value, max_uses, starts_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (course_id, code) DO UPDATE SET discount_type=EXCLUDED.discount_type, discount_value=EXCLUDED.discount_value,
       max_uses=EXCLUDED.max_uses, starts_at=EXCLUDED.starts_at, expires_at=EXCLUDED.expires_at, is_active=1`,
    [courseId, code.trim().toUpperCase(), discount_type, value, parseInt(max_uses, 10) || null, starts_at || null, expires_at || null]
  );
  res.redirect(`/admin/courses/${courseId}/edit`);
};

exports.deletePromo = async (req, res) => {
  await db.query('DELETE FROM promo_codes WHERE id = $1 AND course_id = $2', [req.params.promoId, req.params.id]);
  res.redirect(`/admin/courses/${req.params.id}/edit`);
};

// ---------- EVENTS ----------
exports.listEventsAdmin = async (req, res) => {
  const events = await db.all('SELECT * FROM events ORDER BY event_date DESC');
  res.render('admin/events', { title: 'Kelola Event', events });
};

exports.newEventForm = (req, res) => {
  res.render('admin/event-form', { title: 'Tambah Event', event: null, errors: [] });
};

exports.createEvent = async (req, res) => {
  const { title, description, banner_image, event_date, location, is_online, registration_link, is_published } = req.body;

  if (!title || !event_date) {
    return res.status(400).render('admin/event-form', {
      title: 'Tambah Event',
      event: req.body,
      errors: [{ msg: 'Judul dan tanggal event wajib diisi.' }],
    });
  }

  const slug = await uniqueSlug('events', title);
  await db.query(
    `INSERT INTO events (title, slug, description, banner_image, event_date, location, is_online, registration_link, is_published, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      title.trim(),
      slug,
      description || '',
      banner_image || '',
      event_date,
      location || '',
      is_online ? 1 : 0,
      registration_link || '',
      is_published ? 1 : 0,
      req.user.id,
    ]
  );

  res.redirect('/admin/events');
};

exports.editEventForm = async (req, res) => {
  const event = await db.one('SELECT * FROM events WHERE id = $1', [req.params.id]);
  if (!event) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Event tidak ditemukan.' });
  res.render('admin/event-form', { title: 'Edit Event', event, errors: [] });
};

exports.updateEvent = async (req, res) => {
  const { title, description, banner_image, event_date, location, is_online, registration_link, is_published } = req.body;
  const event = await db.one('SELECT * FROM events WHERE id = $1', [req.params.id]);
  if (!event) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Event tidak ditemukan.' });

  const slug = title.trim() !== event.title ? await uniqueSlug('events', title, event.id) : event.slug;

  await db.query(
    `UPDATE events SET title=$1, slug=$2, description=$3, banner_image=$4, event_date=$5, location=$6, is_online=$7, registration_link=$8, is_published=$9 WHERE id=$10`,
    [
      title.trim(),
      slug,
      description || '',
      banner_image || '',
      event_date,
      location || '',
      is_online ? 1 : 0,
      registration_link || '',
      is_published ? 1 : 0,
      event.id,
    ]
  );

  res.redirect('/admin/events');
};

exports.deleteEvent = async (req, res) => {
  await db.query('DELETE FROM events WHERE id = $1', [req.params.id]);
  res.redirect('/admin/events');
};

// ---------- USERS & ORDERS ----------
exports.listUsers = async (req, res) => {
  const users = await db.all('SELECT id, name, email, role, is_active, email_verified, created_at FROM users ORDER BY created_at DESC');
  const courses = await db.all('SELECT id, title FROM courses ORDER BY title ASC');
  res.render('admin/users', { title: 'Kelola Pengguna', users, courses });
};

exports.grantCourse = async (req, res) => {
  const user = await db.one('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
  const course = await db.one('SELECT * FROM courses WHERE id = $1', [req.body.course_id]);
  if (user && user.role !== 'admin' && course) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (course.access_duration_days || 365));
    await db.query(
      `INSERT INTO enrollments (user_id, course_id, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, course_id) DO UPDATE SET expires_at = GREATEST(enrollments.expires_at, EXCLUDED.expires_at)`,
      [user.id, course.id, expiresAt]
    );
  }
  res.redirect('/admin/users');
};

exports.toggleUserActive = async (req, res) => {
  const user = await db.one('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (user && user.role !== 'admin') {
    await db.query('UPDATE users SET is_active = $1 WHERE id = $2', [user.is_active ? 0 : 1, user.id]);
  }
  res.redirect('/admin/users');
};

exports.listOrders = async (req, res) => {
  const orders = await db.all(
    `SELECT o.*, u.name AS user_name, u.email AS user_email, c.title AS course_title
     FROM orders o JOIN users u ON u.id=o.user_id JOIN courses c ON c.id=o.course_id
     ORDER BY o.created_at DESC`
  );
  res.render('admin/orders', { title: 'Riwayat Transaksi', orders });
};
