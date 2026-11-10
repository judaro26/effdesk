// src/mentions.js: @mentions in internal notes. "@ann" matches the part of an agent's email before the @ (case does not matter); only current members of the organization can be mentioned.
export const handlesIn = text => [...new Set([...String(text || '').matchAll(/(?:^|[\s(])@([a-z0-9][a-z0-9._-]{0,63})/gi)].map(m => m[1].toLowerCase().replace(/[._-]+$/, '')))];
export async function mentionedIds(pool, orgId, text) {
  const hs = handlesIn(text); if (!hs.length) return [];
  const rows = (await pool.query('select u.id, lower(split_part(u.email, \'@\', 1)) h from member m join "user" u on u.id = m."userId" where m."organizationId" = $1', [orgId])).rows;
  return [...new Set(rows.filter(r => hs.includes(r.h)).map(r => r.id))];
}
