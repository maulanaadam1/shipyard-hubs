import React from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';

// A small Markdown renderer for AI Asisten answers: headings, paragraphs,
// lists, tables, code, **bold**, *italic*, `code`. Builds React elements (no
// raw HTML). WO codes become links to the Work Order page; each table can be
// downloaded as Excel.

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'code'; text: string };

const splitRow = (line: string) => {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map(c => c.trim());
};
const isTableSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ kind: 'heading', level: h[1].length, text: h[2] }); i++; continue; }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    const li = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m) { items.push(m[2]); i++; continue; }
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue; }
        break;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s/.test(lines[i]) && !lines[i].trim().startsWith('```')
      && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
      para.push(lines[i++]);
    }
    blocks.push({ kind: 'paragraph', text: para.join('\n') });
  }
  return blocks;
}

const WO_RE = /\b(WO\d{6,}(?:\/[A-Z0-9]+)?)\b/g;

function linkWO(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  WO_RE.lastIndex = 0;
  while ((m = WO_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const code = m[1].split('/')[0];
    out.push(
      <Link key={`${key}-wo${m.index}`} to={`/work-order?search=${encodeURIComponent(code)}`}
        className="font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:decoration-indigo-700">
        {m[1]}
      </Link>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function inline(text: string, key = 'i'): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...linkWO(text.slice(last, m.index), `${key}-${n++}`));
    const tok = m[0];
    const k = `${key}-${n++}`;
    if (tok.startsWith('**')) out.push(<strong key={k} className="font-semibold text-slate-900">{linkWO(tok.slice(2, -2), k)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k} className="px-1 py-0.5 rounded bg-slate-100 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    else out.push(<em key={k}>{linkWO(tok.slice(1, -1), k)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(...linkWO(text.slice(last), `${key}-${n}`));
  return out;
}

const plain = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\*([^*]+)\*/g, '$1');

// "Rp 1.234.567" / "1.234,5" / "12%" → number for Excel; text otherwise.
function cellValue(s: string): string | number {
  const t = plain(s).trim();
  const m = /^(?:Rp\.?\s*)?(-?[\d.]+(?:,\d+)?)\s*%?$/.exec(t);
  if (!m || !/\d/.test(m[1])) return t;
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : t;
}

function downloadTable(header: string[], rows: string[][]) {
  const data = [header.map(plain), ...rows.map(r => r.map(cellValue))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, `ai-asisten-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export default function AIMarkdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="flex flex-col gap-2 leading-relaxed">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.kind) {
          case 'heading':
            return <p key={k} className={`font-semibold text-slate-900 ${b.level <= 2 ? 'text-base' : 'text-sm'}`}>{inline(b.text, k)}</p>;
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag key={k} className={`pl-5 flex flex-col gap-0.5 ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
                {b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}
              </Tag>
            );
          }
          case 'table':
            return (
              <div key={k} className="flex flex-col gap-1">
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>{b.header.map((h, j) => <th key={j} scope="col" className="px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">{inline(h, `${k}-h${j}`)}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {b.rows.map((r, j) => (
                        <tr key={j}>
                          {b.header.map((_, c) => {
                            const cell = r[c] ?? '';
                            const numeric = typeof cellValue(cell) === 'number';
                            return <td key={c} className={`px-2.5 py-1.5 align-top ${numeric ? 'text-right tabular-nums whitespace-nowrap' : ''}`}>{inline(cell, `${k}-${j}-${c}`)}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" onClick={() => downloadTable(b.header, b.rows)}
                  className="self-start inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900">
                  <FileSpreadsheet size={13} aria-hidden="true" /> Unduh tabel (Excel)
                </button>
              </div>
            );
          case 'code':
            return <pre key={k} className="p-2.5 rounded-lg bg-slate-100 text-xs font-mono overflow-x-auto whitespace-pre">{b.text}</pre>;
          default:
            return <p key={k} className="whitespace-pre-wrap">{inline(b.text, k)}</p>;
        }
      })}
    </div>
  );
}
