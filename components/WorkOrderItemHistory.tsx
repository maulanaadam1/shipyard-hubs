import React, { useEffect, useState } from 'react';
import { History, ChevronDown, ChevronUp } from 'lucide-react';
import { getHeaders } from '@/lib/api-client';

type ItemSnapshot = { key: string; path: string; label: string; price: number | null; volume: number | null; total: number | null; modifiedBy: string | null; sourceUpdatedAt: string | null };
type Event = { id: number; itemKey: string; kind: string; detectedAt: string; before: ItemSnapshot | null; after: ItemSnapshot | null };
type Props = { woId: string | number; item?: any; employees: { id: string; name: string }[]; formatMoney: (value: number) => string; revision?: any };
const labels: Record<string, string> = { baseline: 'Data awal', changed: 'Harga / volume berubah', added: 'Item ditambahkan', removed: 'Item tidak lagi tersedia' };

export default function WorkOrderItemHistory({ woId, item, employees, formatMoney, revision }: Props) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const key = item ? String(item.uniqcode || item.id || '') : null;
  const employeeName = (id: any) => {
    const value = typeof id === 'object' && id ? id.id : id;
    if (value == null || value === 'null' || value === '') return 'Tidak tersedia dari sumber';
    const name = employees.find(employee => String(employee.id) === String(value))?.name;
    return name ? `${name} (ID ${value})` : `User ID ${value} — belum ditemukan di Master Employee`;
  };
  const money = (value: number | null | undefined) => value == null ? '—' : formatMoney(value);
  const date = (value: string) => new Date(value).toLocaleString('id-ID');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    (async () => {
      try {
        const headers = await getHeaders();
        const response = await fetch(`/api/local-wo-history/${encodeURIComponent(woId)}`, { headers, signal: controller.signal });
        if (!response.ok) throw new Error('Riwayat belum dapat dimuat. Pastikan layanan riwayat lokal aktif dan sesi login masih berlaku.');
        const result = await response.json();
        if (!Array.isArray(result.events)) throw new Error('Respons riwayat tidak valid.');
        if (!controller.signal.aborted) setEvents(result.events);
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Gagal memuat riwayat.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [open, woId, revision]);
  const filtered = key === null ? events : events.filter(event => event.itemKey === key);
  return (
    <div className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50/70 text-left normal-case tracking-normal">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="text-xs text-slate-600">
          {item ? <><span className="block font-semibold text-slate-500">Pengubah terakhir item (sumber)</span><span className="mt-1 block font-semibold text-slate-800">{employeeName(item.modified_by)}</span></> : <><span className="font-semibold text-slate-800">Riwayat harga & volume WO</span><span className="block mt-1">Termasuk item yang ditambahkan atau tidak lagi tersedia.</span></>}
        </div>
        <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50">
          <History size={15} />{open ? 'Tutup riwayat' : item ? 'Riwayat item' : 'Lihat riwayat WO'}{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {open && <div className="border-t border-slate-200 p-4">
        <p className="mb-4 text-xs font-normal leading-relaxed text-slate-500">Riwayat tersimpan lokal sejak pencatatan pertama. Waktu adalah saat perubahan terdeteksi, bukan waktu pengeditan di sumber. Pengubah terakhir item belum tentu pengubah harga.</p>
        {loading ? <p className="text-sm text-slate-500">Memuat riwayat…</p> : error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : filtered.length === 0 ? <p className="text-sm text-slate-500">Belum ada catatan. Buka kembali detail WO untuk merekam data awal.</p> : <ol className="space-y-4">
          {filtered.map(event => {
            const snapshot = event.after || event.before;
            const delta = event.before?.total != null && event.after?.total != null ? event.after.total - event.before.total : null;
            return <li key={event.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap justify-between gap-2 text-xs"><span className={`rounded-full px-2.5 py-1 font-bold ${event.kind === 'changed' ? 'bg-amber-50 text-amber-800' : 'bg-indigo-50 text-indigo-700'}`}>{labels[event.kind] || event.kind}</span><time className="text-slate-500" dateTime={event.detectedAt}>{date(event.detectedAt)}</time></div>
              {!item && <p className="mt-2 text-sm font-semibold text-slate-800">{snapshot?.path} · {snapshot?.label}</p>}
              <div className="mt-3 overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-slate-500"><th className="py-2 text-left">Rincian</th><th className="text-right">Sebelum</th><th className="text-right">{event.kind === 'baseline' ? 'Data awal' : 'Sesudah'}</th></tr></thead><tbody className="divide-y divide-slate-100">
                <tr><td className="py-2">Harga satuan</td><td className="text-right font-mono">{money(event.before?.price)}</td><td className="text-right font-mono">{money(event.after?.price)}</td></tr>
                <tr><td className="py-2">Volume</td><td className="text-right">{event.before?.volume ?? '—'}</td><td className="text-right">{event.after?.volume ?? '—'}</td></tr>
                <tr className="font-bold"><td className="py-2">Total</td><td className="text-right font-mono">{money(event.before?.total)}</td><td className="text-right font-mono">{money(event.after?.total)}</td></tr>
              </tbody></table></div>
              {delta !== null && <p className="mt-2 text-right text-xs font-semibold text-amber-800">Selisih total: {money(delta)}</p>}
              <p className="mt-3 text-xs font-normal text-slate-500">{event.kind === 'removed' ? 'Pengubah item pada data sebelumnya' : 'Pengubah terakhir item saat dicatat'}: <span className="font-semibold text-slate-700">{employeeName(event.after ? event.after.modifiedBy : event.before?.modifiedBy)}</span></p>
              {event.kind === 'baseline' && <p className="mt-2 text-xs text-slate-500">Data pembanding awal; bukan bukti perubahan harga.</p>}
            </li>;
          })}
        </ol>}
      </div>}
    </div>
  );
}
