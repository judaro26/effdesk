// src/storage.js: WHERE FILE BYTES LIVE. Production: Netlify Blobs (no extra account; set up by Netlify itself). Tests: memory. Same three calls either way.
export function memoryStore() {
  const m = new Map();
  return { async set(key, bytes) { m.set(key, Buffer.from(bytes)); }, async get(key) { return m.has(key) ? m.get(key) : null; }, async delete(key) { m.delete(key); }, _keys: () => [...m.keys()] };
}
export function blobStore(name = 'attachments') {
  let s = null;
  const open = async () => s || (s = (await import('@netlify/blobs')).getStore({ name, consistency: 'strong' }));      // opened on first use, so pages that never touch files do not load it
  return { async set(key, bytes) { await (await open()).set(key, bytes); }, async get(key) { const b = await (await open()).get(key, { type: 'arrayBuffer' }); return b ? Buffer.from(b) : null; }, async delete(key) { await (await open()).delete(key); } };
}
