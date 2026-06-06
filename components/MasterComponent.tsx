import React, { useState, useEffect } from 'react';
import { Search, ChevronLeft, ChevronRight, RefreshCw, UploadCloud } from 'lucide-react';
import { useData } from '../context/DataContext';
import { api } from '../lib/api-client';

export default function MasterComponent() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data: responseData, error: responseError } = await api.from('master_components').select();
      if (responseError) throw new Error(responseError.message);
      setData(responseData || []);
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan saat mengambil data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      let rawData = JSON.parse(text);
      
      // Handle both direct array and wrapped in { data: [] }
      if (!Array.isArray(rawData)) {
         if (rawData.data && Array.isArray(rawData.data)) {
           rawData = rawData.data;
         } else {
           throw new Error("Format JSON tidak valid, harus berisi array.");
         }
      }

      if (rawData.length === 0) {
        throw new Error("File JSON kosong.");
      }

      // Sanitize data to fix float IDs like 15700.0 -> 15700
      rawData = rawData.map((item: any) => {
        if (item.id) {
          item.id = item.id.toString().replace(/\.0$/, '');
        }
        return item;
      });

      const { error } = await api.from('master_components').upsert(rawData, { onConflict: 'id' });
      if (error) throw error;
      
      await fetchData();
      alert(`Berhasil mengimpor ${rawData.length} data material!`);
    } catch (err: any) {
      console.error('Import error:', err);
      alert('Gagal mengimpor: ' + (err.message || 'Error tidak diketahui'));
    } finally {
      setImporting(false);
      if (e.target) e.target.value = '';
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredData = data.filter((item: any) => {
    const term = searchTerm.toLowerCase();
    const safeId = item.id?.toString().replace(/\.0$/, '') || '';
    const idMatch = safeId.toLowerCase().includes(term);
    const codeMatch = item.code?.toLowerCase().includes(term);
    const descMatch = item.description?.toLowerCase().includes(term);
    const itemCodeMatch = item.itemcode?.toLowerCase().includes(term);
    return idMatch || codeMatch || descMatch || itemCodeMatch;
  });

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedData = filteredData.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-2xl text-slate-800 tracking-tight">Master Component</h2>
          <p className="text-sm text-slate-500 mt-1">Kelola data material dan sparepart (Sinkronisasi dari API Samudera)</p>
        </div>
        <div className="flex gap-3">
          <label className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded-xl cursor-pointer transition-colors shadow-sm text-sm font-bold disabled:opacity-50">
            <UploadCloud className={`w-4 h-4 ${importing ? 'animate-pulse' : ''}`} />
            {importing ? 'Mengimpor...' : 'Import JSON'}
            <input 
              type="file" 
              accept=".json" 
              className="hidden" 
              onChange={handleImportJSON}
              disabled={importing}
            />
          </label>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center justify-center p-2.5 bg-white border border-slate-200 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all shadow-sm disabled:opacity-50"
            title="Refresh Data"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="relative max-w-sm w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Cari berdasarkan ID, kode, itemcode, atau deskripsi..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#FDB913]/50 focus:border-[#FDB913] transition-all bg-white"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500 font-medium bg-white px-3 py-1.5 rounded-lg border border-slate-200">
            Total: {filteredData.length}
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          {error ? (
            <div className="p-8 text-center text-rose-600 bg-rose-50 m-4 rounded-xl border border-rose-100">
              <p className="font-bold">{error}</p>
              <button onClick={fetchData} className="mt-4 px-4 py-2 bg-white rounded-lg shadow-sm border border-rose-200 hover:bg-rose-100 font-medium text-rose-700">Coba Lagi</button>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                  <th className="px-6 py-4 border-b border-slate-100 w-16 text-center">No</th>
                  <th className="px-6 py-4 border-b border-slate-100">ID</th>
                  <th className="px-6 py-4 border-b border-slate-100">Item Code</th>
                  <th className="px-6 py-4 border-b border-slate-100">Deskripsi</th>
                  <th className="px-6 py-4 border-b border-slate-100">Part No</th>
                  <th className="px-6 py-4 border-b border-slate-100">Tipe/Class</th>
                  <th className="px-6 py-4 border-b border-slate-100">Satuan</th>
                  <th className="px-6 py-4 border-b border-slate-100 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && data.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-slate-500">
                      <div className="flex justify-center mb-4"><RefreshCw className="w-8 h-8 animate-spin text-slate-400" /></div>
                      Sedang memuat data dari database...
                    </td>
                  </tr>
                ) : paginatedData.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-slate-500">
                      Tidak ada data yang ditemukan.
                    </td>
                  </tr>
                ) : (
                  paginatedData.map((item, index) => (
                    <tr key={item.id || index} className="group hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4 text-center text-sm text-slate-500">
                        {((currentPage - 1) * itemsPerPage) + index + 1}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-mono text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded-md inline-block">
                          {item.id?.toString().replace(/\.0$/, '')}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-900">{item.itemcode || item.code}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-slate-900 font-medium">{item.description_code || item.description}</div>
                        {item.remark && <div className="text-xs text-slate-500 mt-1 line-clamp-1">{item.remark}</div>}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {item.part_no || '-'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {item.type && <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">{item.type}</span>}
                          {item.class && <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">{item.class}</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-medium">
                        {item.unit || '-'}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider ${item.flag_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {item.flag_active ? 'ACTIVE' : 'INACTIVE'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Footer */}
        {!loading && (
          <div className="p-4 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Menampilkan <span className="font-bold text-slate-700">{paginatedData.length}</span> dari <span className="font-bold text-slate-700">{filteredData.length}</span> data
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
        )}
      </div>
    </div>
  );
}
