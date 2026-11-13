import { connect } from 'cloudflare:sockets';

const CONTACT_RECIPIENT = 'admin@blogsphere.info';
const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;
const SMTP_TIMEOUT_MS = 15000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
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

function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function encodeSubject(value) {
  const chunks = [];
  let chunk = '';
  for (const character of value) {
    if (chunk && encoder.encode(chunk + character).length > 42) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(part => `=?UTF-8?B?${base64(encoder.encode(part))}?=`).join('\r\n ');
}

function encodeBody(value) {
  const encoded = base64(encoder.encode(value));
  return encoded.match(/.{1,76}/g).join('\r\n');
}

class SmtpError extends Error {
  constructor(stage, message) {
    super(`${stage}: ${message}`);
    this.name = 'SmtpError';
  }
}

function withTimeout(promise, stage) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new SmtpError(stage, 'timed out')), SMTP_TIMEOUT_MS);
    })
  ]).finally(() => clearTimeout(timer));
}

class SmtpConnection {
  constructor(socket) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
    this.buffer = '';
  }

  async readLine(stage) {
    while (true) {
      const end = this.buffer.indexOf('\r\n');
      if (end !== -1) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 2);
        return line;
      }

      const { done, value } = await withTimeout(this.reader.read(), stage);
      if (done) throw new SmtpError(stage, 'server closed the connection');
      this.buffer += decoder.decode(value, { stream: true });
      if (this.buffer.length > 4096 && this.buffer.indexOf('\r\n') === -1) {
        throw new SmtpError(stage, 'response line is too long');
      }
    }
  }

  async readReply(stage, expectedCodes) {
    const lines = [];
    let line;
    do {
      line = await this.readLine(stage);
      if (!/^\d{3}[ -]/.test(line)) throw new SmtpError(stage, 'malformed SMTP response');
      lines.push(line);
      if (lines.length > 50) throw new SmtpError(stage, 'response has too many lines');
    } while (line[3] === '-');

    const code = Number(line.slice(0, 3));
    if (!expectedCodes.includes(code)) {
      const detail = lines.map(item => item.slice(4)).join(' ').replace(/[\r\n]/g, ' ').slice(0, 400);
      throw new SmtpError(stage, `${code} ${detail}`);
    }
  }

  async command(command, stage, expectedCodes) {
    await this.writer.write(encoder.encode(`${command}\r\n`));
    await this.readReply(stage, expectedCodes);
  }

  async startTls() {
    this.reader.releaseLock();
    this.writer.releaseLock();
    return new SmtpConnection(this.socket.startTls());
  }

  async close() {
    try {
      await this.socket.close();
    } finally {
      this.reader.releaseLock();
      this.writer.releaseLock();
    }
  }
}

function buildMessage({ gmailUser, replyTo, subject, body }) {
  return [
    `From: <${gmailUser}>`,
    `To: <${CONTACT_RECIPIENT}>`,
    `Reply-To: <${replyTo}>`,
    `Subject: ${encodeSubject(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBody(body)
  ].join('\r\n');
}

async function sendEmail({ gmailUser, gmailAppPassword, replyTo, subject, body }) {
  const socket = connect(
    { hostname: SMTP_HOST, port: SMTP_PORT },
    { secureTransport: 'starttls' }
  );
  let connection = new SmtpConnection(socket);

  try {
    await withTimeout(socket.opened, 'connect');
    await connection.readReply('greeting', [220]);
    await connection.command('EHLO blogsphere.info', 'EHLO', [250]);
    await connection.command('STARTTLS', 'STARTTLS', [220]);

    connection = await connection.startTls();
    await connection.command('EHLO blogsphere.info', 'secure EHLO', [250]);
    await connection.command(
      `AUTH PLAIN ${base64(encoder.encode(`\0${gmailUser}\0${gmailAppPassword}`))}`,
      'authentication',
      [235]
    );
    await connection.command(`MAIL FROM:<${gmailUser}>`, 'sender', [250]);
    await connection.command(`RCPT TO:<${CONTACT_RECIPIENT}>`, 'recipient', [250, 251]);
    await connection.command('DATA', 'message data', [354]);
    await connection.writer.write(encoder.encode(`${buildMessage({
      gmailUser,
      replyTo,
      subject,
      body
    })}\r\n.\r\n`));
    await connection.readReply('message acceptance', [250]);
  } finally {
    try {
      await connection.close();
    } catch (error) {
      console.warn('Contact SMTP connection cleanup failed:', error instanceof Error ? error.message : 'Unknown cleanup error.');
    }
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

  const gmailUser = text(env.GMAIL_USER);
  const gmailAppPassword = text(env.GMAIL_APP_PASSWORD).replace(/\s+/g, '');
  if (!gmailUser || !gmailAppPassword || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmailUser)) {
    console.error('Contact email configuration is missing a valid GMAIL_USER or GMAIL_APP_PASSWORD.');
    return jsonResponse(503, { ok: false, message: 'Unable to send your message.' });
  }

  try {
    await sendEmail({
      gmailUser,
      gmailAppPassword,
      replyTo: email,
      subject: `[BlogSphere Contact: ${queryType.replace(/[\r\n]+/g, ' ')}] ${subject.replace(/[\r\n]+/g, ' ')}`,
      body: `Visitor name: ${name}\nVisitor email: ${email}\nQuery type: ${queryType}\nArticle: ${article || '—'}\nSubject: ${subject}\nSubmitted: ${new Date().toISOString()}\n\nMessage:\n${message}`
    });

    return jsonResponse(200, { ok: true, message: 'Your message has been sent successfully.' });
  } catch (error) {
    console.error('Contact email delivery failed:', error instanceof Error ? error.message : 'Unknown SMTP error.');
    return jsonResponse(502, { ok: false, message: 'Unable to send your message.' });
  }
}
