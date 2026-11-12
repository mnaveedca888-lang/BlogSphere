function supportsWrangler(version) {
  const match = /^v?(\d+)\.(\d+)\.\d+/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 22 || (major === 22 && minor >= 12);
}

if (require.main === module && !supportsWrangler(process.version)) {
  console.error('Cloudflare Pages local development requires Node.js 22.12.0 or newer.');
  process.exitCode = 1;
}

module.exports = { supportsWrangler };
