const crypto = require('crypto');

// Implementasi CSRF token ringan (double-submit cookie pattern).
// Setiap sesi mendapat token acak yang harus dikirim balik lewat form/hidden input
// dan dicocokkan dengan cookie. Mencegah Cross-Site Request Forgery.
function csrfMiddleware(req, res, next) {
  let csrfToken = req.cookies['csrf_token'];
  if (!csrfToken) {
    csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf_token', csrfToken, {
      httpOnly: false, // perlu dibaca oleh view untuk dimasukkan ke form
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 6,
    });
  }
  res.locals.csrfToken = csrfToken;

  // Untuk request yang mengubah data, verifikasi token dari body/header cocok dengan cookie
  const methodsToCheck = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (methodsToCheck.includes(req.method)) {
    const sentToken = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
    if (!sentToken || sentToken !== csrfToken) {
      return res.status(403).render('error', {
        title: 'Permintaan Ditolak',
        message: 'Token keamanan tidak valid atau kedaluwarsa. Silakan muat ulang halaman dan coba lagi.',
      });
    }
  }
  next();
}

// Sanitasi input teks dasar untuk mencegah XSS pada field yang akan ditampilkan sebagai HTML.
const xss = require('xss');
function sanitizeBody(fields) {
  return (req, res, next) => {
    fields.forEach((f) => {
      if (typeof req.body[f] === 'string') {
        req.body[f] = xss(req.body[f].trim());
      }
    });
    next();
  };
}

module.exports = { csrfMiddleware, sanitizeBody };
