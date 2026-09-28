const nodemailer = require('nodemailer');
const { jsonResponse } = require('./_supabase');

const CONTACT_RECIPIENT = 'mnaveedca888@gmail.com';

exports.handler = async event => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, message: 'Method not allowed.' });
  }

  let payload = {};
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    payload = {};
  }

  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim();
  const subject = String(payload.subject || '').trim();
  const message = String(payload.message || '').trim();

  if (!name || !email || !subject || !message) {
    return jsonResponse(400, { ok: false, message: 'Name, email, subject, and message are required.' });
  }

  if (name.length > 120 || subject.length > 200 || message.length > 5000 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse(400, { ok: false, message: 'Please provide valid contact information.' });
  }

  const gmailUser = String(process.env.GMAIL_USER || '').trim();
  const gmailAppPassword = String(process.env.GMAIL_APP_PASSWORD || '').trim();

  if (!gmailUser || !gmailAppPassword) {
    return jsonResponse(503, { ok: false, message: 'Unable to send your message.' });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailAppPassword
      }
    });

    await transporter.sendMail({
      from: gmailUser,
      to: CONTACT_RECIPIENT,
      replyTo: email,
      subject: `[BlogSphere Contact] ${subject.replace(/[\r\n]+/g, ' ')}`,
      text: `Visitor name: ${name}\nVisitor email: ${email}\nSubject: ${subject}\nSubmitted: ${new Date().toISOString()}\n\nMessage:\n${message}`
    });

    return jsonResponse(200, { ok: true, message: 'Your message has been sent successfully.' });
  } catch (error) {
    console.error('Contact email delivery failed:', error.message);
    return jsonResponse(502, { ok: false, message: 'Unable to send your message.' });
  }
};
