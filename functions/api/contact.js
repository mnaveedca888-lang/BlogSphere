import nodemailer from 'nodemailer';

const CONTACT_RECIPIENT = 'admin@blogsphere.info';
const MAX_LENGTHS = {
  name: 120,
  email: 254,
  subject: 200,
  queryType: 60,
  article: 500,
  message: 5000
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json'
    }
  });
}

function text(value) {
  return String(value || '').trim();
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return jsonResponse(405, { ok: false, message: 'Method not allowed.' });
  }

  if (env.BLOGSPHERE_READ_ONLY !== 'false') {
    return jsonResponse(403, { error: 'This Cloudflare deployment is read-only.' });
  }

  let payload = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed;
    }
  } catch {
    payload = {};
  }

  const name = text(payload.name);
  const email = text(payload.email);
  const subject = text(payload.subject);
  const message = text(payload.message);
  const queryType = text(payload.queryType || 'General inquiry');
  const article = text(payload.article);

  if (!name || !email || !subject || !message) {
    return jsonResponse(400, { ok: false, message: 'Name, email, subject, and message are required.' });
  }

  if (name.length > MAX_LENGTHS.name
    || email.length > MAX_LENGTHS.email
    || subject.length > MAX_LENGTHS.subject
    || queryType.length > MAX_LENGTHS.queryType
    || article.length > MAX_LENGTHS.article
    || message.length > MAX_LENGTHS.message
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse(400, { ok: false, message: 'Please provide valid contact information.' });
  }

  const gmailUser = text(env.GMAIL_USER) || CONTACT_RECIPIENT;
  const gmailAppPassword = text(env.GMAIL_APP_PASSWORD);
  if (!gmailAppPassword) {
    return jsonResponse(503, { ok: false, message: 'Unable to send your message.' });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: gmailUser,
        pass: gmailAppPassword
      }
    });

    await transporter.sendMail({
      from: gmailUser,
      to: CONTACT_RECIPIENT,
      replyTo: email,
      subject: `[BlogSphere Contact: ${queryType.replace(/[\r\n]+/g, ' ')}] ${subject.replace(/[\r\n]+/g, ' ')}`,
      text: `Visitor name: ${name}\nVisitor email: ${email}\nQuery type: ${queryType}\nArticle: ${article || '—'}\nSubject: ${subject}\nSubmitted: ${new Date().toISOString()}\n\nMessage:\n${message}`
    });

    return jsonResponse(200, { ok: true, message: 'Your message has been sent successfully.' });
  } catch (error) {
    console.error('Contact email delivery failed:', error.message);
    return jsonResponse(502, { ok: false, message: 'Unable to send your message.' });
  }
}
