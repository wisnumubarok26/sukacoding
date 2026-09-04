const db = require('../db');

function addYoutubeOrigin(videoUrl, origin) {
  try {
    const url = new URL(videoUrl);
    if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname) && url.pathname.startsWith('/embed/')) {
      url.searchParams.set('origin', origin);
    }
    return url.toString();
  } catch {
    return videoUrl;
  }
}

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
    `SELECT l.*, lp.completed_at
     FROM lessons l
     LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = $2
     WHERE l.course_id = $1 ORDER BY l.order_index ASC, l.id ASC`,
    [course.id, req.user ? req.user.id : null]
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
  const completedLessons = lessons.filter((lesson) => lesson.completed_at);
  const nextLesson = lessons.find((lesson) => !lesson.completed_at) || lessons[0] || null;

  res.render('course-detail', {
    title: course.title,
    course,
    sections,
    hasAccess,
    enrollment,
    totalLessons: lessons.length,
    freeLessons: lessons.filter((l) => l.is_free).length,
    completedLessons: completedLessons.length,
    nextLesson,
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
    `SELECT l.id, l.title, l.section_title, l.is_free, l.order_index, lp.completed_at
     FROM lessons l
     LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = $2
     WHERE l.course_id = $1 ORDER BY l.order_index ASC, l.id ASC`,
    [course.id, req.user.id]
  );

  const progress = await db.one(
    'SELECT completed_at FROM lesson_progress WHERE user_id = $1 AND lesson_id = $2',
    [req.user.id, lesson.id]
  );

  res.render('watch', {
    title: `${lesson.title} - ${course.title}`,
    course,
    lesson: { ...lesson, video_url: addYoutubeOrigin(lesson.video_url, `${req.protocol}://${req.get('host')}`) },
    allLessons,
    hasAccess: !!enrollment,
    isCompleted: !!progress,
  });
};

exports.completeLesson = async (req, res) => {
  const lesson = await db.one(
    'SELECT l.id, l.is_free, c.id AS course_id FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = $1 AND c.slug = $2',
    [req.params.lessonId, req.params.slug]
  );

  if (!lesson) {
    return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Video tidak ditemukan.' });
  }

  if (!lesson.is_free && !(await getActiveEnrollment(req.user.id, lesson.course_id))) {
    return res.status(403).render('error', {
      title: 'Konten Terkunci',
      message: 'Video ini hanya dapat ditandai selesai oleh pelanggan yang memiliki akses course.',
    });
  }

  await db.query(
    `INSERT INTO lesson_progress (user_id, lesson_id) VALUES ($1, $2)
     ON CONFLICT (user_id, lesson_id) DO UPDATE SET completed_at = NOW()`,
    [req.user.id, lesson.id]
  );

  res.redirect(`/courses/${req.params.slug}/watch/${lesson.id}`);
};

exports.certificate = async (req, res) => {
  const course = await db.one('SELECT * FROM courses WHERE slug = $1 AND is_published = 1', [req.params.slug]);
  if (!course) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Course tidak ditemukan.' });

  const completion = await db.one(
    `SELECT COUNT(l.id)::INTEGER AS total_lessons, COUNT(lp.lesson_id)::INTEGER AS completed_lessons,
       MAX(lp.completed_at) AS completed_at
     FROM lessons l LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = $2
     WHERE l.course_id = $1`,
    [course.id, req.user.id]
  );
  if (!completion.total_lessons || completion.completed_lessons !== completion.total_lessons) {
    return res.status(403).render('error', { title: 'Belum Selesai', message: 'Selesaikan semua video course terlebih dahulu untuk mendapatkan sertifikat.' });
  }

  res.render('certificate', {
    title: `Sertifikat - ${course.title}`,
    course,
    user: req.user,
    certificateNumber: `SC-${course.id}-${req.user.id}`,
    completedAt: completion.completed_at,
    instructorName: process.env.INSTRUCTOR_NAME || 'Muhamad Wisnu Mubarok',
  });
};

exports.getActiveEnrollment = getActiveEnrollment;
