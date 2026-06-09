'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Server, 
  Plus, 
  Save, 
  X, 
  RefreshCw, 
  Trash2,
  Edit2,
  Clock,
  CheckCircle2,
  AlertCircle,
  ToggleRight,
  ToggleLeft,
  Zap,
  Database,
  ChevronLeft,
  ChevronRight,
  Upload,
  Download
} from 'lucide-react';
import { api, getHeaders } from '@/lib/api-client';
import { useData } from '@/context/DataContext';

export default function ApiSyncManagement() {
  const { fetchData } = useData();
  const [configs, setConfigs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formConfigId, setFormConfigId] = useState("");
  const [curlCommand, setCurlCommand] = useState("");
  const [intervalType, setIntervalType] = useState("minutes");
  const [intervalValue, setIntervalValue] = useState("5");
  const [syncStatusMsg, setSyncStatusMsg] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncDate, setLastSyncDate] = useState("");

  // Query Params state
  const [baseUrl, setBaseUrl] = useState("");
  const [queryParams, setQueryParams] = useState<{id: string, key: string, value: string, active: boolean}[]>([]);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    fetchConfigs();
  }, []);

  // Parse URL from cURL string automatically
  useEffect(() => {
    if (!curlCommand) {
      setBaseUrl("");
      setQueryParams([]);
      return;
    }

    let urlMatch = curlCommand.match(/curl\s+'([^']+)'/);
    if (!urlMatch) urlMatch = curlCommand.match(/curl\s+"([^"]+)"/);
    if (!urlMatch) urlMatch = curlCommand.match(/curl\s+([^ ]+)/);
    
    if (urlMatch && urlMatch[1]) {
      const extractedUrl = urlMatch[1];
      
      // Prevent loop by checking if extracted URL is the same as current
      try {
        if (baseUrl) {
          const currentUrlObj = new URL(baseUrl);
          queryParams.forEach(p => {
            if (p.key && p.active !== false) currentUrlObj.searchParams.append(p.key, p.value);
          });
          if (currentUrlObj.toString() === extractedUrl) return; 
        }
      } catch (e) {}

      try {
        const urlObj = new URL(extractedUrl);
        setBaseUrl(urlObj.origin + urlObj.pathname);
        const params: any[] = [];
        urlObj.searchParams.forEach((v, k) => {
          params.push({ id: Math.random().toString(), key: k, value: v, active: true });
        });
        setQueryParams(params);
      } catch (e) {}
    }
  }, [curlCommand]);

  const updateCurlCommandUrl = (base: string, params: typeof queryParams) => {
    try {
      const u = new URL(base);
      params.forEach(p => {
        if (p.key && p.active !== false) u.searchParams.append(p.key, p.value);
      });
      const newUrlStr = u.toString();
      
      let newCurl = curlCommand;
      let replaced = false;
      newCurl = newCurl.replace(/(curl\s+')([^']+)'/, (m, p1) => { replaced = true; return p1 + newUrlStr + "'"; });
      if (!replaced) newCurl = newCurl.replace(/(curl\s+")([^"]+)"/, (m, p1) => { replaced = true; return p1 + newUrlStr + '"'; });
      if (!replaced) newCurl = newCurl.replace(/(curl\s+)([^ ]+)/, (m, p1) => p1 + newUrlStr);
      
      if (newCurl !== curlCommand) setCurlCommand(newCurl);
    } catch(e) {}
  };

  const handleParamChange = (id: string, field: 'key' | 'value' | 'active', val: any) => {
    const updated = queryParams.map(p => p.id === id ? { ...p, [field]: val } : p);
    setQueryParams(updated);
    if (baseUrl) updateCurlCommandUrl(baseUrl, updated);
  };

  const handleAddParam = () => {
    const updated = [...queryParams, { id: Math.random().toString(), key: '', value: '', active: true }];
    setQueryParams(updated);
  };

  const handleRemoveParam = (id: string) => {
    const updated = queryParams.filter(p => p.id !== id);
    setQueryParams(updated);
    if (baseUrl) updateCurlCommandUrl(baseUrl, updated);
  };

  const fetchConfigs = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await api.from('sync_configs').select('*');
      if (error) throw error;
      setConfigs(data || []);
    } catch (e: any) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = () => {
    if (configs.length === 0) {
      alert("Tidak ada konfigurasi untuk diekspor.");
      return;
    }
    const dataStr = JSON.stringify(configs, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api_sync_configs_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importedConfigs = JSON.parse(text);
      
      if (!Array.isArray(importedConfigs)) {
         throw new Error("Format file JSON tidak valid (harus array dari konfigurasi).");
      }

      setIsLoading(true);
      for (const config of importedConfigs) {
        const payload = {
          id: config.id,
          name: config.name,
          url: config.url,
          headers: config.headers,
          interval_type: config.interval_type,
          interval_value: config.interval_value,
          last_sync: config.last_sync,
          is_active: config.is_active
        };
        await api.from('sync_configs').upsert(payload, { onConflict: 'id' });
      }
      
      alert(`Berhasil mengimpor ${importedConfigs.length} konfigurasi!`);
      fetchConfigs();
    } catch (err: any) {
      alert("Gagal mengimpor file: " + err.message);
    } finally {
      setIsLoading(false);
      e.target.value = '';
    }
  };

  const handleAdd = () => {
    setEditingId(null);
    setFormConfigId("");
    setFormName("");
    setCurlCommand("");
    setIntervalType("minutes");
    setIntervalValue("5");
    setLastSyncDate("");
    setBaseUrl("");
    setQueryParams([]);
    setSyncStatusMsg("");
    setIsModalOpen(true);
  };

  const handleEdit = (config: any) => {
    setEditingId(config.id);
    setFormConfigId(config.id);
    setFormName(config.name);
    setIntervalType(config.interval_type || "minutes");
    setIntervalValue(config.interval_value || "5");
    setLastSyncDate(config.last_sync || "");
    
    // Reconstruct cURL command roughly for editing convenience
    let constructedCurl = `curl '${config.url}' \\`;
    if (config.headers) {
      try {
        const parsedHeaders = JSON.parse(config.headers);
        Object.entries(parsedHeaders).forEach(([k, v]) => {
          if (k.toLowerCase() === 'cookie') {
            constructedCurl += `\n  -b '${v}' \\`;
          } else {
            constructedCurl += `\n  -H '${k}: ${v}' \\`;
          }
        });
      } catch (e) {}
    }
    constructedCurl = constructedCurl.replace(/ \\\n?$/, '');
    setCurlCommand(constructedCurl); 

    setSyncStatusMsg("");
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus konfigurasi ini?')) return;
    try {
      await api.from('sync_configs').delete().eq('id', id);
      fetchConfigs();
    } catch (e) {
      alert("Gagal menghapus");
    }
  };

  const toggleActive = async (config: any) => {
    try {
      await api.from('sync_configs').update({ is_active: !config.is_active }).eq('id', config.id);
      fetchConfigs();
    } catch (e) {
      alert("Gagal mengubah status aktif");
    }
  };

  const triggerManualSync = async (id?: string) => {
    try {
      const headers = await getHeaders();
      const body = id ? JSON.stringify({ id }) : undefined;
      const res = await fetch('/api/sync/trigger', { method: 'POST', headers, body });
      if (!res.ok) throw new Error("Gagal mengirim perintah sinkronisasi");
      
      // Berikan waktu sedikit agar SQLite commit transaksi 
      await new Promise(r => setTimeout(r, 1500));
      
      await fetchConfigs(); // refresh data sync time
      await fetchData(); // AUTO REFRESH data global untuk menu Job Order, Work Order, dll
      
      alert(`Trigger sinkronisasi ${id ? 'spesifik' : 'semua'} selesai! Semua menu sudah memuat data terbaru.`);
    } catch (e) {
      alert("Gagal melakukan sinkronisasi manual. Pastikan sesi Anda aktif.");
    }
  };

  const handleSaveSync = async () => {
    if (!formConfigId || !formName) {
       setSyncStatusMsg("Error: ID dan Nama Konfigurasi wajib diisi.");
       return;
    }
    
    // If editing and no new curl command provided, we might just be updating name/id.
    // But typically they want to update headers. 
    if (!editingId && !curlCommand) {
       setSyncStatusMsg("Error: Script cURL (bash) wajib diisi untuk konfigurasi baru.");
       return;
    }

    setIsSyncing(true);
    setSyncStatusMsg("");
    
    try {
      let url = "";
      let headers: Record<string,string> = {};

      if (curlCommand) {
        // Basic cURL parsing
        let urlMatch = curlCommand.match(/curl\s+'([^']+)'/);
        if (!urlMatch) urlMatch = curlCommand.match(/curl\s+"([^"]+)"/);
        if (!urlMatch) urlMatch = curlCommand.match(/curl\s+([^ ]+)/);
        
        url = urlMatch ? urlMatch[1] : '';
        if (!url) throw new Error("Gagal mendeteksi URL dari format cURL yang diberikan.");

        const headerRegex = /-H\s+['"]([^'"]+)['"]/g;
        let match;
        while ((match = headerRegex.exec(curlCommand)) !== null) {
          const headerStr = match[1];
          const splitIndex = headerStr.indexOf(':');
          if (splitIndex > -1) {
            const key = headerStr.slice(0, splitIndex).trim();
            const value = headerStr.slice(splitIndex + 1).trim();
            headers[key] = value;
          }
        }

        // Parse -b or --cookie
        const cookieRegex = /(?:-b|--cookie)\s+['"]([^'"]+)['"]/g;
        let cookieMatch;
        while ((cookieMatch = cookieRegex.exec(curlCommand)) !== null) {
          if (!headers['cookie'] && !headers['Cookie']) {
             headers['Cookie'] = cookieMatch[1];
          } else {
             headers['Cookie'] = (headers['Cookie'] || headers['cookie']) + '; ' + cookieMatch[1];
          }
        }
      }

      // If updating without a new curl command, we must fetch the existing one to not overwrite with blanks
      let payload: any = {
         id: formConfigId,
         name: formName,
         interval_type: intervalType,
         interval_value: parseInt(intervalValue, 10) || 1,
         last_sync: lastSyncDate,
         is_active: true
      };

      if (curlCommand) {
        payload.url = url;
        payload.headers = JSON.stringify(headers);
      }

      const { error } = await api.from('sync_configs').upsert(payload, { onConflict: 'id' });
      if (error) throw error;

      setSyncStatusMsg("Berhasil disimpan!");
      setTimeout(() => {
         setIsModalOpen(false);
         fetchConfigs();
      }, 1500);
    } catch(e: any) {
       setSyncStatusMsg(`Error: ${e.message}`);
    } finally {
       setIsSyncing(false);
    }
  };

  const totalPages = Math.ceil(configs.length / itemsPerPage);
  const paginatedConfigs = configs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="p-8 space-y-6 w-full">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-2xl text-slate-800 tracking-tight">API Sync Management</h2>
          <p className="text-sm text-slate-500 mt-1">Kelola integrasi dengan API eksternal secara otomatis dan berkala.</p>
        </div>
        <div className="flex items-center gap-3">
          <input 
             type="file" 
             id="import-config" 
             accept=".json" 
             className="hidden" 
             onChange={handleImport} 
          />
          <button 
            onClick={() => document.getElementById('import-config')?.click()}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all border border-slate-200"
            title="Import JSON Configuration"
          >
            <Download className="w-4 h-4" /> Import
          </button>
          <button 
            onClick={handleExport}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all border border-slate-200"
            title="Export JSON Configuration"
          >
            <Upload className="w-4 h-4" /> Export
          </button>
          <button 
            onClick={() => triggerManualSync()}
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all border border-slate-200"
          >
            <RefreshCw className="w-4 h-4" /> Sinkronisasi Semua
          </button>
          <button 
            onClick={handleAdd}
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-all shadow-lg shadow-[#FDB913]/20"
          >
            <Plus className="w-4 h-4" /> Tambah Konfigurasi
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                <th className="px-6 py-4 border-b border-slate-100">No</th>
                <th className="px-6 py-4 border-b border-slate-100">ID Konfigurasi</th>
                <th className="px-6 py-4 border-b border-slate-100">Nama (Deskripsi)</th>
                <th className="px-6 py-4 border-b border-slate-100">Jadwal (Interval)</th>
                <th className="px-6 py-4 border-b border-slate-100">Target URL</th>
                <th className="px-6 py-4 border-b border-slate-100">Status</th>
                <th className="px-6 py-4 border-b border-slate-100">Terakhir Sinkronisasi</th>
                <th className="px-6 py-4 border-b border-slate-100 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {configs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-400 text-sm">
                    Belum ada konfigurasi API Sync. Silakan tambah baru.
                  </td>
                </tr>
              ) : (
                paginatedConfigs.map((cfg, idx) => (
                  <tr key={cfg.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 text-xs font-medium text-slate-500">
                      {(currentPage - 1) * itemsPerPage + idx + 1}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-xs font-semibold bg-slate-100 px-2 py-1 rounded text-slate-600">
                        {cfg.id}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-medium text-sm text-slate-800">
                      {cfg.name}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-600">
                      Tiap {cfg.interval_value} {cfg.interval_type === 'minutes' ? 'Menit' : cfg.interval_type === 'hours' ? 'Jam' : 'Hari'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="max-w-[150px] truncate text-xs text-slate-500 font-mono" title={cfg.url}>
                        {cfg.url || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <button 
                        onClick={() => toggleActive(cfg)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors border ${cfg.is_active ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' : 'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200'}`}
                      >
                        {cfg.is_active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                        {cfg.is_active ? 'Aktif' : 'Nonaktif'}
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      {cfg.last_sync ? (
                        <div className={`flex items-center gap-1.5 text-xs w-fit px-2 py-1 rounded-md ${cfg.is_active ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 bg-slate-100'}`}>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {cfg.last_sync}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <Clock className="w-3.5 h-3.5" />
                          Belum pernah
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => triggerManualSync(cfg.id)}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="Sinkronisasi Baris Ini"
                        >
                          <Zap className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleEdit(cfg)}
                          className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit Konfigurasi"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(cfg.id)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Hapus"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Menampilkan <span className="font-bold text-slate-700">{paginatedConfigs.length}</span> dari <span className="font-bold text-slate-700">{configs.length}</span> data
          </p>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="p-1.5 border border-slate-200 rounded-lg text-slate-400 hover:text-[#FDB913] hover:border-[#FDB913]/30 disabled:opacity-50 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 px-3">
              <span className="text-xs font-bold text-slate-600">
                {currentPage} <span className="text-slate-400 font-medium mx-1">/</span> {totalPages || 1}
              </span>
            </div>
            <button 
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="p-1.5 border border-slate-200 rounded-lg text-slate-400 hover:text-[#FDB913] hover:border-[#FDB913]/30 disabled:opacity-50 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
              onClick={() => setIsModalOpen(false)}
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-600">
                    <Server className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">
                      {editingId ? 'Edit Konfigurasi API' : 'Setup Auto Sync Baru'}
                    </h2>
                    <p className="text-xs text-slate-500">Konfigurasi token, headers, dan target URL via bash cURL</p>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <div className="p-6 space-y-4 overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">ID Konfigurasi</label>
                    <select 
                      value={formConfigId}
                      onChange={e => setFormConfigId(e.target.value)}
                      disabled={!!editingId} // ID tak bisa diubah jika edit
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-500 transition-all disabled:opacity-60"
                    >
                      <option value="" disabled>Pilih Modul Tabel / API</option>
                      <option value="WorkOrders">WorkOrders (Data WO Utama)</option>
                      <option value="WorkOrderDetails">WorkOrderDetails (Rincian Pekerjaan WO)</option>
                      <option value="JobOrders">JobOrders (Data JO Utama)</option>
                      <option value="Locations">Locations (Master Data Slipway/Lokasi)</option>
                      <option value="Services">Services (Master Data Docking Type)</option>
                      <option value="Vendors">Vendors (Master Data Vendor)</option>
                      <option value="Companies">Companies (Master Data Perusahaan)</option>
                      <option value="ShipTypes">ShipTypes (Master Tipe Kapal)</option>
                      <option value="MasterComponents">MasterComponents (Master Material / Sparepart)</option>
                      <option value="Ships">Ships (Master Data Kapal)</option>
                      <option value="Employees">Employees (Master Data Karyawan)</option>
                      <option value="Materials">Materials (Master Data Material)</option>
                      <option value="Invoices">Invoices (Data Tagihan)</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nama / Deskripsi</label>
                    <input 
                      type="text" 
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-500 transition-all"
                      placeholder="e.g. Work Orders Eksternal"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Durasi Interval</label>
                    <input 
                      type="number" 
                      min="1"
                      value={intervalValue}
                      onChange={e => setIntervalValue(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-500 transition-all"
                      placeholder="e.g. 5"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Satuan Waktu</label>
                    <select 
                      value={intervalType}
                      onChange={e => setIntervalType(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-500 transition-all"
                    >
                      <option value="minutes">Menit</option>
                      <option value="hours">Jam</option>
                      <option value="days">Hari</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    Waktu Sinkronisasi Terakhir (Last Sync)
                  </label>
                  <div className="flex gap-2">
                    <input 
                      type="datetime-local" 
                      step="1"
                      value={lastSyncDate ? lastSyncDate.replace(' ', 'T') : ""}
                      onChange={e => setLastSyncDate(e.target.value ? e.target.value.replace('T', ' ') : "")}
                      className="w-full px-4 py-2.5 bg-indigo-50/30 border border-indigo-200 rounded-xl text-sm outline-none focus:border-indigo-500 transition-all font-mono text-indigo-900"
                    />
                    <button 
                      title="Clear (Full Sync)"
                      onClick={() => setLastSyncDate("")}
                      className="px-4 py-2.5 bg-red-50 text-red-600 rounded-xl text-sm font-bold border border-red-100 hover:bg-red-100 transition flex items-center justify-center shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium pt-1">Gunakan tombol 'X' (Clear) untuk memaksa sistem menarik <b>seluruh data historis dari awal</b> (Full Sync).</p>
                </div>

                <div className="space-y-1.5 pt-2">
                  <div className="flex justify-between items-end">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Script cURL (Bash Format)</label>
                    {editingId && <span className="text-[10px] text-amber-500 bg-amber-50 px-2 py-0.5 rounded font-medium">Ubah query params di tabel bawah, atau langsung dari script cURL ini</span>}
                  </div>
                  <textarea 
                    value={curlCommand}
                    onChange={e => setCurlCommand(e.target.value)}
                    placeholder={"curl 'https://api.external.com/v1/data?page=1' \\\n  -H 'accept: application/json'"}
                    className="w-full h-40 p-4 text-xs font-mono rounded-xl bg-slate-900 border-slate-800 text-emerald-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                  <p className="text-[10px] text-slate-400 pt-1">
                    Script cURL akan secara otomatis mengekstrak Headers (termasuk Cookie) dan Query Parameters.
                  </p>
                </div>

                {/* URL QUERY PARAMETERS */}
                {baseUrl && (
                  <div className="space-y-3 bg-slate-50 rounded-xl p-4 border border-slate-200">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Query Parameters</label>
                      <button 
                        onClick={handleAddParam}
                        className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded"
                      >
                        <Plus className="w-3 h-3" /> Tambah Param
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5 mb-3">
                      <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Base URL</label>
                      <input 
                        type="text" 
                        value={baseUrl}
                        onChange={(e) => {
                          setBaseUrl(e.target.value);
                          updateCurlCommandUrl(e.target.value, queryParams);
                        }}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500 transition-all font-mono text-slate-600"
                        placeholder="https://api.external.com/v1/data"
                      />
                    </div>
                    
                    {queryParams.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">Tidak ada query parameter.</p>
                    ) : (
                      <div className="space-y-2">
                        {queryParams.map((p) => (
                          <div key={p.id} className={`flex items-center gap-2 ${p.active === false ? 'opacity-50' : ''}`}>
                            <input 
                              type="checkbox"
                              checked={p.active !== false}
                              onChange={(e) => handleParamChange(p.id, 'active', e.target.checked)}
                              className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                              title="Enable/Disable parameter ini"
                            />
                            <input
                              type="text"
                              value={p.key}
                              onChange={(e) => handleParamChange(p.id, 'key', e.target.value)}
                              placeholder="Key"
                              className={`w-1/3 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500 transition-all font-mono ${p.active === false ? 'line-through text-slate-400 bg-slate-50' : ''}`}
                            />
                            <input
                              type="text"
                              value={p.value}
                              onChange={(e) => handleParamChange(p.id, 'value', e.target.value)}
                              placeholder="Value"
                              className={`flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500 transition-all font-mono ${p.active === false ? 'text-slate-400 bg-slate-50' : ''}`}
                            />
                            <button
                              onClick={() => handleRemoveParam(p.id)}
                              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {formConfigId === 'JobOrders' && (
                  <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 mt-2">
                    <h4 className="text-xs font-bold text-indigo-800 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-indigo-500" />
                      Active Field Mapping (Job Order ➔ Projects Table)
                    </h4>
                    <div className="grid grid-cols-2 text-[10px] gap-x-6 gap-y-1">
                      <div className="flex justify-between border-b border-indigo-200/60 pb-1 mb-1">
                        <span className="text-slate-500 font-bold uppercase">API JSON Field</span>
                        <span className="font-bold text-indigo-700 uppercase">Database Column</span>
                      </div>
                      <div className="flex justify-between border-b border-indigo-200/60 pb-1 mb-1 hidden sm:flex">
                        <span className="text-slate-500 font-bold uppercase">API JSON Field</span>
                        <span className="font-bold text-indigo-700 uppercase">Database Column</span>
                      </div>
                      
                      <div className="flex justify-between py-0.5"><span className="font-mono text-slate-500">code</span><span className="font-mono text-indigo-700">idproject</span></div>
                      <div className="flex justify-between py-0.5"><span className="font-mono text-slate-500">m_ship_name</span><span className="font-mono text-indigo-700">shipname</span></div>
                      <div className="flex justify-between py-0.5"><span className="font-mono text-slate-500">m_customer_name</span><span className="font-mono text-indigo-700">cust_company</span></div>
                      <div className="flex justify-between py-0.5"><span className="font-mono text-slate-500">approval_status</span><span className="font-mono text-indigo-700">approval_status</span></div>
                      <div className="flex justify-between py-0.5"><span className="font-mono text-slate-500">est_start</span><span className="font-mono text-indigo-700">est_start</span></div>
                      <div className="flex justify-between py-0.5"><span className="font-mono text-slate-500">est_finish</span><span className="font-mono text-indigo-700">est_finish</span></div>
                      <div className="flex justify-between py-0.5"><span className="font-mono text-slate-500">total_price</span><span className="font-mono text-indigo-700">price_contract</span></div>
                      <div className="flex justify-between py-0.5"><span className="font-mono text-slate-500">created_at</span><span className="font-mono text-indigo-700">create_date</span></div>
                    </div>
                    <p className="text-[9px] text-indigo-500/80 mt-3 italic">* Mapping di atas dieksekusi secara otomatis & native oleh Background Server.</p>
                  </div>
                )}

                {syncStatusMsg && (
                  <div className={`p-3 text-xs font-semibold rounded-xl flex items-center gap-2 ${syncStatusMsg.includes('Error') ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>
                    {syncStatusMsg.includes('Error') ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                    {syncStatusMsg}
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/50">
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="px-6 py-2.5 text-sm font-semibold rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition"
                >
                  Batal
                </button>
                <button 
                  onClick={handleSaveSync}
                  disabled={isSyncing}
                  className="px-8 py-2.5 text-sm font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-lg shadow-indigo-500/30 disabled:opacity-50 flex items-center gap-2"
                >
                  {isSyncing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Simpan Konfigurasi
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
