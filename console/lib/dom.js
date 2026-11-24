const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
export const slug = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const pill = (label, kind = label) => `<span class="pill ${slug(kind)}">${esc(label)}</span>`;
export const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

export function emptyState(title, command) {
  return `<div class="card empty" data-testid="empty-state"><p>${esc(title)}</p>${command ? `<code>${esc(command)}</code>` : ''}</div>`;
}

export function toCsv(rows, columns) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [columns.join(','), ...rows.map((row) => columns.map((c) => cell(row[c])).join(','))].join('\n');
}
