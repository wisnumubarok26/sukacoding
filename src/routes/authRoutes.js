const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const router = express.Router();
const authController = require('../controllers/authController');
const { sanitizeBody } = require('../middleware/security');
const asyncHandler = require('../utils/asyncHandler');

// Rate limit khusus login & register untuk mencegah brute-force / spam akun
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Terlalu banyak percobaan. Silakan coba lagi dalam beberapa menit.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/register', authController.showRegister);
router.post(
  '/register',
  authLimiter,
  sanitizeBody(['name', 'email']),
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Nama minimal 2 karakter.'),
    body('email').isEmail().withMessage('Email tidak valid.').normalizeEmail(),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password minimal 8 karakter.')
      .matches(/\d/)
      .withMessage('Password harus mengandung minimal 1 angka.'),
  ],
  asyncHandler(authController.register)
);

router.get('/verify-email', asyncHandler(authController.verifyEmail));
router.post('/resend-verification', authLimiter, asyncHandler(authController.resendVerification));

router.get('/login', authController.showLogin);
router.post('/login', authLimiter, sanitizeBody(['email']), asyncHandler(authController.login));

router.post('/logout', authController.logout);
router.get('/logout', authController.logout);

module.exports = router;
