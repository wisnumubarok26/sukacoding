const db = require('../db');

exports.home = async (req, res) => {
  const featuredCourses = await db.all('SELECT * FROM courses WHERE is_published = 1 ORDER BY created_at DESC LIMIT 6');

  const upcomingEvents = await db.all(
    `SELECT * FROM events WHERE is_published = 1 AND event_date >= NOW() ORDER BY event_date ASC LIMIT 3`
  );

  const categories = await db.all(
    'SELECT category, COUNT(*) AS total FROM courses WHERE is_published = 1 GROUP BY category'
  );

  res.render('index', { title: 'SukaCoding - Belajar Coding Seru untuk Semua Usia', featuredCourses, upcomingEvents, categories });
};

exports.dashboard = async (req, res) => {
  const enrollments = await db.all(
    `SELECT e.*, c.title, c.slug, c.thumbnail, c.short_description
     FROM enrollments e JOIN courses c ON c.id = e.course_id
     WHERE e.user_id = $1 ORDER BY e.created_at DESC`,
    [req.user.id]
  );

  const now = new Date();
  const active = enrollments.filter((e) => new Date(e.expires_at) > now);
  const expired = enrollments.filter((e) => new Date(e.expires_at) <= now);

  const orders = await db.all(
    `SELECT o.*, c.title AS course_title FROM orders o JOIN courses c ON c.id = o.course_id
     WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 10`,
    [req.user.id]
  );

  res.render('dashboard/student', { title: 'Dashboard Saya', active, expired, orders });
};
