// Display formatters shared by the evidence and challenge pages.

const SHORT_DATE_TIME = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** "05 nov, 14:30" style date; "—" when missing, the raw value when unparsable. */
export function formatShortDateTime(value: string | null): string {
  if (!value) return '—';
  try {
    return SHORT_DATE_TIME.format(new Date(value));
  } catch {
    return value;
  }
}

/** Evidence file size in KB (at least 1) below 1 MB, otherwise MB with one decimal; "" when unknown. */
export function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
