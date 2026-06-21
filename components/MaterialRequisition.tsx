import React, { useState, useRef, useEffect, useMemo } from 'react';
import { getHeaders, api } from '@/lib/api-client';
import { 
  Package, 
  Search, 
  Filter, 
  Download, 
  ChevronDown, 
  FileText,
  Calendar,
  Building2,
  Ship,
  User,
  Code,
  X,
  Truck,
  CheckCircle2,
  Clock,
  Copy
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useData } from '@/context/DataContext';

// Sample data from the user
const MOCK_DATA = [
  {
    "id": 103647,
    "code": "RQ26060448/YWTS",
    "date": "2026-06-15",
    "t_job_order_id": 1160,
    "referensi": null,
    "flag_delivered": true,
    "m_employee_id": 22,
    "m_branch_id": 1,
    "created_at": "2026-06-15 17:31:24",
    "updated_at": "2026-06-15 17:31:24",
    "created_by": 26,
    "type": "planing",
    "flag_finalize": true,
    "m_component_id": 382,
    "unit": "Tbg",
    "quantity": "2",
    "description": "Liquid Gas Welding",
    "part_no": "Argon UHP",
    "wo_code": null,
    "m_vendor_name": null,
    "jo_code": "DRG26DK P028/YWTS",
    "m_ship_name": "HIU MACAN TUTUL 02",
    "m_customer_name": "PSDKP BENOA",
    "code_requester": "RQ26060448/YWTS - Dwi Yufa Sulistiono",
    "m_employee": {
        "id": 22,
        "name": "Dwi Yufa Sulistiono",
        "position": "Head of Project",
        "email": "dwi.sulistiono@samudera.id",
    }
  }
];

