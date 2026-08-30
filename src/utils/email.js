const emailEnabled = !!process.env.RESEND_API_KEY;

if (!emailEnabled) {
  console.warn(
    'RESEND_API_KEY belum dikonfigurasi di .env. Email verifikasi & struk pembayaran TIDAK akan terkirim, hanya dicatat di log server.'
  );
}

const FROM = process.env.EMAIL_FROM || 'SukaCoding <onboarding@resend.dev>';

async function sendMail({ to, subject, html }) {
  if (!emailEnabled) {
    // Mode fallback development: tidak mengirim email sungguhan, cukup dicatat di log
    // supaya alur tetap bisa dites tanpa perlu setup API key Resend.
    console.log(`\n[EMAIL SIMULASI] Ke: ${to}\nSubjek: ${subject}\n${html.replace(/<[^>]+>/g, ' ').slice(0, 300)}...\n`);
    return { simulated: true };
  }

  try {
    if (typeof fetch !== 'function') {
      throw new Error('Runtime Node ini tidak mendukung fetch global; gunakan Node 18+ untuk Resend API.');
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject,
        html,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data?.message || `Resend API error (${response.status})`);
    }

    return { simulated: false, id: data.id || null };
  } catch (err) {
    // Kegagalan kirim email TIDAK BOLEH menggagalkan proses utama (misal pembayaran).
    // Cukup dicatat sebagai error supaya bisa ditindaklanjuti manual oleh admin.
    console.error(`Gagal mengirim email ke ${to}:`, err.message);
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

async function sendPasswordResetEmail(user, token) {
  const link = `${process.env.BASE_URL}/reset-password?token=${token}`;
  const html = baseTemplate(
    'Reset Password Anda',
    `<p>Halo ${user.name},</p>
     <p>Anda menerima email ini karena ada permintaan untuk mengatur ulang password akun SukaCoding Anda.</p>
     <p>Untuk membuat password baru, klik tombol di bawah:</p>
     <p><a href="${link}" style="display:inline-block;background:#2645e6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Reset Password</a></p>
     <p>Atau salin link berikut ke browser: <br/>${link}</p>
     <p>Link ini berlaku selama 1 jam.</p>`
  );
  return sendMail({ to: user.email, subject: 'Reset Password Akun SukaCoding Anda', html });
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
    'Pembayaran Berhasil',
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

module.exports = { sendVerificationEmail, sendPaymentReceiptEmail, sendPasswordResetEmail, emailEnabled };
