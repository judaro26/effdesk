// Safe display helpers for staging query diagnostics. Never accepts or emits bind values.
export function normalizeSqlForFingerprint(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim();
}

export function sanitizeSqlTemplate(sql, maxLength = 700) {
  let value = String(sql || '');

  // Redact SQL string and dollar-quoted literals before stripping comments.
  value = value.replace(/'(?:''|[^'])*'/g, "'?'");
  value = value.replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1?\$/g, "'?'");

  // Remove comments, then redact numeric constants while preserving $1 bind markers.
  value = value.replace(/\/\*[\s\S]*?\*\//g, ' ');
  value = value.replace(/--[^\r\n]*/g, ' ');
  value = value.replace(/(?<![\w$])(?:\d+(?:\.\d*)?|\.\d+)(?![\w])/g, '?');
  value = value.replace(/\s+/g, ' ').trim();

  if (value.length > maxLength) return `${value.slice(0, maxLength)}… [truncated]`;
  return value;
}
