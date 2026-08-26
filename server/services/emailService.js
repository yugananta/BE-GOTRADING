// server/services/emailService.js
// Layanan pengiriman email notifikasi transaksional untuk validasi akun & event penting lainnya.
// Mendukung SMTP jika kredensial diisi di environment variable, serta logging & in-app notification fallback.

import nodemailer from 'nodemailer';
import { ADMIN_FRONTEND_URL } from '../config/env.js';

const SMTP_HOST = process.env.SMTP_HOST || process.env.MAIL_HOST || null;
const SMTP_PORT = Number(process.env.SMTP_PORT || process.env.MAIL_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || process.env.MAIL_USER || null;
const SMTP_PASS = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || process.env.MAIL_PASS || null;
const SMTP_FROM = process.env.SMTP_FROM || process.env.MAIL_FROM || 'GoTrading <noreply@gotrading.id>';
const ADMIN_NOTIFICATION_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL || 'admin@gotrading.id';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    try {
      transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      });
      console.log(`[EMAIL] SMTP Transporter configured (${SMTP_HOST}:${SMTP_PORT})`);
    } catch (err) {
      console.warn('[EMAIL] Failed to initialize SMTP transporter:', err.message);
    }
  }
  return transporter;
}

/**
 * Mengirim email dengan graceful fallback
 */
