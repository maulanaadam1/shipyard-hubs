'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Anchor, Search, Edit2, X, Save, CheckCircle,
  Calendar, Clock, Ship, MapPin, ChevronDown
} from 'lucide-react';
import { useData } from '@/context/DataContext';
import { api } from '@/lib/api-client';

const STATUS_DOCK_OPTIONS = ['', 'Docking', 'Undocking', 'On Dock', 'Completed'];

function formatDate(dateStr?: string) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function toInputDate(dateStr?: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

type DockingForm = {
  actual_start: string;
  actual_finish: string;
  act_arrival_date: string;
  act_trial_date: string;
  act_departure_date: string;
  docking: string;
  undocking: string;
  status_dock: string;
};

export default function ShipDocking() {
  const { projects, fetchData, currentUser } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [editingProject, setEditingProject] = useState<any>(null);
  const [formData, setFormData] = useState<DockingForm>({
    actual_start: '', actual_finish: '',
    act_arrival_date: '', act_trial_date: '', act_departure_date: '',
    docking: '', undocking: '', status_dock: ''
  });
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return projects
      .filter(p => {
        const s = p.status?.toLowerCase() || '';
        if (statusFilter === 'active') return ['active', 'in progress', 'on going', 'ongoing'].includes(s);
        if (statusFilter === 'all') return true;
        return s === statusFilter;
      })
      .filter(p => {
        const q = searchTerm.toLowerCase();
        return !q || (p.shipname || '').toLowerCase().includes(q)
          || (p.idproject || '').toLowerCase().includes(q)
          || (p.cust_company || '').toLowerCase().includes(q);
      })
      .sort((a, b) => new Date(b.create_date || 0).getTime() - new Date(a.create_date || 0).getTime());
  }, [projects, searchTerm, statusFilter]);

  const openEdit = (project: any) => {
    setEditingProject(project);
    setFormData({
      actual_start: toInputDate(project.actual_start),
      actual_finish: toInputDate(project.actual_finish),
      act_arrival_date: toInputDate(project.act_arrival_date),
      act_trial_date: toInputDate(project.act_trial_date),
      act_departure_date: toInputDate(project.act_departure_date),
      docking: toInputDate(project.docking),
      undocking: toInputDate(project.undocking),
      status_dock: project.status_dock || '',
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject) return;
    setSaving(true);
    try {
      const { error } = await api.from('projects')
        .update({
          actual_start: formData.actual_start || null,
          actual_finish: formData.actual_finish || null,
          act_arrival_date: formData.act_arrival_date || null,
          act_trial_date: formData.act_trial_date || null,
          act_departure_date: formData.act_departure_date || null,
          docking: formData.docking || null,
          undocking: formData.undocking || null,
          status_dock: formData.status_dock || null,
        })
        .eq('id', editingProject.id);
      if (error) throw error;
      setSavedId(editingProject.id);
      setTimeout(() => setSavedId(null), 2500);
      await fetchData();
      setEditingProject(null);
    } catch (err: any) {
      alert('Gagal menyimpan: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const f = (key: keyof DockingForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFormData(prev => ({ ...prev, [key]: e.target.value }));

  const getDockBadge = (p: any) => {
    const s = p.status_dock || '';
    if (s === 'On Dock') return { label: 'On Dock', cls: 'bg-blue-100 text-blue-700' };
    if (s === 'Docking') return { label: 'Docking', cls: 'bg-amber-100 text-amber-700' };
    if (s === 'Undocking') return { label: 'Undocking', cls: 'bg-purple-100 text-purple-700' };
    if (s === 'Completed') return { label: 'Selesai', cls: 'bg-emerald-100 text-emerald-700' };
    return { label: 'Belum Dok', cls: 'bg-slate-100 text-slate-500' };
  };

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-blue-600/10 rounded-xl flex items-center justify-center">
              <Anchor className="w-5 h-5 text-blue-600" />
            </div>
            <h2 className="font-display font-bold text-2xl text-slate-800 tracking-tight">Ship Docking</h2>
          </div>
          <p className="text-sm text-slate-500 ml-13">Update tanggal aktual dan status dok kapal</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Cari nama kapal, ID proyek, atau pelanggan..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
            />
          </div>
          <div className="flex gap-2">
            {[
              { val: 'active', label: 'Aktif' },
              { val: 'all', label: 'Semua' },
              { val: 'completed', label: 'Selesai' },
            ].map(opt => (
              <button
                key={opt.val}
                onClick={() => setStatusFilter(opt.val)}
                className={'px-4 py-2 rounded-xl text-xs font-bold border transition-all ' +
                  (statusFilter === opt.val
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Kapal / Project</th>
                <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status Dok</th>
                <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Docking (Aktual)</th>
                <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Undocking (Aktual)</th>
                <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Mulai Aktual</th>
                <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Selesai Aktual</th>
                <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Kedatangan</th>
                <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Uji Coba</th>
                <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Keberangkatan</th>
                <th className="px-5 py-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-12 text-center text-sm text-slate-400 italic">
                    Tidak ada data ditemukan.
                  </td>
                </tr>
              ) : (
                filtered.map(project => {
                  const badge = getDockBadge(project);
                  const isJustSaved = savedId === project.id;
                  return (
                    <motion.tr
                      key={project.id}
                      layout
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-blue-600/10 rounded-lg flex items-center justify-center shrink-0">
                            <Ship className="w-4 h-4 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-800">{project.shipname || '-'}</p>
                            <p className="text-[10px] text-slate-400">{project.idproject} · {project.location || 'No Location'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={'px-2.5 py-1 rounded-full text-[10px] font-bold ' + badge.cls}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-600">{formatDate(project.docking)}</td>
                      <td className="px-5 py-4 text-xs text-slate-600">{formatDate(project.undocking)}</td>
                      <td className="px-5 py-4 text-xs text-slate-600">{formatDate(project.actual_start)}</td>
                      <td className="px-5 py-4 text-xs text-slate-600">{formatDate(project.actual_finish)}</td>
                      <td className="px-5 py-4 text-xs text-slate-600">{formatDate(project.act_arrival_date)}</td>
                      <td className="px-5 py-4 text-xs text-slate-600">{formatDate(project.act_trial_date)}</td>
                      <td className="px-5 py-4 text-xs text-slate-600">{formatDate(project.act_departure_date)}</td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => openEdit(project)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ml-auto"
                          style={{ backgroundColor: isJustSaved ? '#d1fae5' : '#eff6ff', color: isJustSaved ? '#065f46' : '#1d4ed8' }}
                        >
                          {isJustSaved ? <CheckCircle className="w-3.5 h-3.5" /> : <Edit2 className="w-3.5 h-3.5" />}
                          {isJustSaved ? 'Tersimpan' : 'Update'}
                        </button>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingProject(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 16 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <form onSubmit={handleSave}>
                {/* Modal Header */}
                <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-blue-600 to-blue-700">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                        <Anchor className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-display font-bold text-lg text-white">Update Tanggal Aktual</h3>
                        <p className="text-blue-200 text-xs">{editingProject.shipname} · {editingProject.idproject}</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setEditingProject(null)}
                      className="p-2 hover:bg-white/20 rounded-full transition-colors">
                      <X className="w-5 h-5 text-white" />
                    </button>
                  </div>
                </div>

                <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
                  {/* Status Dok */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Status Dok</label>
                    <div className="relative">
                      <select
                        value={formData.status_dock}
                        onChange={f('status_dock')}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none"
                      >
                        {STATUS_DOCK_OPTIONS.map(o => (
                          <option key={o} value={o}>{o || '— Pilih Status —'}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* Dok Dates */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                        <Anchor className="w-3 h-3 inline mr-1" />Tgl Docking
                      </label>
                      <input type="date" value={formData.docking} onChange={f('docking')}
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                        <Anchor className="w-3 h-3 inline mr-1" />Tgl Undocking
                      </label>
                      <input type="date" value={formData.undocking} onChange={f('undocking')}
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Tanggal Aktual Proyek</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1.5">
                          <Clock className="w-3 h-3 inline mr-1" />Mulai Aktual
                        </label>
                        <input type="date" value={formData.actual_start} onChange={f('actual_start')}
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1.5">
                          <Clock className="w-3 h-3 inline mr-1" />Selesai Aktual
                        </label>
                        <input type="date" value={formData.actual_finish} onChange={f('actual_finish')}
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Tanggal Operasional</p>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1.5">
                          <Calendar className="w-3 h-3 inline mr-1" />Kedatangan Aktual
                        </label>
                        <input type="date" value={formData.act_arrival_date} onChange={f('act_arrival_date')}
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1.5">
                          <Calendar className="w-3 h-3 inline mr-1" />Uji Coba Aktual (Sea Trial)
                        </label>
                        <input type="date" value={formData.act_trial_date} onChange={f('act_trial_date')}
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1.5">
                          <Calendar className="w-3 h-3 inline mr-1" />Keberangkatan Aktual
                        </label>
                        <input type="date" value={formData.act_departure_date} onChange={f('act_departure_date')}
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                  <button type="button" onClick={() => setEditingProject(null)}
                    className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all">
                    Batal
                  </button>
                  <button type="submit" disabled={saving}
                    className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20">
                    <Save className="w-4 h-4" />
                    {saving ? 'Menyimpan...' : 'Simpan'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
