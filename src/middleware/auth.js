const jwt = require('jsonwebtoken');
const db = require('../db');

// Membaca token dari httpOnly cookie, memverifikasi, lalu menempelkan user ke req.
// Tidak pernah percaya data user dari client tanpa verifikasi ulang ke DB.
async function attachUser(req, res, next) {
  const token = req.cookies && req.cookies.token;
  res.locals.user = null;
  req.user = null;

  if (!token) return next();

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await db.one(
      'SELECT id, name, email, role, is_active, email_verified FROM users WHERE id = $1',
      [payload.id]
    );

    if (user && user.is_active) {
      req.user = user;
      res.locals.user = user;
    }
  } catch (err) {
    // token invalid/expired -> anggap belum login, hapus cookie basi
    res.clearCookie('token');
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ error: 'Silakan login terlebih dahulu.' });
    }
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!roles.includes(req.user.role)) {
      return res.status(403).render('error', {
        title: 'Akses Ditolak',
        message: 'Anda tidak memiliki izin untuk mengakses halaman ini.',
      });
    }
    next();
  };
}

module.exports = { attachUser, requireAuth, requireRole };