export async function sendEmail({ to, subject, html, text }) {
  const mailTransporter = getTransporter();
  if (mailTransporter) {
    try {
      const info = await mailTransporter.sendMail({
        from: SMTP_FROM,
        to,
        subject,
        text,
        html,
      });
      console.log(`[EMAIL] Email sent to ${to} (Message ID: ${info.messageId})`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error(`[EMAIL] Failed to send email to ${to}:`, err.message);
      return { success: false, error: err.message };
    }
  } else {
    // Mode log simulasi / dev
    console.log(`\n================== [TRANSACTIONAL EMAIL] ==================`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body (Text): \n${text}`);
    console.log(`===========================================================\n`);
    return { success: true, simulated: true };
  }
}

/**
 * Notifikasi ke Admin: Ada pengajuan validasi akun MT5 baru
 */
export async function sendAdminNewValidationNotification({ validation, adminEmails = [] }) {
  const adminUrl = ADMIN_FRONTEND_URL && ADMIN_FRONTEND_URL !== '*'
    ? `${ADMIN_FRONTEND_URL}/validations`
    : 'https://admin.gotrading.id/validations';

  const recipients = Array.from(new Set([ADMIN_NOTIFICATION_EMAIL, ...adminEmails].filter(Boolean)));
  const subject = `[GoTrading Admin] Pengajuan Validasi Akun MT5 Baru: ${validation.mt5_account_number || validation.mt5AccountNumber}`;

  const fullName = validation.full_name || validation.fullName || 'Trader GoTrading';
  const email = validation.email;
  const mt5Account = validation.mt5_account_number || validation.mt5AccountNumber;
  const submissionDate = new Date(validation.created_at || Date.now()).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  const text = `
Halo Admin GoTrading,

Terdapat pengajuan validasi akun MT5 baru yang memerlukan review:
- Nama Lengkap: ${fullName}
- Email: ${email}
- Nomor Akun MT5: ${mt5Account}
- Waktu Pengajuan: ${submissionDate} WIB

Silakan buka Admin Panel untuk menyetujui atau menolak:
${adminUrl}

Salam,
Sistem Notifikasi GoTrading
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f7; margin: 0; padding: 20px; color: #1e293b; }
    .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    .header { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 16px; border-bottom: 2px solid #f1f5f9; padding-bottom: 12px; }
    .info-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .info-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    .info-label { color: #64748b; font-weight: 600; width: 40%; }
    .info-value { color: #0f172a; font-weight: 600; }
    .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; margin-top: 16px; text-align: center; }
    .footer { font-size: 12px; color: #94a3b8; margin-top: 24px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">Pengajuan Validasi Akun MT5 Baru</div>
    <p style="font-size: 14px; line-height: 1.6; color: #334155;">
      Ada pengajuan validasi akun MT5 baru yang masuk ke sistem dan menunggu verifikasi admin.
    </p>
    <table class="info-table">
      <tr>
        <td class="info-label">Nama Lengkap</td>
        <td class="info-value">${fullName}</td>
      </tr>
      <tr>
        <td class="info-label">Email Trader</td>
        <td class="info-value">${email}</td>
      </tr>
      <tr>
        <td class="info-label">Nomor Akun MT5</td>
        <td class="info-value" style="color: #2563eb; font-size: 16px;">${mt5Account}</td>
      </tr>
      <tr>
        <td class="info-label">Waktu Pengajuan</td>
        <td class="info-value">${submissionDate} WIB</td>
      </tr>
    </table>
    <div style="text-align: center; margin-top: 24px;">
      <a href="${adminUrl}" class="btn" target="_blank">Buka Admin Panel Validasi</a>
    </div>
    <div class="footer">
      Email otomatis dikirim oleh GoTrading Security & IB Management System.
    </div>
  </div>
</body>
</html>
  `.trim();

  for (const to of recipients) {
    await sendEmail({ to, subject, text, html });
  }
}

/**
 * Notifikasi ke User: Validasi Akun MT5 Disetujui
 */
export async function sendUserValidationApprovedNotification({ validation }) {
  const to = validation.email;
  if (!to) return;

  const fullName = validation.full_name || validation.fullName || 'Trader';
  const mt5Account = validation.mt5_account_number || validation.mt5AccountNumber;
  const subject = `[GoTrading] Selamat! Akun MT5 ${mt5Account} Berhasil Divalidasi`;

  const text = `
Halo ${fullName},

Selamat! Pengajuan validasi akun MT5 Anda dengan nomor ${mt5Account} telah DISETUJUI oleh Tim GoTrading.

Akun MT5 Anda kini telah terkonfirmasi berada di bawah naungan IB GoTrading. Anda dapat langsung melanjutkan untuk menghubungkan akun MT5 (Connect Akun) di dashboard GoTrading Anda:
https://my.gotrading.id/accounts

Terima kasih telah bergabung bersama GoTrading!

Salam hangat,
Tim GoTrading Indonesia
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #1e293b; }
    .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    .badge { display: inline-block; background-color: #dcfce7; color: #166534; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 9999px; margin-bottom: 12px; }
    .header { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 16px; }
    .btn { display: inline-block; background-color: #16a34a; color: #ffffff !important; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; margin-top: 20px; }
    .footer { font-size: 12px; color: #94a3b8; margin-top: 24px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">VALIDASI DISETUJUI</div>
    <div class="header">Akun MT5 Anda Siap Dihubungkan!</div>
    <p style="font-size: 15px; line-height: 1.6; color: #334155;">
      Halo <strong>${fullName}</strong>,
    </p>
    <p style="font-size: 14px; line-height: 1.6; color: #334155;">
      Selamat! Akun MT5 Anda dengan nomor <strong>${mt5Account}</strong> telah berhasil diverifikasi dan terdaftar di bawah jaringan IB GoTrading.
    </p>
    <p style="font-size: 14px; line-height: 1.6; color: #334155;">
      Sekarang Anda dapat menghubungkan akun MT5 Anda secara aman untuk melihat portofolio analitik, performa trading real-time, dan fitur eksklusif lainnya.
    </p>
    <div style="text-align: center;">
      <a href="https://my.gotrading.id/accounts" class="btn" target="_blank">Hubungkan Akun Sekarang</a>
    </div>
    <div class="footer">
      Ada pertanyaan? Hubungi kami via support GoTrading.<br>
      © ${new Date().getFullYear()} GoTrading Indonesia. All rights reserved.
    </div>
  </div>
</body>
</html>
  `.trim();

  await sendEmail({ to, subject, text, html });
}

/**
 * Notifikasi ke User: Validasi Akun MT5 Ditolak
 */
export async function sendUserValidationRejectedNotification({ validation, reason }) {
  const to = validation.email;
  if (!to) return;

  const fullName = validation.full_name || validation.fullName || 'Trader';
  const mt5Account = validation.mt5_account_number || validation.mt5AccountNumber;
  const rejectReason = reason || validation.rejection_reason || 'Nomor akun MT5 tidak terdaftar di bawah IB GoTrading.';
  const subject = `[GoTrading] Informasi Status Validasi Akun MT5: ${mt5Account}`;

  const text = `
Halo ${fullName},

Terima kasih telah mengajukan validasi akun MT5 di GoTrading.

Mohon maaf, pengajuan validasi akun MT5 Anda dengan nomor ${mt5Account} saat ini BELUM DAPAT DISETUJUI dengan alasan:
"${rejectReason}"

Pastikan akun MT5 Anda dibuka melalui link resmi IB GoTrading. Anda dapat membuka akun baru atau mengajukan validasi ulang setelah memeriksa kembali data akun Anda:
https://my.gotrading.id/validation

Salam,
Tim GoTrading Indonesia
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #1e293b; }
    .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    .badge { display: inline-block; background-color: #fee2e2; color: #991b1b; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 9999px; margin-bottom: 12px; }
    .header { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 16px; }
    .reason-box { background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 16px; border-radius: 4px; margin: 16px 0; font-size: 14px; color: #7f1d1d; }
    .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; margin-top: 16px; }
    .footer { font-size: 12px; color: #94a3b8; margin-top: 24px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">VALIDASI BELUM DISETUJUI</div>
    <div class="header">Pengajuan Validasi Akun MT5</div>
    <p style="font-size: 14px; line-height: 1.6; color: #334155;">
      Halo <strong>${fullName}</strong>,
    </p>
    <p style="font-size: 14px; line-height: 1.6; color: #334155;">
      Pengajuan validasi untuk akun MT5 nomor <strong>${mt5Account}</strong> belum dapat disetujui karena:
    </p>
    <div class="reason-box">
      <strong>Alasan:</strong> ${rejectReason}
    </div>
    <p style="font-size: 14px; line-height: 1.6; color: #334155;">
      Pastikan Anda mendaftar melalui link pendaftaran akun live resmi IB GoTrading agar akun otomatis terdaftar dalam sistem.
    </p>
    <div style="text-align: center;">
      <a href="https://my.gotrading.id/validation" class="btn" target="_blank">Ajukan Validasi Ulang</a>
    </div>
    <div class="footer">
      Ada pertanyaan? Hubungi customer support kami.<br>
      © ${new Date().getFullYear()} GoTrading Indonesia.
    </div>
  </div>
</body>
</html>
  `.trim();

  await sendEmail({ to, subject, text, html });
}
