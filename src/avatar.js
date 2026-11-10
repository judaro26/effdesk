// src/avatar.js: a profile picture is a small PNG, JPEG or WebP kept as a data address (the desk shrinks it to 128 pixels first). Checked here by its first bytes, not by what the browser says.
export function validAvatar(v) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(v || '')); if (!m || v.length > 60000) return false;
  const b = Buffer.from(m[2], 'base64');
  return m[1] === 'png' ? b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) : m[1] === 'jpeg' ? b[0] === 0xff && b[1] === 0xd8 : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
}
