// src/config.js: the one place the product's name and public facts live. Renaming the product is a change here (and the legal pages' company line).
export const PRODUCT = {
  name: 'EffDesk',
  tagline: 'A simple, affordable help desk.',
  company: 'EffDesk (operated by the account owner; fill in the legal entity before launch)',
  supportEmail: process.env.SUPPORT_EMAIL || 'support@effdesk.com',
  privacyEmail: process.env.PRIVACY_EMAIL || 'privacy@effdesk.com',
  appUrl: process.env.APP_URL || 'http://localhost:8888',
};
// platform operators (can grant licences): a comma separated list of emails in PLATFORM_ADMIN_EMAILS
export const platformAdmins = () => String(process.env.PLATFORM_ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
