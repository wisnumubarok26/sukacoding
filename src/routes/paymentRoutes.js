const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { requireAuth } = require('../middleware/auth');
const { csrfMiddleware } = require('../middleware/security');
const asyncHandler = require('../utils/asyncHandler');

router.get('/checkout/:slug', requireAuth, asyncHandler(paymentController.checkout));
router.get('/payment/status/:orderCode', requireAuth, asyncHandler(paymentController.paymentStatus));
router.post('/payment/simulate/:orderCode', requireAuth, csrfMiddleware, asyncHandler(paymentController.simulatePayment));

// Webhook dari Midtrans server (tanpa auth cookie, tapi diverifikasi via signature)
router.post('/payment/notification', express.json(), asyncHandler(paymentController.midtransNotification));

module.exports = router;
