'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Anchor, Search, Edit2, X, Save,
  Calendar, Clock, ChevronLeft, ChevronRight,
  Filter, Ship, ChevronDown, Plus, Trash2, History
} from 'lucide-react';
import { useData } from '@/context/DataContext';
import { api } from '@/lib/api-client';

const STATUS_DOCK_OPTIONS = ['', 'Docking', 'On Dock', 'Undocking', 'Completed'];

function toInputDate(dateStr?: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(dateTimeStr?: string) {
  if (!dateTimeStr) return '-';
  const d = new Date(dateTimeStr);
  if (isNaN(d.getTime())) return dateTimeStr;
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
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

type MovementActivity = {
  id: string;
  project_id: string;
  activity_name: string;
  start_time: string;
  end_time: string;
  create_date: string;
};

export default function ShipDocking() {
  const { projects, fetchData } = useData();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(10);

  const [editingProject, setEditingProject] = useState<any>(null);
  const [formData, setFormData] = useState<DockingForm>({
    actual_start: '', actual_finish: '',
    act_arrival_date: '', act_trial_date: '', act_departure_date: '',
    docking: '', undocking: '', status_dock: ''
  });
  const [saving, setSaving] = useState(false);

  // Movement Activities state
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [movementLogs, setMovementLogs] = useState<MovementActivity[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [newLog, setNewLog] = useState({
    activity_name: '',
    start_time: '',
    end_time: ''
  });
  const [addingLog, setAddingLog] = useState(false);

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

  const totalItems = filtered.length;
  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(totalItems / (itemsPerPage as number));
  const paginated = itemsPerPage === 'all'
    ? filtered
    : filtered.slice((currentPage - 1) * (itemsPerPage as number), currentPage * (itemsPerPage as number));

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
    if (s === 'On Dock')    return 'bg-blue-50 text-blue-600';
    if (s === 'Docking')    return 'bg-amber-50 text-amber-600';
    if (s === 'Undocking')  return 'bg-purple-50 text-purple-600';
    if (s === 'Completed')  return 'bg-green-50 text-green-600';
    return 'bg-slate-100 text-slate-500';
  };

  // --- Movement Log Functions ---
  const fetchMovementLogs = async (projectId: string) => {
    setLoadingLogs(true);
    try {
      const { data, error } = await api.from('ship_movements')
        .select('*')
        .eq('project_id', projectId);
      if (error) throw error;
      setMovementLogs(data || []);
    } catch (err) {
      console.error('Error fetching logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  const toggleExpand = (projectId: string) => {
    if (expandedProjectId === projectId) {
      setExpandedProjectId(null);
      setMovementLogs([]);
    } else {
      setExpandedProjectId(projectId);
      fetchMovementLogs(projectId);
      setNewLog({ activity_name: '', start_time: '', end_time: '' });
    }
  };

  const handleAddLog = async () => {
    if (!expandedProjectId || !newLog.activity_name) return;
    setAddingLog(true);
    try {
      const { error } = await api.from('ship_movements').insert([
        {
          project_id: expandedProjectId,
          ...newLog
        }
      ]);
      if (error) throw error;
      setNewLog({ activity_name: '', start_time: '', end_time: '' });
      fetchMovementLogs(expandedProjectId);
    } catch (err: any) {
      alert('Gagal menambah aktivitas: ' + err.message);
    } finally {
      setAddingLog(false);
    }
  };

  const handleDeleteLog = async (id: string) => {
    if (!confirm('Hapus log aktivitas ini?')) return;
    try {
      const { error } = await api.from('ship_movements').delete().eq('id', id);
      if (error) throw error;
      if (expandedProjectId) fetchMovementLogs(expandedProjectId);
    } catch (err: any) {
      alert('Gagal menghapus: ' + err.message);
    }
  };

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-slate-800 tracking-tight">Ship Docking</h1>
          <p className="text-slate-500 text-sm mt-1">Update tanggal aktual, status dok, dan log pergerakan kapal.</p>
        </div>
      </div>

      {/* Search & Pagination Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-50/50">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Cari nama kapal, ID proyek, atau pelanggan..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
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
                  onClick={() => { setStatusFilter(opt.val); setCurrentPage(1); }}
                  className={'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ' +
                    (statusFilter === opt.val
                      ? 'bg-[#FDB913] text-slate-900 border-[#FDB913]'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Show</span>
              <select
                value={itemsPerPage}
                onChange={(e) => { setItemsPerPage(e.target.value === 'all' ? 'all' : parseInt(e.target.value)); setCurrentPage(1); }}
                className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-600 outline-none focus:ring-2 focus:ring-[#FDB913]/30"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value="all">All</option>
              </select>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">No</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nama Kapal</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status Dok</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Mulai Aktual</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Selesai Aktual</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tgl Docking</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tgl Undocking</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-sm text-slate-400 italic">
                    Tidak ada data ditemukan.
                  </td>
                </tr>
              ) : (
                paginated.map((project, idx) => {
                  const globalNo = itemsPerPage === 'all' ? idx + 1 : (currentPage - 1) * (itemsPerPage as number) + idx + 1;
                  const dockClass = getDockBadge(project);
                  const isExpanded = expandedProjectId === project.id;
                  
                  return (
                    <React.Fragment key={project.id}>
                      <motion.tr
                        layout
                        className={`hover:bg-slate-50/80 transition-colors cursor-pointer ${isExpanded ? 'bg-slate-50/80' : ''}`}
                        onClick={() => toggleExpand(project.id)}
                      >
                        <td className="px-6 py-4">
                          <span className="text-xs font-mono font-bold text-slate-400">#{globalNo}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-[#FDB913]/10 rounded-lg flex items-center justify-center shrink-0">
                              <Ship className="w-4 h-4 text-[#FDB913]" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-700">{project.shipname || '-'}</p>
                              <p className="text-[10px] text-slate-400">{project.idproject} · {project.location || 'No Location'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={'px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ' + dockClass}>
                            {project.status_dock || 'Belum Dok'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-600">{formatDate(project.actual_start)}</td>
                        <td className="px-6 py-4 text-xs text-slate-600">{formatDate(project.actual_finish)}</td>
                        <td className="px-6 py-4 text-xs text-slate-600">{formatDate(project.docking)}</td>
                        <td className="px-6 py-4 text-xs text-slate-600">{formatDate(project.undocking)}</td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleExpand(project.id); }}
                              className={`p-2 rounded-lg transition-all ${isExpanded ? 'bg-[#FDB913] text-slate-900' : 'text-slate-400 hover:text-[#FDB913] hover:bg-white hover:shadow-sm'}`}
                              title="Log Pergerakan"
                            >
                              <History className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); openEdit(project); }}
                              className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-slate-400 hover:text-[#FDB913]"
                              title="Update Status"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </motion.tr>

                      {/* Expanded Section for Movement Logs */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.tr
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="bg-slate-50/30"
                          >
                            <td colSpan={8} className="p-0">
                              <div className="px-20 py-6 space-y-6">
                                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                                  <div className="flex items-center gap-2">
                                    <History className="w-4 h-4 text-slate-400" />
                                    <h4 className="text-sm font-bold text-slate-700">Log Pergerakan Kapal</h4>
                                  </div>
                                </div>

                                {/* Form Add Log */}
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Aktivitas</label>
                                    <input
                                      type="text"
                                      placeholder="Contoh: Pindah ke Dock 1"
                                      value={newLog.activity_name}
                                      onChange={(e) => setNewLog({ ...newLog, activity_name: e.target.value })}
                                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Mulai</label>
                                    <input
                                      type="datetime-local"
                                      value={newLog.start_time}
                                      onChange={(e) => setNewLog({ ...newLog, start_time: e.target.value })}
                                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Selesai</label>
                                    <input
                                      type="datetime-local"
                                      value={newLog.end_time}
                                      onChange={(e) => setNewLog({ ...newLog, end_time: e.target.value })}
                                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                                    />
                                  </div>
                                  <div className="flex items-end">
                                    <button
                                      onClick={handleAddLog}
                                      disabled={addingLog || !newLog.activity_name}
                                      className="w-full flex items-center justify-center gap-2 py-2 bg-[#FDB913] text-slate-900 rounded-lg text-xs font-bold hover:bg-[#e5a611] transition-all disabled:opacity-50"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                      {addingLog ? 'Menambah...' : 'Tambah Log'}
                                    </button>
                                  </div>
                                </div>

                                {/* Log Table */}
                                <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                                  <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-50 border-b border-slate-100">
                                      <tr>
                                        <th className="px-4 py-2 font-bold text-slate-500">Aktivitas</th>
                                        <th className="px-4 py-2 font-bold text-slate-500">Mulai</th>
                                        <th className="px-4 py-2 font-bold text-slate-500">Selesai</th>
                                        <th className="px-4 py-2 font-bold text-slate-500 text-right">Hapus</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                      {loadingLogs ? (
                                        <tr><td colSpan={4} className="p-4 text-center text-slate-400">Loading logs...</td></tr>
                                      ) : movementLogs.length === 0 ? (
                                        <tr><td colSpan={4} className="p-4 text-center text-slate-400 italic">Belum ada log pergerakan.</td></tr>
                                      ) : (
                                        movementLogs.map(log => (
                                          <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-4 py-3 font-medium text-slate-700">{log.activity_name}</td>
                                            <td className="px-4 py-3 text-slate-500">{formatDateTime(log.start_time)}</td>
                                            <td className="px-4 py-3 text-slate-500">{formatDateTime(log.end_time)}</td>
                                            <td className="px-4 py-3 text-right">
                                              <button
                                                onClick={() => handleDeleteLog(log.id)}
                                                className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                              </button>
                                            </td>
                                          </tr>
                                        ))
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </motion.tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/30">
            <p className="text-xs text-slate-500">
              Menampilkan <span className="font-bold text-slate-700">{paginated.length}</span> dari <span className="font-bold text-slate-700">{totalItems}</span> data
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg hover:bg-white hover:shadow-sm transition-all text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let page: number;
                if (totalPages <= 5) {
                  page = i + 1;
                } else if (currentPage <= 3) {
                  page = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  page = totalPages - 4 + i;
                } else {
                  page = currentPage - 2 + i;
                }
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={'w-8 h-8 rounded-lg text-xs font-bold transition-all ' +
                      (currentPage === page
                        ? 'bg-[#FDB913] text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:bg-white hover:shadow-sm')}
                  >
                    {page}
                  </button>
                );
              })}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg hover:bg-white hover:shadow-sm transition-all text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
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
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <form onSubmit={handleSave}>
                {/* Modal Header */}
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#FDB913]/20 rounded-xl flex items-center justify-center text-[#FDB913]">
                      <Anchor className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-xl text-slate-800">Update Docking</h3>
                      <p className="text-slate-500 text-xs">{editingProject.shipname} · {editingProject.idproject}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setEditingProject(null)}
                    className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                    <X className="w-5 h-5 text-slate-500" />
                  </button>
                </div>

                <div className="p-6 space-y-5 max-h-[65vh] overflow-y-auto">
                  {/* Status Dok */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Status Dok</label>
                    <div className="relative">
                      <select
                        value={formData.status_dock}
                        onChange={f('status_dock')}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 appearance-none"
                      >
                        {STATUS_DOCK_OPTIONS.map(o => (
                          <option key={o} value={o}>{o || '— Pilih Status —'}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* Docking & Undocking */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tgl Docking</label>
                      <input type="date" value={formData.docking} onChange={f('docking')}
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tgl Undocking</label>
                      <input type="date" value={formData.undocking} onChange={f('undocking')}
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30" />
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4 space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Tanggal Aktual Proyek</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Mulai Aktual</label>
                        <input type="date" value={formData.actual_start} onChange={f('actual_start')}
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Selesai Aktual</label>
                        <input type="date" value={formData.actual_finish} onChange={f('actual_finish')}
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30" />
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4 space-y-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tanggal Operasional</p>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Kedatangan Aktual</label>
                      <input type="date" value={formData.act_arrival_date} onChange={f('act_arrival_date')}
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Uji Coba (Sea Trial)</label>
                      <input type="date" value={formData.act_trial_date} onChange={f('act_trial_date')}
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Keberangkatan Aktual</label>
                      <input type="date" value={formData.act_departure_date} onChange={f('act_departure_date')}
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30" />
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                  <button type="button" onClick={() => setEditingProject(null)}
                    className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all">
                    Batal
                  </button>
                  <button type="submit" disabled={saving}
                    className="px-8 py-2.5 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-all shadow-lg shadow-[#FDB913]/20">
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
