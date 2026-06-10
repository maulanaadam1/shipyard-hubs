import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart3, 
  DollarSign, 
  Calendar as CalendarIcon, 
  RefreshCw, 
  ChevronLeft, 
  ChevronRight,
  TrendingUp,
  Clock,
  Filter,
  PieChart
} from 'lucide-react';
import { api, getHeaders } from '@/lib/api-client';
import { useData } from '@/context/DataContext';

const MOCK_DATA: any[] = [];

export default function FinancialDashboard() {
  const { syncCache, setSyncCache, syncDates, setSyncDates } = useData();
  const [rawData, setRawData] = useState<any[]>(syncCache['WorkOrders'] || []);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncDate, setLastSyncDate] = useState<string>(syncDates['WorkOrders'] || '');
  const [financialData, setFinancialData] = useState<Record<string, { pending: number, final_cost: number, latest_date: string }>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  const [datePreset, setDatePreset] = useState("1month");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const [globalYear, setGlobalYear] = useState("all");
  const [globalProject, setGlobalProject] = useState("all");
  const [globalVendor, setGlobalVendor] = useState("all");

  // Cross-filtering states
  const [selectedWeekFilter, setSelectedWeekFilter] = useState<string | null>(null);
  const [selectedVendorFilter, setSelectedVendorFilter] = useState<string | null>(null);
  const [selectedShipFilter, setSelectedShipFilter] = useState<string | null>(null);

  // Clear cross-filters when date range changes
  useEffect(() => {
    setSelectedWeekFilter(null);
    setSelectedVendorFilter(null);
    setSelectedShipFilter(null);
    setCurrentPage(1);
  }, [datePreset, customStartDate, customEndDate]);

  const fetchSyncData = async () => {
    try {
      const { data } = await api.from('sync_configs').select('*').eq('id', 'WorkOrders');
      if (data && data.length > 0) {
        const syncConfig = data[0];
        if (syncConfig.last_response) {
          const parsed = JSON.parse(syncConfig.last_response);
          let list = [];
          if (Array.isArray(parsed)) list = parsed;
          else if (parsed.data && Array.isArray(parsed.data)) list = parsed.data;
          
          if (list.length > 0) {
            setRawData(list);
            setLastSyncDate(syncConfig.last_sync || '');

            // Update global cache
            setSyncCache(prev => ({ ...prev, WorkOrders: list }));
            setSyncDates(prev => ({ ...prev, WorkOrders: syncConfig.last_sync || '' }));
          }
        }
      }
    } catch(e) {
      console.error(e);
    }
  };

  useEffect(() => {
    let isMounted = true;
    
    const performAutoSync = async () => {
      setIsSyncing(true);
      try {
        const headers = await getHeaders();
        const body = JSON.stringify({ id: 'WorkOrders' });
        const res = await fetch('/api/sync/trigger', { method: 'POST', headers, body });
        if (res.ok && isMounted) {
          await fetchSyncData();
        }
      } catch (e) {
        // Silently ignore
      } finally {
        if (isMounted) setIsSyncing(false);
      }
    };

    if (syncCache['WorkOrders']) {
      performAutoSync();
    } else {
      fetchSyncData().then(() => {
        if (isMounted) performAutoSync();
      });
    }

    return () => { isMounted = false; };
  }, []);


  const triggerManualSync = async () => {
    setIsSyncing(true);
    try {
      const headers = await getHeaders();
      const body = JSON.stringify({ id: 'WorkOrders' });
      const res = await fetch('/api/sync/trigger', { method: 'POST', headers, body });
      if (!res.ok) throw new Error("Gagal");
      await fetchSyncData();
    } catch (e) {
      alert("Gagal melakukan sinkronisasi.");
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (rawData.length === 0) return;
    const fetchFinances = async () => {
      const ids = rawData.map(d => d.id);
      // Batch in groups of 50
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        try {
          const headers = await getHeaders();
          const res = await fetch('/api/work-orders/bulk-pending-approvals', {
            method: 'POST',
            headers,
            body: JSON.stringify({ ids: chunk.map(String) })
          });
          if (res.ok) {
            const map = await res.json();
            setFinancialData(prev => ({...prev, ...map}));
          }
        } catch (e) {}
      }
    };
    fetchFinances();
  }, [rawData]);

  const validData = useMemo(() => {
    return rawData.filter(item => {
      const fin = financialData[item.id];
      return fin && fin.final_cost > 0 && fin.latest_date;
    }).map(item => {
      const fin = financialData[item.id];
      const jo = item.jo_code || "N/A";
      const ship = item.m_ship_name || "N/A";
      
      return {
        ...item,
        shipName: ship,
        joCode: jo.toUpperCase(),
        vendorName: item.m_vendor_name || "Tanpa Vendor",
        final_cost: fin.final_cost,
        latest_date: fin.latest_date,
        pending: fin.pending
      };
    }).sort((a, b) => new Date(b.latest_date).getTime() - new Date(a.latest_date).getTime());
  }, [rawData, financialData]);

  const latestDatasetDate = useMemo(() => {
    if (validData.length === 0) return new Date();
    return new Date(validData[0].latest_date);
  }, [validData]);

  const filterOptions = useMemo(() => {
    const years = new Set<string>();
    const projects = new Set<string>();
    const vendors = new Set<string>();

    validData.forEach(item => {
      if (item.latest_date) years.add(item.latest_date.substring(0, 4));
      if (item.shipName) projects.add(item.shipName);
      if (item.vendorName) vendors.add(item.vendorName);
    });

    return {
      years: Array.from(years).sort().reverse(),
      projects: Array.from(projects).sort(),
      vendors: Array.from(vendors).sort()
    };
  }, [validData]);

  const dateFilteredData = useMemo(() => {
    const end = new Date(latestDatasetDate);
    const start = new Date(latestDatasetDate);

    if (datePreset === "1week") start.setDate(end.getDate() - 7);
    else if (datePreset === "2weeks") start.setDate(end.getDate() - 14);
    else if (datePreset === "3weeks") start.setDate(end.getDate() - 21);
    else if (datePreset === "1month") start.setMonth(end.getMonth() - 1);
    else if (datePreset === "2months") start.setMonth(end.getMonth() - 2);
    else if (datePreset === "3months") start.setMonth(end.getMonth() - 3);
    else if (datePreset === "6months") start.setMonth(end.getMonth() - 6);
    else if (datePreset === "custom") {
      const s = customStartDate ? new Date(customStartDate) : null;
      const e = customEndDate ? new Date(customEndDate) : null;
      if (s) start.setTime(s.getTime());
      if (e) end.setTime(e.getTime());
    }

    return validData.filter(item => {
      // Global filters
      if (globalYear !== "all" && !item.latest_date.startsWith(globalYear)) return false;
      if (globalProject !== "all" && item.shipName !== globalProject) return false;
      if (globalVendor !== "all" && item.vendorName !== globalVendor) return false;

      if (datePreset === "all") return true;
      const d = new Date(item.latest_date.replace(' ', 'T')).getTime();
      
      if (datePreset === "custom") {
        const sTime = customStartDate ? new Date(customStartDate).getTime() : 0;
        const eTime = customEndDate ? new Date(customEndDate).setHours(23, 59, 59, 999) : Infinity;
        return d >= sTime && d <= eTime;
      }
      
      return d >= start.getTime() && d <= end.getTime();
    });
  }, [validData, datePreset, customStartDate, customEndDate, latestDatasetDate, globalYear, globalProject, globalVendor]);

  const getStartOfWeek = (dateStr: string) => {
    if (!dateStr) return null;
    const cleanStr = dateStr.replace(' ', 'T');
    const d = new Date(cleanStr);
    if (isNaN(d.getTime())) return null;
    
    const day = d.getDay();
    // Week starts on Saturday (6)
    const daysToSubtract = (day + 1) % 7;
    const startOfWeek = new Date(d.setDate(d.getDate() - daysToSubtract));
    return startOfWeek.toISOString().split('T')[0];
  };

  const crossFilteredData = useMemo(() => {
    return dateFilteredData.filter(item => {
      let pass = true;
      if (selectedWeekFilter && getStartOfWeek(item.latest_date) !== selectedWeekFilter) pass = false;
      if (selectedVendorFilter && (item.vendorName || "Tanpa Vendor") !== selectedVendorFilter) pass = false;
      if (selectedShipFilter && (item.shipName || "Tanpa Proyek") !== selectedShipFilter) pass = false;
      return pass;
    });
  }, [dateFilteredData, selectedWeekFilter, selectedVendorFilter, selectedShipFilter]);

  const weeklyTrend = useMemo(() => {
    const groups: Record<string, number> = {};
    crossFilteredData.forEach(item => {
      const week = getStartOfWeek(item.latest_date);
      if (week) {
        groups[week] = (groups[week] || 0) + item.final_cost;
      }
    });

    return Object.keys(groups).sort().map(weekStr => {
      const startD = new Date(weekStr);
      const endD = new Date(startD);
      endD.setDate(startD.getDate() + 6);
      
      const formatShort = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const label = `${formatShort(startD)} - ${formatShort(endD)}`;

      return {
        week: weekStr,
        label: label,
        cost: groups[weekStr]
      };
    });
  }, [crossFilteredData]);

  const vendorTrend = useMemo(() => {
    const groups: Record<string, number> = {};
    crossFilteredData.forEach(item => {
      const vendorName = item.vendorName || "Tanpa Vendor";
      groups[vendorName] = (groups[vendorName] || 0) + item.final_cost;
    });

    return Object.keys(groups)
      .map(vendor => ({
        label: vendor,
        cost: groups[vendor]
      }))
      .sort((a, b) => b.cost - a.cost);
  }, [crossFilteredData]);

  const projectTrend = useMemo(() => {
    const groups: Record<string, number> = {};
    let total = 0;
    crossFilteredData.forEach(item => {
      const proj = item.shipName || "Tanpa Proyek";
      groups[proj] = (groups[proj] || 0) + item.final_cost;
      total += item.final_cost;
    });

    return Object.keys(groups)
      .map(proj => ({
        label: proj,
        cost: groups[proj],
        percentage: total > 0 ? (groups[proj] / total) * 100 : 0
      }))
      .sort((a, b) => b.cost - a.cost);
  }, [crossFilteredData]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return crossFilteredData.slice(startIndex, startIndex + itemsPerPage);
  }, [crossFilteredData, currentPage]);

  const totalPages = Math.ceil(crossFilteredData.length / itemsPerPage) || 1;

  const formatIDR = (value: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(value);
  };

  const totalPaymentValue = dateFilteredData.reduce((acc, curr) => acc + curr.final_cost, 0);

  const totalJO = useMemo(() => {
    const joSet = new Set<string>();
    dateFilteredData.forEach(item => {
      if (item.joCode) joSet.add(item.joCode);
    });
    return joSet.size;
  }, [dateFilteredData]);

  // Chart Rendering (SVG)
  const renderChart = () => {
    if (weeklyTrend.length === 0) return <div className="h-64 flex items-center justify-center text-slate-400">Belum ada data pembayaran</div>;
    
    const maxCost = Math.max(...weeklyTrend.map(t => t.cost), 1);
    const width = 1000;
    const height = 240;
    const padding = 40;
    const barWidth = Math.min(40, (width - 2 * padding) / weeklyTrend.length - 10);

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-64 overflow-visible">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((factor, i) => {
          const y = height - padding - (factor * (height - 2 * padding));
          return (
            <g key={i}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#e2e8f0" strokeDasharray="4 4" />
              <text x={padding - 10} y={y + 4} textAnchor="end" className="text-[10px] fill-slate-400 font-mono">
                {formatIDR(factor * maxCost).replace(',00', '')}
              </text>
            </g>
          );
        })}
        
        {/* Bars */}
        {weeklyTrend.map((item, idx) => {
          const x = padding + (idx * (width - 2 * padding)) / (weeklyTrend.length || 1) + ((width - 2 * padding) / (weeklyTrend.length || 1)) / 2;
          const barH = (item.cost / maxCost) * (height - 2 * padding);
          const y = height - padding - barH;
          
          return (
            <g 
              key={idx} 
              className="cursor-pointer transition-opacity hover:opacity-80 group"
              onClick={() => setSelectedWeekFilter(prev => prev === item.week ? null : item.week)}
            >
              <rect 
                x={x - barWidth / 2} 
                y={y} 
                width={barWidth} 
                height={barH} 
                fill={selectedWeekFilter && selectedWeekFilter !== item.week ? '#cbd5e1' : '#6366f1'} 
                rx="4" 
              />
              <text x={x} y={height - padding + 15} textAnchor="middle" className="text-[10px] fill-slate-500 font-medium">
                {item.label.split(' - ')[0]}
              </text>
              
              {/* Tooltip on hover */}
              <g className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <rect x={x - 60} y={y - 35} width={120} height={25} rx={4} fill="#1e293b" />
                <text x={x} y={y - 18} textAnchor="middle" className="text-[10px] fill-white font-mono font-bold">
                  {formatIDR(item.cost)}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
    );
  };

  // Vendor Chart Rendering (HTML Bars)
  const renderVendorChart = () => {
    if (vendorTrend.length === 0) return <div className="h-64 flex items-center justify-center text-slate-400">Belum ada data vendor</div>;

    const maxCost = vendorTrend[0].cost;

    return (
      <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
        {vendorTrend.map((v, i) => (
          <div 
            key={i} 
            className="flex flex-col gap-1.5 cursor-pointer group"
            onClick={() => setSelectedVendorFilter(prev => prev === v.label ? null : v.label)}
          >
            <div className="flex justify-between items-end">
              <span className={`text-xs font-bold truncate max-w-[200px] transition-colors ${selectedVendorFilter && selectedVendorFilter !== v.label ? 'text-slate-400' : 'text-slate-700 group-hover:text-indigo-600'}`} title={v.label}>{v.label}</span>
              <span className={`text-xs font-mono font-semibold transition-colors ${selectedVendorFilter && selectedVendorFilter !== v.label ? 'text-slate-400' : 'text-emerald-600'}`}>{formatIDR(v.cost)}</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-300 ${selectedVendorFilter && selectedVendorFilter !== v.label ? 'bg-slate-300' : 'bg-emerald-500'}`}
                style={{ width: `${Math.max((v.cost / maxCost) * 100, 2)}%` }}
              ></div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Project Pie Chart Rendering (Conic Gradient)
  const renderProjectChart = () => {
    if (projectTrend.length === 0) return <div className="h-64 flex items-center justify-center text-slate-400">Belum ada data proyek</div>;

    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];
    
    let currentAngle = 0;
    const gradientStops = projectTrend.map((p, i) => {
      const color = colors[i % colors.length];
      const start = currentAngle;
      currentAngle += p.percentage;
      return `${color} ${start}%, ${color} ${currentAngle}%`;
    }).join(', ');

    return (
      <div className="flex flex-col md:flex-row items-start md:items-center justify-start w-full gap-8 py-2">
        <div 
          className="w-48 h-48 rounded-full flex items-center justify-center shadow-inner shrink-0"
          style={{ background: `conic-gradient(${gradientStops})` }}
        >
          <div className="w-32 h-32 bg-white rounded-full shadow-sm flex items-center justify-center flex-col">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total</span>
            <span className="text-sm font-bold text-slate-800">{formatIDR(totalPaymentValue).replace(/,00$/, '').replace('Rp', '').trim()}</span>
          </div>
        </div>
        
        <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
          {projectTrend.map((p, i) => (
            <div 
              key={i} 
              className="flex items-center justify-between gap-3 text-sm cursor-pointer group p-2 hover:bg-slate-50 rounded-lg transition-colors"
              onClick={() => setSelectedShipFilter(prev => prev === p.label ? null : p.label)}
            >
              <div className="flex items-center gap-2 truncate">
                <div className={`w-3 h-3 rounded-full shrink-0 transition-opacity ${selectedShipFilter && selectedShipFilter !== p.label ? 'opacity-20' : ''}`} style={{ backgroundColor: colors[i % colors.length] }}></div>
                <span className={`text-xs font-semibold truncate transition-colors ${selectedShipFilter && selectedShipFilter !== p.label ? 'text-slate-400' : 'text-slate-700 group-hover:text-blue-600'}`} title={p.label}>{p.label}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`text-xs font-mono transition-colors ${selectedShipFilter && selectedShipFilter !== p.label ? 'text-slate-400' : 'text-slate-500'}`}>{formatIDR(p.cost)}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold transition-colors ${selectedShipFilter && selectedShipFilter !== p.label ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-700'}`}>{Math.round(p.percentage)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans p-4 md:p-8 space-y-6">
      
      <header className="flex flex-wrap justify-between items-start md:items-center gap-4 border-b pb-4">
        <div>
          <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800">Financial Dashboard</h2>
          <p className="text-xs md:text-sm text-slate-500 mt-1">Monitoring Arus Kas & Pembayaran Mingguan (Berdasarkan Approval Date)</p>
        </div>
        <div className="flex items-center gap-3">
          {lastSyncDate && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200">
              <Clock size={12} />
              <span>{lastSyncDate}</span>
            </div>
          )}
          <button
            onClick={triggerManualSync}
            disabled={isSyncing}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all shadow-sm font-semibold text-sm ${isSyncing ? 'bg-indigo-100 border-indigo-200 text-indigo-400' : 'bg-white border-slate-200 hover:bg-indigo-50 text-indigo-600 hover:border-indigo-200'}`}
          >
            <RefreshCw size={16} className={isSyncing ? "animate-spin" : ""} />
            {isSyncing ? 'Syncing...' : 'Sync Data'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 md:p-6 rounded-2xl border bg-white shadow-sm flex items-center gap-3 md:gap-4">
          <div className="p-3 md:p-4 rounded-2xl bg-blue-500/10 text-blue-500">
            <DollarSign className="w-6 h-6 md:w-7 md:h-7" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] md:text-xs font-semibold text-slate-400 uppercase tracking-wider leading-tight">Total Pembayaran Valid</p>
            <h3 className="text-lg md:text-xl lg:text-2xl font-bold mt-1 font-mono text-slate-800 leading-none break-all">{formatIDR(totalPaymentValue)}</h3>
          </div>
        </div>
        
        <div className="p-4 md:p-6 rounded-2xl border bg-white shadow-sm flex items-center gap-3 md:gap-4">
          <div className="p-3 md:p-4 rounded-2xl bg-emerald-500/10 text-emerald-500">
            <TrendingUp className="w-6 h-6 md:w-7 md:h-7" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] md:text-xs font-semibold text-slate-400 uppercase tracking-wider leading-tight">Jumlah Transaksi (WO)</p>
            <h3 className="text-lg md:text-xl lg:text-2xl font-bold mt-1 text-slate-800 leading-none break-words">{dateFilteredData.length} Dokumen</h3>
          </div>
        </div>

        <div className="p-4 md:p-6 rounded-2xl border bg-white shadow-sm flex items-center gap-3 md:gap-4">
          <div className="p-3 md:p-4 rounded-2xl bg-indigo-500/10 text-indigo-500">
            <CalendarIcon className="w-6 h-6 md:w-7 md:h-7" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] md:text-xs font-semibold text-slate-400 uppercase tracking-wider leading-tight">Jumlah Job Order (JO)</p>
            <h3 className="text-lg md:text-xl lg:text-2xl font-bold mt-1 text-slate-800 leading-none break-words">{totalJO} Dokumen</h3>
          </div>
        </div>
      </div>

      {/* Baris Filter Utama */}
      <div className="flex flex-col gap-3 p-4 rounded-xl border bg-white shadow-sm">
        <div className="flex items-center gap-2 text-slate-500">
          <Filter size={16} />
          <span className="text-sm font-semibold">Filter Utama:</span>
        </div>
        <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${datePreset === "custom" ? "lg:grid-cols-6" : "lg:grid-cols-4"}`}>
          <select 
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            value={globalYear}
            onChange={e => setGlobalYear(e.target.value)}
          >
            <option value="all">Tahun (Semua)</option>
            {filterOptions.years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          <select 
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 truncate"
            value={globalProject}
            onChange={e => setGlobalProject(e.target.value)}
          >
            <option value="all">Proyek Kapal (Semua)</option>
            {filterOptions.projects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <select 
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 truncate"
            value={globalVendor}
            onChange={e => setGlobalVendor(e.target.value)}
          >
            <option value="all">Vendor (Semua)</option>
            {filterOptions.vendors.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          <select 
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            value={datePreset}
            onChange={e => setDatePreset(e.target.value)}
          >
            <option value="all">Rentang Waktu (Semua)</option>
            <option value="1week">1 Minggu Terakhir</option>
            <option value="2weeks">2 Minggu Terakhir</option>
            <option value="3weeks">3 Minggu Terakhir</option>
            <option value="1month">1 Bulan Terakhir</option>
            <option value="2months">2 Bulan Terakhir</option>
            <option value="3months">3 Bulan Terakhir</option>
            <option value="6months">6 Bulan Terakhir</option>
            <option value="custom">Kustom (Pilih Tanggal)</option>
          </select>

          {datePreset === "custom" && (
            <div className="col-span-full lg:col-span-2 flex items-center gap-2 animate-in fade-in slide-in-from-left-4">
              <input 
                type="date" 
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                value={customStartDate}
                onChange={e => setCustomStartDate(e.target.value)}
              />
              <span className="text-slate-400 text-sm shrink-0">s/d</span>
              <input 
                type="date" 
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                value={customEndDate}
                onChange={e => setCustomEndDate(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Active Filters Indicators */}
        {(selectedWeekFilter || selectedVendorFilter || selectedShipFilter) && (
          <div className="xl:col-span-3 flex items-center gap-3 mb-[-1rem]">
            <span className="text-xs font-bold text-slate-500">Filter Aktif:</span>
            {selectedWeekFilter && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 cursor-pointer hover:bg-indigo-200 transition" onClick={() => setSelectedWeekFilter(null)}>
                Minggu: {selectedWeekFilter} &times;
              </span>
            )}
            {selectedVendorFilter && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 cursor-pointer hover:bg-emerald-200 transition" onClick={() => setSelectedVendorFilter(null)}>
                Vendor: {selectedVendorFilter} &times;
              </span>
            )}
            {selectedShipFilter && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 cursor-pointer hover:bg-blue-200 transition" onClick={() => setSelectedShipFilter(null)}>
                Kapal: {selectedShipFilter} &times;
              </span>
            )}
            <button 
              onClick={() => { setSelectedWeekFilter(null); setSelectedVendorFilter(null); setSelectedShipFilter(null); }}
              className="text-[10px] font-bold text-slate-400 hover:text-red-500 transition underline ml-2"
            >
              Hapus Semua Filter
            </button>
          </div>
        )}

        <section className="p-6 rounded-2xl border bg-white shadow-sm xl:col-span-2">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <BarChart3 size={20} className="text-indigo-500" />
            Grafik Pembayaran Mingguan
          </h3>
          <div className="w-full overflow-x-auto pb-4">
            <div className="min-w-[700px]">
              {renderChart()}
            </div>
          </div>
        </section>

        <section className="p-6 rounded-2xl border bg-white shadow-sm xl:col-span-1">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <BarChart3 size={20} className="text-emerald-500" />
            Distribusi per Vendor
          </h3>
          {renderVendorChart()}
        </section>

        <section className="p-6 rounded-2xl border bg-white shadow-sm xl:col-span-3">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <PieChart size={20} className="text-blue-500" />
            Proporsi per Proyek
          </h3>
          {renderProjectChart()}
        </section>
      </div>

      <section className="rounded-2xl border bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <CalendarIcon size={18} className="text-indigo-500" />
            Daftar Transaksi Pembayaran
          </h3>
          <span className="text-xs font-semibold text-slate-400">Halaman {currentPage} dari {totalPages}</span>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-400">
                <th className="py-3 px-6">Tanggal Approval</th>
                <th className="py-3 px-6">Kode WO</th>
                <th className="py-3 px-6">Kode JO</th>
                <th className="py-3 px-6">Proyek (Kapal)</th>
                <th className="py-3 px-6">Vendor</th>
                <th className="py-3 px-6 text-right">Nilai WO Asli</th>
                <th className="py-3 px-6 text-right text-blue-500">Total Dibayar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 text-sm">
              {paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 text-xs">Belum ada data pembayaran riil yang ditarik.</td>
                </tr>
              ) : (
                paginatedData.map(item => (
                  <tr key={item.id} className="hover:bg-slate-50 transition">
                    <td className="py-3 px-6 font-semibold text-slate-700">{item.latest_date.split(' ')[0]}</td>
                    <td className="py-3 px-6 font-mono text-xs">{item.woCode || item.code}</td>
                    <td className="py-3 px-6 font-mono text-xs text-slate-500">{item.joCode}</td>
                    <td className="py-3 px-6 text-slate-600 truncate max-w-[200px]">{item.shipName}</td>
                    <td className="py-3 px-6 text-slate-600 truncate max-w-[200px]">{item.vendorName}</td>
                    <td className="py-3 px-6 text-right font-mono text-slate-400 text-xs">{formatIDR(item.total_cost || 0)}</td>
                    <td className="py-3 px-6 text-right font-mono font-bold text-blue-600 text-sm">{formatIDR(item.final_cost)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between gap-4">
          <span className="text-xs text-slate-400">
            Menampilkan {Math.min(crossFilteredData.length, (currentPage - 1) * itemsPerPage + 1)}-{Math.min(crossFilteredData.length, currentPage * itemsPerPage)} dari {crossFilteredData.length} data
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg border dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition"
            >
              <ChevronLeft size={16} />
            </button>
            
            <span className="text-xs font-semibold px-2">{currentPage} / {totalPages}</span>

            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg border dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
