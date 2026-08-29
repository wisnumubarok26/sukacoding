const crypto = require('crypto');
const db = require('../db');
const { getActiveEnrollment } = require('./courseController');
const { sendPaymentReceiptEmail } = require('../utils/email');

let snap = null;
const midtransEnabled = !!process.env.MIDTRANS_SERVER_KEY;

if (midtransEnabled) {
  const midtransClient = require('midtrans-client');
  snap = new midtransClient.Snap({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY,
  });
}

function generateOrderCode() {
  return 'SC-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Halaman checkout: membuat order baru berstatus pending
exports.checkout = async (req, res) => {
  const course = await db.one('SELECT * FROM courses WHERE slug = $1 AND is_published = 1', [req.params.slug]);
  if (!course) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Course tidak ditemukan.' });

  const existing = await getActiveEnrollment(req.user.id, course.id);
  if (existing) return res.redirect(`/courses/${course.slug}`);

  if (course.price <= 0) {
    // Course gratis: langsung buat enrollment tanpa pembayaran
    await enrollUser(req.user.id, course);
    return res.redirect(`/courses/${course.slug}`);
  }

  const orderCode = generateOrderCode();
  const order = await db.one(
    'INSERT INTO orders (order_code, user_id, course_id, amount, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [orderCode, req.user.id, course.id, course.price, 'pending']
  );

  let snapToken = null;
  let snapError = null;

  if (midtransEnabled) {
    try {
      const parameter = {
        transaction_details: {
          order_id: orderCode,
          gross_amount: course.price,
        },
        customer_details: {
          first_name: req.user.name,
          email: req.user.email,
        },
        item_details: [
          {
            id: `course-${course.id}`,
            price: course.price,
            quantity: 1,
            name: course.title.substring(0, 50),
          },
        ],
        callbacks: {
          finish: `${process.env.BASE_URL}/payment/status/${orderCode}`,
        },
      };
      const transaction = await snap.createTransaction(parameter);
      snapToken = transaction.token;
      await db.query('UPDATE orders SET snap_token = $1 WHERE id = $2', [snapToken, order.id]);
    } catch (err) {
      console.error('Midtrans createTransaction error:', err.message);
      snapError = 'Gagal menghubungi payment gateway. Silakan gunakan mode simulasi atau coba lagi nanti.';
    }
  }

  res.render('checkout', {
    title: 'Checkout',
    course,
    orderCode,
    snapToken,
    snapError,
    midtransEnabled,
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    clientKey: process.env.MIDTRANS_CLIENT_KEY || '',
  });
};

async function enrollUser(userId, course, client = null) {
  const runner = client || db;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (course.access_duration_days || 365));

  await runner.query(
    `INSERT INTO enrollments (user_id, course_id, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, course_id) DO UPDATE SET expires_at = GREATEST(enrollments.expires_at, EXCLUDED.expires_at)`,
    [userId, course.id, expiresAt]
  );

  return expiresAt;
}
exports.enrollUser = enrollUser;

// Endpoint yang dipanggil Midtrans (server-to-server) saat status transaksi berubah.
// Signature diverifikasi agar tidak bisa dipalsukan oleh pihak luar.
exports.midtransNotification = async (req, res) => {
  if (!midtransEnabled) return res.status(400).json({ error: 'Midtrans tidak dikonfigurasi' });

  try {
    const notification = req.body;
    const { order_id, status_code, gross_amount, signature_key } = notification;

    const expectedSignature = crypto
      .createHash('sha512')
      .update(order_id + status_code + gross_amount + process.env.MIDTRANS_SERVER_KEY)
      .digest('hex');

    if (signature_key !== expectedSignature) {
      console.warn(`⚠️ Notifikasi Midtrans ditolak: signature tidak cocok untuk order ${order_id}`);
      return res.status(403).json({ error: 'Invalid signature' });
    }

    const statusResponse = await snap.transaction.notification(notification);
    await processTransactionStatus(
      statusResponse.order_id,
      statusResponse.transaction_status,
      statusResponse.transaction_id,
      statusResponse.payment_type,
      statusResponse.gross_amount
    );

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Notification error:', err.message);
    // Balas 500 supaya Midtrans melakukan retry otomatis notifikasi ini nanti.
    res.status(500).json({ error: 'Gagal memproses notifikasi' });
  }
};