export default function MaterialRequisition() {
  const { projects } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [data, setData] = useState<any[]>(MOCK_DATA);
  const [masterComponentsMap, setMasterComponentsMap] = useState<Record<string, any>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDetailItem, setSelectedDetailItem] = useState<any | null>(null);
  const itemsPerPage = 10;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch Master Components for mapping material descriptions
  useEffect(() => {
    const fetchComponents = async () => {
      try {
        const { data, error } = await api.from('master_components').select();
        if (!error && data) {
          const map: Record<string, any> = {};
          data.forEach((c: any) => {
            const cleanId = c.id?.toString().replace(/\.0$/, '');
            map[cleanId] = c;
          });
          setMasterComponentsMap(map);
        }
      } catch (err) {
        console.error("Failed to load master components", err);
      }
    };
    fetchComponents();
  }, []);

  useEffect(() => {
    const fetchSyncData = async () => {
      setIsLoading(true);
      try {
        const headers = await getHeaders();
        const res = await fetch('/api/cache/MaterialRequisitions', { headers });
        if (res.ok) {
          const result = await res.json();
          
          // result usually has { last_sync: "...", data: <Samudera Response> }
          let apiResponse = result.data;
          
          // Sometimes result is directly the array if endpoint doesn't wrap
          if (!apiResponse && Array.isArray(result)) {
            apiResponse = result;
          }

          if (apiResponse) {
            if (Array.isArray(apiResponse)) {
              setData(apiResponse);
            } else if (apiResponse.data && Array.isArray(apiResponse.data)) {
              setData(apiResponse.data);
            } else if (apiResponse.items && Array.isArray(apiResponse.items)) {
              setData(apiResponse.items);
            } else {
              setData([apiResponse]);
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch MaterialRequisitions cache", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSyncData();
  }, []);

  const handleImportJson = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsedData = JSON.parse(content);
        
        // Handle if the JSON is an array or wrapped in an object like { "data": [...] }
        let newItems: any[] = [];
        if (Array.isArray(parsedData)) {
          newItems = parsedData;
        } else if (parsedData.data && Array.isArray(parsedData.data)) {
          newItems = parsedData.data;
        } else {
          // If it's a single object, push it
          newItems = [parsedData];
        }

        // Add new items to state, ensuring no duplicates by ID if possible
        setData(prev => {
          const existingIds = new Set(prev.map(item => item.id));
          const uniqueNewItems = newItems.filter(item => !existingIds.has(item.id));
          return [...prev, ...uniqueNewItems];
        });

        alert(`Berhasil mengimpor ${newItems.length} data permintaan material.`);
      } catch (error) {
        console.error("Error parsing JSON:", error);
        alert("Gagal membaca file JSON. Pastikan format file sudah benar.");
      }
    };
    reader.readAsText(file);
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const filteredData = data.filter(item => {
    const project = projects.find(p => p.id_siaga?.toString() === item.t_job_order_id?.toString());
    const comp = masterComponentsMap[item.m_component_id?.toString()];
    
    const searchCode = (item.code || '').toLowerCase();
    const searchDesc = (item.description || comp?.description || comp?.description_code || '').toLowerCase();
    const searchShip = (item.m_ship_name || project?.shipname || '').toLowerCase();
    const searchJO = (item.jo_code || project?.idproject || '').toLowerCase();
    
    const term = searchTerm.toLowerCase();
    return searchCode.includes(term) || searchDesc.includes(term) || searchShip.includes(term) || searchJO.includes(term);
  });

  const stats = useMemo(() => {
    return {
      total: filteredData.length,
      delivered: filteredData.filter(d => d.flag_delivered).length,
      pending: filteredData.filter(d => !d.flag_delivered).length,
      finalized: filteredData.filter(d => d.flag_finalize).length,
    };
  }, [filteredData]);

  // Group by date for chart
  const chartData = useMemo(() => {
    const countsByDate: Record<string, number> = {};
    filteredData.forEach(d => {
      const dateStr = d.date || d.created_at?.split(' ')[0];
      if (dateStr) {
        countsByDate[dateStr] = (countsByDate[dateStr] || 0) + 1;
      }
    });

    const sortedDates = Object.keys(countsByDate).sort();
    const lastDates = sortedDates.slice(-14); // 14 hari terakhir yg ada datanya
    const maxCount = Math.max(...lastDates.map(d => countsByDate[d]), 1);
    
    return {
      dates: lastDates,
      counts: lastDates.map(d => countsByDate[d]),
      maxCount,
    };
  }, [filteredData]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;
  const paginatedData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="p-4 lg:p-8 w-full space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <Package className="w-8 h-8 text-[#FDB913]" />
            Request Material
          </h1>
          <p className="text-slate-500 mt-2">Kelola dan pantau permintaan material dari API Samudera.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm">
            <Filter className="w-4 h-4" />
            Filter
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-xl font-bold hover:bg-indigo-100 transition-colors flex items-center gap-2 shadow-sm"
          >
            <Download className="w-4 h-4" />
            Import JSON
          </button>
          <input 
            type="file" 
            accept=".json" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleImportJson} 
          />
          <button className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm">
            <Download className="w-4 h-4 rotate-180" />
            Export
          </button>
          <button className="px-4 py-2 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors shadow-sm shadow-slate-900/10">
            + Request Baru
          </button>
        </div>
      </div>

      {/* KPI Dashboard Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="p-5 rounded-2xl border bg-white border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center gap-4 transition-all hover:shadow-md">
          <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-500 w-fit">
            <Package className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider truncate">Total Requests</p>
            <h3 className="text-2xl font-bold mt-1 truncate">{stats.total}</h3>
          </div>
        </div>

        <div className="p-5 rounded-2xl border bg-white border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center gap-4 transition-all hover:shadow-md">
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500 w-fit">
            <Truck className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider truncate">Delivered</p>
            <h3 className="text-2xl font-bold mt-1 truncate">{stats.delivered}</h3>
          </div>
        </div>

        <div className="p-5 rounded-2xl border bg-white border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center gap-4 transition-all hover:shadow-md">
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-500 w-fit">
            <Clock className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider truncate">Pending</p>
            <h3 className="text-2xl font-bold mt-1 truncate">{stats.pending}</h3>
          </div>
        </div>

        <div className="p-5 rounded-2xl border bg-white border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center gap-4 transition-all hover:shadow-md">
          <div className="p-3 rounded-xl bg-blue-500/10 text-blue-500 w-fit">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider truncate">Finalized</p>
            <h3 className="text-2xl font-bold mt-1 truncate">{stats.finalized}</h3>
          </div>
        </div>
      </div>

      {/* Bar Chart Section */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm mb-6">
        <h3 className="text-sm font-bold text-slate-800 mb-6 flex items-center gap-2">
          <Package className="w-4 h-4 text-indigo-500" /> Trend Permintaan Material
        </h3>
        {chartData.dates.length > 0 ? (
          <div className="flex items-end gap-2 h-40 mt-4 px-2">
            {chartData.dates.map((date, idx) => {
               const count = chartData.counts[idx];
               const heightPct = Math.max((count / chartData.maxCount) * 100, 2); // min 2% height
               
               return (
                 <div key={date} className="flex-1 flex flex-col justify-end items-center group relative h-full">
                   <div 
                     className="w-full max-w-[40px] bg-indigo-100 group-hover:bg-indigo-500 rounded-t-lg transition-all duration-500 relative cursor-pointer"
                     style={{ height: `${heightPct}%` }}
                   >
                     <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-xs px-2.5 py-1 rounded-lg pointer-events-none whitespace-nowrap z-10 font-medium">
                       {count} Request
                       <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                     </div>
                   </div>
                   <div className="mt-3 text-[10px] font-medium text-slate-400 group-hover:text-slate-700 transition-colors">
                     {date.substring(5)} {/* Tampilkan MM-DD */}
                   </div>
                 </div>
               );
            })}
          </div>
        ) : (
          <div className="h-40 flex items-center justify-center text-slate-400 text-sm border-2 border-dashed border-slate-100 rounded-xl">
            Belum ada data riwayat permintaan untuk ditampilkan
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-6">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:w-96">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Cari berdasarkan kode, deskripsi, atau kapal..." 
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FDB913]/50 focus:border-[#FDB913] transition-all bg-white text-sm"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-400">
                <th className="py-3.5 px-6 w-16">No.</th>
                <th className="py-3.5 px-6">ID / Kode Req</th>
                <th className="py-3.5 px-6">Material & Qty</th>
                <th className="py-3.5 px-6">Referensi JO & Kapal</th>
                <th className="py-3.5 px-6">Requester</th>
                <th className="py-3.5 px-6 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500"></div>
                      <p>Memuat data permintaan material...</p>
                    </div>
                  </td>
                </tr>
              ) : paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    Tidak ada data request material yang sesuai.
                  </td>
                </tr>
              ) : (
                paginatedData.map((item, index) => {
                  const project = projects.find(p => p.id_siaga?.toString() === item.t_job_order_id?.toString());
                  const comp = masterComponentsMap[item.m_component_id?.toString()];
                  
                  const joCode = item.jo_code || project?.idproject || '-';
                  const shipName = item.m_ship_name || project?.shipname || '-';
                  const description = item.description || comp?.description_code || comp?.description || `Material ID: ${item.m_component_id}`;
                  const partNo = item.part_no || comp?.part_no || '-';
                  const unit = item.unit || comp?.unit || '-';

                  return (
                  <tr 
                    key={item.id} 
                    className={`hover:bg-indigo-500/5 transition cursor-pointer ${selectedDetailItem?.id === item.id ? 'bg-indigo-500/10' : ''}`}
                    onClick={() => setSelectedDetailItem(item)}
                  >
                    <td className="py-3.5 px-6 text-xs font-semibold text-slate-500">
                      {(currentPage - 1) * itemsPerPage + index + 1}
                    </td>
                    <td className="py-3.5 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
                          <Package className="w-5 h-5 text-indigo-500" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-700">{item.code}</span>
                          </div>
                          <span className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <Calendar className="w-3.5 h-3.5" /> {item.date || item.created_at?.split(' ')[0] || '-'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-6">
                      <p className="font-bold text-slate-800">{description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-slate-500 font-mono bg-slate-100 px-1.5 py-0.5 rounded">ID: {item.m_component_id || '-'}</span>
                        <span className="text-xs text-slate-500">Part: {partNo}</span>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold text-[10px] border border-blue-100">
                          {item.quantity} {unit}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-6">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-xs text-slate-700">
                          <Ship className="w-3.5 h-3.5 text-slate-400" />
                          <span className="font-medium truncate max-w-[150px]">{shipName}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                          <Building2 className="w-3 h-3 text-slate-400" />
                          <span className="truncate max-w-[150px]">{joCode}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-6">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center shrink-0 border border-slate-300">
                          <User className="w-3.5 h-3.5 text-slate-500" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-700 truncate">{item.m_employee?.name || '-'}</p>
                          <p className="text-[10px] text-slate-500 truncate">{item.m_employee?.position || '-'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      <div className="flex flex-col gap-1.5 items-end">
                        {item.flag_delivered ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold text-[10px] border border-emerald-200">
                            Delivered
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-amber-50 text-amber-700 font-bold text-[10px] border border-amber-200">
                            Pending Delivery
                          </span>
                        )}
                        {item.flag_finalize && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold text-[10px] border border-indigo-200">
                            Finalized
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paging Footer (Mirrored from WorkOrderDashboard) */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between rounded-b-2xl">
          <span className="text-xs font-semibold text-slate-400">
            Menampilkan {filteredData.length === 0 ? 0 : Math.min(filteredData.length, (currentPage - 1) * itemsPerPage + 1)}-{Math.min(filteredData.length, currentPage * itemsPerPage)} dari {filteredData.length} data
          </span>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 font-medium text-xs hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed bg-slate-100 transition-colors"
            >
              Sebelumnya
            </button>
            <span className="text-xs font-semibold px-2">{currentPage} / {totalPages}</span>
            <button 
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 font-medium text-xs hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed bg-slate-100 transition-colors"
            >
              Selanjutnya
            </button>
          </div>
        </div>
      </div>

      {/* Detail View Modal */}
      <AnimatePresence>
        {selectedDetailItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
              onClick={() => setSelectedDetailItem(null)}
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-600">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">Detail Permintaan Material</h2>
                    <p className="text-xs text-slate-500">Kode: {selectedDetailItem.code || `ID: ${selectedDetailItem.id}`}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedDetailItem(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              
              <div className="p-6 overflow-y-auto space-y-6">
                {/* Informasi Utama */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      <Package className="w-4 h-4 text-indigo-500" /> Informasi Material
                    </h3>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-3">
                      <div>
                        <p className="text-xs text-slate-500">Deskripsi Material</p>
                        <p className="font-semibold text-slate-800">
                          {selectedDetailItem.description || masterComponentsMap[selectedDetailItem.m_component_id?.toString()]?.description_code || masterComponentsMap[selectedDetailItem.m_component_id?.toString()]?.description || '-'}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-slate-500">Part No.</p>
                          <p className="font-semibold text-slate-800">{selectedDetailItem.part_no || masterComponentsMap[selectedDetailItem.m_component_id?.toString()]?.part_no || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Component ID</p>
                          <p className="font-semibold text-slate-800 font-mono">{selectedDetailItem.m_component_id || '-'}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-slate-500">Kuantitas</p>
                          <p className="font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded inline-block">
                            {selectedDetailItem.quantity} {selectedDetailItem.unit || masterComponentsMap[selectedDetailItem.m_component_id?.toString()]?.unit || ''}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Tanggal Dibutuhkan</p>
                          <p className="font-semibold text-slate-800">{selectedDetailItem.needed_date || selectedDetailItem.date || '-'}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-indigo-500" /> Referensi Proyek
                    </h3>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-3">
                      <div>
                        <p className="text-xs text-slate-500">Job Order Code</p>
                        <p className="font-semibold text-slate-800">
                          {selectedDetailItem.jo_code || projects.find(p => p.id_siaga?.toString() === selectedDetailItem.t_job_order_id?.toString())?.idproject || '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Nama Kapal</p>
                        <p className="font-semibold text-slate-800 flex items-center gap-2">
                          <Ship className="w-4 h-4 text-slate-400" />
                          {selectedDetailItem.m_ship_name || projects.find(p => p.id_siaga?.toString() === selectedDetailItem.t_job_order_id?.toString())?.shipname || '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Job Order ID (Siaga)</p>
                        <p className="font-semibold text-slate-800 font-mono">{selectedDetailItem.t_job_order_id || '-'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Status dan Pemohon */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      <User className="w-4 h-4 text-indigo-500" /> Detail Pemohon
                    </h3>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-3">
                      <div>
                        <p className="text-xs text-slate-500">Pemohon (Requester)</p>
                        <p className="font-semibold text-slate-800">{selectedDetailItem.m_employee?.name || `Employee ID: ${selectedDetailItem.m_employee_id || '-'}`}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-slate-500">Dibuat Oleh</p>
                          <p className="font-semibold text-slate-800">{selectedDetailItem.created_by || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Branch ID</p>
                          <p className="font-semibold text-slate-800">{selectedDetailItem.m_branch_id || '-'}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-indigo-500" /> Status & Waktu
                    </h3>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-3">
                      <div>
                        <p className="text-xs text-slate-500 mb-1">Status Permintaan</p>
                        <div className="flex flex-wrap gap-2">
                          {selectedDetailItem.flag_delivered ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold text-xs border border-emerald-200">
                              Delivered
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 font-bold text-xs border border-amber-200">
                              Pending Delivery
                            </span>
                          )}
                          {selectedDetailItem.flag_finalize && (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 font-bold text-xs border border-indigo-200">
                              Finalized
                            </span>
                          )}
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-bold text-xs border border-slate-200 uppercase">
                            Type: {selectedDetailItem.type || '-'}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-slate-500">Waktu Dibuat</p>
                          <p className="font-medium text-slate-800 text-sm">{selectedDetailItem.created_at || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Update Terakhir</p>
                          <p className="font-medium text-slate-800 text-sm">{selectedDetailItem.updated_at || '-'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Raw JSON Debug Section (Inline) */}
                <div className="space-y-2 mt-8 pt-6 border-t border-slate-200">
                  <span className="text-xs font-bold uppercase text-slate-500 tracking-wider flex items-center justify-between cursor-pointer hover:text-slate-800 transition-colors" onClick={(e) => {
                    const wrapper = e.currentTarget.nextElementSibling;
                    if (wrapper) wrapper.classList.toggle('hidden');
                  }}>
                    <span>Lihat Raw JSON Response (Mode Debug)</span>
                    <span className="text-[10px] bg-slate-200 px-2 py-0.5 rounded-md text-slate-600 shadow-inner flex items-center gap-1">
                      <Code size={12} /> KLIK UNTUK TOGGLE
                    </span>
                  </span>
                  <div className="hidden relative mt-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(selectedDetailItem, null, 2));
                        alert('JSON dicopy ke clipboard!');
                      }}
                      className="absolute top-3 right-8 p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition border border-slate-700"
                      title="Copy JSON"
                    >
                      <Copy size={14} />
                    </button>
                    <pre className="text-xs p-5 pt-10 rounded-xl overflow-x-auto font-mono bg-slate-950 text-emerald-400 max-h-96 border border-slate-800 shadow-inner">
                      {JSON.stringify(selectedDetailItem, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                <button 
                  onClick={() => setSelectedDetailItem(null)}
                  className="px-6 py-2.5 text-sm font-semibold rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition"
                >
                  Tutup
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
