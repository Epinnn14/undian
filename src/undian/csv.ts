type Cell = string | number | null | undefined;

/** RFC 4180 CSV: quote fields containing a comma, quote or newline; CRLF line endings. */
export function toCsv(header: string[], rows: Cell[][]): string {
  const cell = (v: Cell) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `${[header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
