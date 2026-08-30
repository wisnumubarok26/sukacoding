const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const db = require('../db');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 hari
};

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
}

function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

exports.showRegister = (req, res) => {
  res.render('register', { title: 'Daftar Akun', errors: [], old: {} });
};

exports.register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).render('register', {
      title: 'Daftar Akun',
      errors: errors.array(),
      old: req.body,
    });
  }

  const { name, email, password } = req.body;
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await db.one('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (existing) {
    return res.status(400).render('register', {
      title: 'Daftar Akun',
      errors: [{ msg: 'Email sudah terdaftar. Silakan login.' }],
      old: req.body,
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const verificationToken = generateVerificationToken();
  const tokenExpires = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 jam

  const created = await db.one(
    `INSERT INTO users (name, email, password_hash, role, email_verified, verification_token, verification_token_expires)
     VALUES ($1, $2, $3, 'customer', 0, $4, $5) RETURNING id, name, email`,
    [name.trim(), normalizedEmail, passwordHash, verificationToken, tokenExpires]
  );

  // Kirim email verifikasi. Kegagalan kirim email TIDAK menggagalkan pendaftaran -
  // pengguna tetap bisa minta kirim ulang lewat halaman "cek email".
  await sendVerificationEmail(created, verificationToken);

  res.render('verify-email-sent', { title: 'Verifikasi Email Anda', email: created.email });
};

exports.verifyEmail = async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).render('verify-email-result', {
      title: 'Verifikasi Gagal',
      success: false,
      message: 'Link verifikasi tidak valid.',
    });
  }

  const user = await db.one(
    `SELECT id, verification_token_expires FROM users WHERE verification_token = $1 AND email_verified = 0`,
    [token]
  );

  if (!user) {
    return res.status(400).render('verify-email-result', {
      title: 'Verifikasi Gagal',
      success: false,
      message: 'Link verifikasi tidak valid atau akun sudah terverifikasi sebelumnya.',
    });
  }

  if (new Date(user.verification_token_expires) < new Date()) {
    return res.status(400).render('verify-email-result', {
      title: 'Link Kedaluwarsa',
      success: false,
      message: 'Link verifikasi sudah kedaluwarsa. Silakan minta kirim ulang di halaman login.',
    });
  }

  await db.query(
    `UPDATE users SET email_verified = 1, verification_token = NULL, verification_token_expires = NULL WHERE id = $1`,
    [user.id]
  );

  res.render('verify-email-result', {
    title: 'Verifikasi Berhasil',
    success: true,
    message: 'Email Anda berhasil diverifikasi. Silakan login untuk mulai belajar.',
  });
};

exports.resendVerification = async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  const genericMessage = 'Jika email tersebut terdaftar dan belum terverifikasi, kami sudah mengirim ulang link verifikasi.';

  const user = await db.one('SELECT * FROM users WHERE email = $1 AND email_verified = 0', [email]);

  if (user) {
    const verificationToken = generateVerificationToken();
    const tokenExpires = new Date(Date.now() + 1000 * 60 * 60 * 24);
    await db.query(
      'UPDATE users SET verification_token = $1, verification_token_expires = $2 WHERE id = $3',
      [verificationToken, tokenExpires, user.id]
    );
    await sendVerificationEmail(user, verificationToken);
  }

  // Pesan yang sama ditampilkan baik email ditemukan maupun tidak,
  // supaya orang luar tidak bisa menebak-nebak email mana yang terdaftar.
  res.render('verify-email-sent', { title: 'Verifikasi Email Anda', email, resendMessage: genericMessage });
};

exports.showForgotPassword = (req, res) => {
  res.render('forgot-password', {
    title: 'Lupa Password',
    errors: [],
    email: '',
    successMessage: '',
  });
};

exports.forgotPassword = async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();

  if (!email) {
    return res.status(400).render('forgot-password', {
      title: 'Lupa Password',
      errors: [{ msg: 'Email wajib diisi.' }],
      email: '',
      successMessage: '',
    });
  }

  const userRes = await db.query('SELECT id, name, email, is_active FROM users WHERE email = $1', [email]);
  const user = userRes.rows[0];

  if (user && Number(user.is_active) === 1) {
    const resetToken = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60);

    await db.query(
      'UPDATE users SET reset_password_token = $1, reset_password_token_expires = $2 WHERE id = $3',
      [resetToken, expiresAt, user.id]
    );

    await sendPasswordResetEmail(user, resetToken);
  }

  res.render('forgot-password', {
    title: 'Lupa Password',
    errors: [],
    email,
    successMessage: 'Jika email tersebut terdaftar, kami sudah mengirim link reset password. Silakan cek inbox atau folder spam.',
  });
};

