const RESEND_TIMEOUT_MS = 15000;
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

async function sendEmail({
  apiKey,
  contactFrom,
  contactRecipient,
  replyTo,
  subject,
  body
}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('Resend API request timed out.')),
    RESEND_TIMEOUT_MS
  );
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'BlogSphere/1.0'
      },
      body: JSON.stringify({
        from: contactFrom,
        to: [contactRecipient],
        reply_to: replyTo,
        subject,
        text: body
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Resend API request failed with HTTP ${response.status}.`);
    }
  } finally {
    clearTimeout(timeout);
  }
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

  const apiKey = String(env.RESEND_API_KEY || '').trim();
  const contactFrom = text(env.CONTACT_FROM);
  const contactRecipient = text(env.CONTACT_RECIPIENT);
  const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (!apiKey
    || !validEmail(contactFrom)
    || !validEmail(contactRecipient)) {
    console.error('Contact email configuration is missing or invalid required Resend settings.');
    return jsonResponse(503, { ok: false, message: 'Unable to send your message.' });
  }

  try {
    await sendEmail({
      apiKey,
      contactFrom,
      contactRecipient,
      replyTo: email,
      subject: `[BlogSphere Contact: ${queryType.replace(/[\r\n]+/g, ' ')}] ${subject.replace(/[\r\n]+/g, ' ')}`,
      body: `Visitor name: ${name}\nVisitor email: ${email}\nQuery type: ${queryType}\nArticle: ${article || '—'}\nSubject: ${subject}\nSubmitted: ${new Date().toISOString()}\n\nMessage:\n${message}`
    });

    return jsonResponse(200, { ok: true, message: 'Your message has been sent successfully.' });
  } catch (error) {
    console.error('Contact email delivery failed:', error instanceof Error ? error.message : 'Unknown email delivery error.');
    return jsonResponse(502, { ok: false, message: 'Unable to send your message.' });
  }
}