// Fungsi inti pemrosesan status transaksi - dipakai baik oleh webhook Midtrans
// maupun mode simulasi. Dibungkus transaction + row lock (FOR UPDATE) supaya
// aman dari race condition kalau notifikasi yang sama terpanggil lebih dari
// sekali secara bersamaan (Midtrans memang bisa mengirim notifikasi duplikat).
async function processTransactionStatus(orderCode, transactionStatus, transactionId, paymentType, grossAmount) {
  await db.withTransaction(async (client) => {
    const orderRes = await client.query('SELECT * FROM orders WHERE order_code = $1 FOR UPDATE', [orderCode]);
    const order = orderRes.rows[0];

    if (!order) {
      console.error(`❌ Notifikasi diterima untuk order_code yang tidak dikenal: ${orderCode}`);
      return;
    }

    // Idempotensi: kalau order sudah 'paid', jangan diproses ulang (mencegah
    // enrollment dobel / email struk terkirim berkali-kali kalau webhook duplikat).
    if (order.status === 'paid') return;

    if (transactionStatus === 'capture' || transactionStatus === 'settlement') {
      // Validasi jumlah pembayaran harus SAMA PERSIS dengan harga course di database kita,
      // bukan dipercaya begitu saja dari payload luar. Ini mencegah kasus jumlah bayar
      // dimanipulasi (misal orang bayar Rp1 tapi mengklaim sudah lunas Rp150.000).
      const paidAmount = Math.round(parseFloat(grossAmount));
      if (paidAmount !== order.amount) {
        console.error(
          `🚨 MISMATCH JUMLAH PEMBAYARAN pada order ${orderCode}: diharapkan Rp${order.amount}, diterima Rp${paidAmount}. Order ditandai gagal, TIDAK memberi akses.`
        );
        await client.query(`UPDATE orders SET status = 'failed' WHERE id = $1`, [order.id]);
        return;
      }

      await client.query(
        `UPDATE orders SET status = 'paid', transaction_id = $1, payment_method = $2, paid_at = NOW() WHERE id = $3`,
        [transactionId || null, paymentType || null, order.id]
      );

      const courseRes = await client.query('SELECT * FROM courses WHERE id = $1', [order.course_id]);
      const course = courseRes.rows[0];
      await enrollUser(order.user_id, course, client);

      // Kirim email struk SETELAH transaction commit berhasil (di luar callback ini),
      // supaya kalau pengiriman email lambat/gagal, tidak menahan/membatalkan transaction DB.
      const userRes = await client.query('SELECT * FROM users WHERE id = $1', [order.user_id]);
      const user = userRes.rows[0];

      // Kirim secara "fire and forget" tapi tetap ditangani errornya - kegagalan
      // email tidak boleh menggagalkan pembayaran yang sudah sah.
      sendPaymentReceiptEmail(user, { ...order, payment_method: paymentType }, course).catch((e) =>
        console.error('Gagal kirim email struk:', e.message)
      );
    } else if (['deny', 'cancel', 'expire'].includes(transactionStatus)) {
      await client.query(`UPDATE orders SET status = 'failed' WHERE id = $1`, [order.id]);
    }
    // status 'pending' (misal menunggu transfer VA) sengaja tidak diubah -
    // order tetap 'pending' sampai ada notifikasi settlement/expire berikutnya.
  });
}
exports.processTransactionStatus = processTransactionStatus;

// Halaman status setelah user kembali dari Midtrans
exports.paymentStatus = async (req, res) => {
  const order = await db.one(
    `SELECT o.*, c.title AS course_title, c.slug AS course_slug FROM orders o JOIN courses c ON c.id = o.course_id WHERE o.order_code = $1 AND o.user_id = $2`,
    [req.params.orderCode, req.user.id]
  );

  if (!order) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Order tidak ditemukan.' });

  res.render('payment-status', { title: 'Status Pembayaran', order });
};

// MODE SIMULASI: dipakai jika Midtrans belum dikonfigurasi (development/demo),
// supaya alur "sudah bayar -> otomatis dapat akses" tetap bisa dites end-to-end.
exports.simulatePayment = async (req, res) => {
  if (midtransEnabled) {
    return res.status(400).render('error', { title: 'Tidak Diizinkan', message: 'Mode simulasi nonaktif karena payment gateway sudah dikonfigurasi.' });
  }

  const order = await db.one('SELECT * FROM orders WHERE order_code = $1 AND user_id = $2 AND status = $3', [
    req.params.orderCode,
    req.user.id,
    'pending',
  ]);

  if (!order) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Order tidak ditemukan atau sudah diproses.' });

  // Pakai jalur pemrosesan yang SAMA dengan webhook asli (termasuk validasi jumlah
  // & transaction lock) supaya perilaku mode simulasi identik dengan produksi.
  await processTransactionStatus(order.order_code, 'settlement', 'SIMULASI-' + Date.now(), 'simulasi', order.amount);

  res.redirect(`/payment/status/${order.order_code}`);
};