exports.showResetPassword = async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).render('verify-email-result', {
      title: 'Reset Password Gagal',
      success: false,
      message: 'Token reset password tidak valid.',
    });
  }

  const userRes = await db.query(
    `SELECT id, reset_password_token_expires FROM users WHERE reset_password_token = $1 AND is_active = 1`,
    [token]
  );
  const user = userRes.rows[0];

  if (!user) {
    return res.status(400).render('verify-email-result', {
      title: 'Reset Password Gagal',
      success: false,
      message: 'Token reset password tidak valid atau sudah kedaluwarsa.',
    });
  }

  if (new Date(user.reset_password_token_expires) < new Date()) {
    return res.status(400).render('verify-email-result', {
      title: 'Token Kedaluwarsa',
      success: false,
      message: 'Link reset password sudah kedaluwarsa. Silakan ajukan permintaan baru.',
    });
  }

  res.render('reset-password', {
    title: 'Buat Password Baru',
    errors: [],
    token,
  });
};

exports.resetPassword = async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).render('reset-password', {
      title: 'Buat Password Baru',
      errors: [{ msg: 'Token dan password baru wajib diisi.' }],
      token: token || '',
    });
  }

  if (password.length < 8 || !/\d/.test(password)) {
    return res.status(400).render('reset-password', {
      title: 'Buat Password Baru',
      errors: [{ msg: 'Password minimal 8 karakter dan mengandung angka.' }],
      token,
    });
  }

  const userRes = await db.query(
    `SELECT id, reset_password_token_expires FROM users WHERE reset_password_token = $1 AND is_active = 1`,
    [token]
  );
  const user = userRes.rows[0];

  if (!user) {
    return res.status(400).render('verify-email-result', {
      title: 'Reset Password Gagal',
      success: false,
      message: 'Token reset password tidak valid atau sudah digunakan.',
    });
  }

  if (new Date(user.reset_password_token_expires) < new Date()) {
    return res.status(400).render('verify-email-result', {
      title: 'Token Kedaluwarsa',
      success: false,
      message: 'Link reset password sudah kedaluwarsa. Silakan ajukan permintaan baru.',
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await db.query(
    `UPDATE users SET password_hash = $1, reset_password_token = NULL, reset_password_token_expires = NULL WHERE id = $2`,
    [passwordHash, user.id]
  );

  res.render('verify-email-result', {
    title: 'Password Berhasil Direset',
    success: true,
    message: 'Password Anda berhasil diperbarui. Silakan login dengan password baru.',
  });
};

exports.showLogin = (req, res) => {
  res.render('login', { title: 'Masuk', errors: [], old: {}, next: req.query.next || '', unverifiedEmail: null, successMessage: req.query.reset === 'success' ? 'Password berhasil diperbarui. Silakan login.' : '' });
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  const next = req.body.next || '/dashboard';
  const passwordError = [{ msg: 'Password salah. Silakan cek kembali password Anda.' }];

  if (!email || !password) {
    return res.status(400).render('login', {
      title: 'Masuk',
      errors: passwordError,
      old: req.body,
      next,
      unverifiedEmail: null,
      successMessage: '',
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const userRes = await db.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
  const user = userRes.rows[0];

  let validPassword = false;
  if (user) {
    validPassword = await bcrypt.compare(password, user.password_hash);
  }

  if (!user || !validPassword || !user.is_active) {
    return res.status(400).render('login', {
      title: 'Masuk',
      errors: passwordError,
      old: req.body,
      next,
      unverifiedEmail: null,
      successMessage: '',
    });
  }

  if (!user.email_verified) {
    return res.status(403).render('login', {
      title: 'Masuk',
      errors: [{ msg: 'Email Anda belum diverifikasi. Silakan cek inbox/spam email Anda, atau minta kirim ulang di bawah.' }],
      old: req.body,
      next,
      unverifiedEmail: normalizedEmail,
      successMessage: '',
    });
  }

  const token = signToken(user);
  res.cookie('token', token, COOKIE_OPTS);

  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  res.redirect(safeNext);
};

exports.logout = (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
};
