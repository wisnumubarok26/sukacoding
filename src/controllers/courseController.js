const db = require('../db');

async function getActiveEnrollment(userId, courseId) {
  if (!userId) return null;
  return db.one(
    `SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND expires_at > NOW()`,
    [userId, courseId]
  );
}

exports.listCourses = async (req, res) => {
  const { category, q } = req.query;
  let sql = 'SELECT * FROM courses WHERE is_published = 1';
  const params = [];

  if (category) {
    params.push(category);
    sql += ` AND category = $${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`);
    sql += ` AND (title ILIKE $${params.length} OR short_description ILIKE $${params.length})`;
  }
  sql += ' ORDER BY created_at DESC';

  const courses = await db.all(sql, params);
  const categoriesRows = await db.all('SELECT DISTINCT category FROM courses WHERE is_published = 1');

  res.render('courses', {
    title: 'Semua Course',
    courses,
    categories: categoriesRows.map((c) => c.category),
    activeCategory: category || '',
    q: q || '',
  });
};

exports.courseDetail = async (req, res) => {
  const course = await db.one('SELECT * FROM courses WHERE slug = $1 AND is_published = 1', [req.params.slug]);

  if (!course) {
    return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Course tidak ditemukan.' });
  }

  const lessons = await db.all(
    'SELECT * FROM lessons WHERE course_id = $1 ORDER BY order_index ASC, id ASC',
    [course.id]
  );

  // Kelompokkan lesson per section untuk ditampilkan seperti kurikulum
  const sections = [];
  const sectionMap = {};
  lessons.forEach((lesson) => {
    if (!sectionMap[lesson.section_title]) {
      sectionMap[lesson.section_title] = { title: lesson.section_title, lessons: [] };
      sections.push(sectionMap[lesson.section_title]);
    }
    sectionMap[lesson.section_title].lessons.push(lesson);
  });

  const enrollment = req.user ? await getActiveEnrollment(req.user.id, course.id) : null;
  const hasAccess = !!enrollment;

  res.render('course-detail', {
    title: course.title,
    course,
    sections,
    hasAccess,
    enrollment,
    totalLessons: lessons.length,
    freeLessons: lessons.filter((l) => l.is_free).length,
  });
};

// Menonton video lesson tertentu - validasi akses di server, bukan hanya UI
exports.watchLesson = async (req, res) => {
  const course = await db.one('SELECT * FROM courses WHERE slug = $1', [req.params.slug]);
  if (!course) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Course tidak ditemukan.' });

  const lesson = await db.one('SELECT * FROM lessons WHERE id = $1 AND course_id = $2', [req.params.lessonId, course.id]);
  if (!lesson) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Video tidak ditemukan.' });

  const enrollment = req.user ? await getActiveEnrollment(req.user.id, course.id) : null;
  const isFree = !!lesson.is_free;

  if (!isFree && !enrollment) {
    return res.status(403).render('error', {
      title: 'Konten Terkunci',
      message: 'Video ini hanya untuk pelanggan yang sudah membeli course ini. Silakan lakukan pembayaran terlebih dahulu.',
    });
  }

  const allLessons = await db.all(
    'SELECT id, title, section_title, is_free, order_index FROM lessons WHERE course_id = $1 ORDER BY order_index ASC, id ASC',
    [course.id]
  );

  res.render('watch', {
    title: `${lesson.title} - ${course.title}`,
    course,
    lesson,
    allLessons,
    hasAccess: !!enrollment,
  });
};

exports.getActiveEnrollment = getActiveEnrollment;
