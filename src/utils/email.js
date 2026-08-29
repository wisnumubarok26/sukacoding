const nodemailer = require('nodemailer');

const emailEnabled = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let transporter = null;
if (emailEnabled) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
} else {
  console.warn(
    '⚠️  SMTP belum dikonfigurasi (.env). Email verifikasi & struk pembayaran TIDAK akan terkirim, hanya dicatat di log server. Isi SMTP_HOST/SMTP_USER/SMTP_PASS untuk mengaktifkan.'
  );
}

const FROM = process.env.EMAIL_FROM || '"SukaCoding" <no-reply@sukacoding.com>';

async function sendMail({ to, subject, html }) {
  if (!emailEnabled) {
    // Mode fallback development: tidak mengirim email sungguhan, cukup dicatat di log
    // supaya alur tetap bisa dites tanpa perlu setup SMTP asli.
    console.log(`\n📧 [EMAIL SIMULASI] Ke: ${to}\nSubjek: ${subject}\n${html.replace(/<[^>]+>/g, ' ').slice(0, 300)}...\n`);
    return { simulated: true };
  }

  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    return { simulated: false };
  } catch (err) {
    // Kegagalan kirim email TIDAK BOLEH menggagalkan proses utama (misal pembayaran).
    // Cukup dicatat sebagai error supaya bisa ditindaklanjuti manual oleh admin.
    console.error(`❌ Gagal mengirim email ke ${to}:`, err.message);
    return { simulated: false, error: err.message };
  }
}

function baseTemplate(title, bodyHtml) {
  return `
  <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <h2 style="color: #2645e6;">SukaCoding</h2>
    <h3>${title}</h3>
    ${bodyHtml}
    <p style="color: #94a3b8; font-size: 12px; margin-top: 32px;">Email ini dikirim otomatis oleh sistem SukaCoding. Jika Anda merasa tidak melakukan aksi ini, abaikan email ini.</p>
  </div>`;
}

async function sendVerificationEmail(user, token) {
  const link = `${process.env.BASE_URL}/verify-email?token=${token}`;
  const html = baseTemplate(
    'Verifikasi Email Anda',
    `<p>Halo ${user.name},</p>
     <p>Terima kasih sudah mendaftar di SukaCoding. Klik tombol di bawah untuk mengaktifkan akun Anda:</p>
     <p><a href="${link}" style="display:inline-block;background:#2645e6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Verifikasi Email</a></p>
     <p>Atau salin link berikut ke browser: <br/>${link}</p>
     <p>Link ini berlaku selama 24 jam.</p>`
  );
  return sendMail({ to: user.email, subject: 'Verifikasi Email SukaCoding Anda', html });
}

async function sendPaymentReceiptEmail(user, order, course) {
  const formatRupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const html = baseTemplate(
    'Pembayaran Berhasil ✅',
    `<p>Halo ${user.name},</p>
     <p>Pembayaran Anda untuk course berikut telah kami terima:</p>
     <table style="width:100%; border-collapse:collapse; margin:16px 0;">
       <tr><td style="padding:6px 0;color:#64748b;">Kode Order</td><td style="padding:6px 0; text-align:right;"><b>${order.order_code}</b></td></tr>
       <tr><td style="padding:6px 0;color:#64748b;">Course</td><td style="padding:6px 0; text-align:right;">${course.title}</td></tr>
       <tr><td style="padding:6px 0;color:#64748b;">Jumlah</td><td style="padding:6px 0; text-align:right;"><b>${formatRupiah(order.amount)}</b></td></tr>
       <tr><td style="padding:6px 0;color:#64748b;">Metode</td><td style="padding:6px 0; text-align:right;">${order.payment_method || '-'}</td></tr>
     </table>
     <p>Akses course Anda sudah aktif. Selamat belajar!</p>
     <p><a href="${process.env.BASE_URL}/courses/${course.slug}" style="display:inline-block;background:#2645e6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Mulai Belajar</a></p>`
  );
  return sendMail({ to: user.email, subject: `Struk Pembayaran - ${order.order_code}`, html });
}

module.exports = { sendVerificationEmail, sendPaymentReceiptEmail, emailEnabled };
