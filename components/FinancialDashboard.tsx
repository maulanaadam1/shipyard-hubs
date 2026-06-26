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
  PieChart,
  ExternalLink,
  X,
  Layers,
  DownloadCloud,
  CheckCircle,
  UserCheck,
  Copy,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  ArrowUpDown
} from 'lucide-react';
import { api, getHeaders } from '@/lib/api-client';
import { useData } from '@/context/DataContext';
import { SearchableSelect } from './SearchableSelect';

const MOCK_DATA: any[] = [];

export default function FinancialDashboard() {
  const { syncCache, setSyncCache, syncDates, setSyncDates } = useData();
  const [rawData, setRawData] = useState<any[]>(syncCache['WorkOrders'] || []);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncDate, setLastSyncDate] = useState<string>(syncDates['WorkOrders'] || '');
  const [financialData, setFinancialData] = useState<Record<string, { pending: number, final_cost: number, latest_date: string }>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  const [datePreset, setDatePreset] = useState("1week");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const [globalYear, setGlobalYear] = useState("all");
  const [globalProject, setGlobalProject] = useState("all");
  const [globalVendor, setGlobalVendor] = useState("all");

  const [isNominalHidden, setIsNominalHidden] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('hideNominal_WO');
    if (saved === 'false') {
      setIsNominalHidden(false);
    } else {
      setIsNominalHidden(true);
    }
  }, []);

  const toggleHideNominal = () => {
    const newVal = !isNominalHidden;
    setIsNominalHidden(newVal);
    localStorage.setItem('hideNominal_WO', newVal.toString());
  };

  const [selectedTimeFilter, setSelectedTimeFilter] = useState<string | null>(null);
  const [selectedVendorFilter, setSelectedVendorFilter] = useState<string | null>(null);
  const [selectedShipFilter, setSelectedShipFilter] = useState<string | null>(null);
  const [selectedApprovalFilter, setSelectedApprovalFilter] = useState<string>("all");
  const [timeGroupBy, setTimeGroupBy] = useState<'day' | 'week' | 'month'>('day');
  
  // Table sorting states
  const [sortColumn, setSortColumn] = useState<string>('latest_date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Clear cross-filters when date range changes
  useEffect(() => {
    setSelectedTimeFilter(null);
    setSelectedVendorFilter(null);
    setSelectedShipFilter(null);
    setCurrentPage(1);
  }, [datePreset, customStartDate, customEndDate, timeGroupBy]);

  // --- Modal States ---
  const [selectedRow, setSelectedRow] = useState<any>(null);
  const [detailedRowData, setDetailedRowData] = useState<any>(null);
  const [isFetchingDetail, setIsFetchingDetail] = useState(false);
  const [isSyncingDetail, setIsSyncingDetail] = useState(false);
  const [detailFetchError, setDetailFetchError] = useState<string | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<'pekerjaan' | 'material'>('pekerjaan');
  const [masterComponentsMap, setMasterComponentsMap] = useState<Record<string, any>>({});
  const [showChartCum, setShowChartCum] = useState(true);
  const [showChartDaily, setShowChartDaily] = useState(true);
  const [selectedDetailDate, setSelectedDetailDate] = useState<string | null>(null);
  const [selectedDetailStatus, setSelectedDetailStatus] = useState<string | null>(null);

  const fetchDetail = async (): Promise<boolean> => {
    if (!selectedRow || !selectedRow.id) return false;
    setIsFetchingDetail(true);
    setDetailedRowData(null);
    setDetailFetchError(null);
    try {
      const headers = await getHeaders();
      const res = await fetch(`/api/work-orders/${selectedRow.id}/detail`, { headers });
      if (res.ok) {
        const result = await res.json();
        setDetailedRowData(result.data || result);
        return true;
      } else if (res.status === 404) {
        return false;
      } else {
        const txt = await res.text();
        setDetailFetchError(`API Error ${res.status}: ${txt}`);
        return false;
      }
    } catch (err: any) {
      setDetailFetchError(`Network error: ${err.message}`);
      return false;
    } finally {
      setIsFetchingDetail(false);
    }
  };

  useEffect(() => {
    if (selectedRow) {
      fetchDetail();
    }
  }, [selectedRow]);

  useEffect(() => {
    if (selectedRow && !Object.keys(masterComponentsMap).length) {
      api.from('m_components').select('*')
        .then(({ data }) => {
          if (data && data.length) {
            const map: Record<string, any> = {};
            data.forEach(item => { map[item.id.toString()] = item; });
            setMasterComponentsMap(map);
          }
        });
    }
  }, [selectedRow]);

  const triggerSyncDetail = async () => {
    if (!selectedRow || !selectedRow.id) return;
    setIsSyncingDetail(true);
    setDetailFetchError(null);
    try {
      const headers = await getHeaders();
      const res = await fetch(`/api/work-orders/${selectedRow.id}/sync`, { method: 'POST', headers });
      if (res.ok) {
        await fetchDetail();
      } else {
        const txt = await res.text();
        setDetailFetchError(`Gagal sync: ${res.status} ${txt}`);
      }
    } catch (err: any) {
      setDetailFetchError(`Network error: ${err.message}`);
    } finally {
      setIsSyncingDetail(false);
    }
  };

  const getStatusBadgeStyles = (status: string) => {
    if (!status) return 'bg-amber-100 text-amber-700 border border-amber-200';
    if (status.includes('Approved Level 5') || status.toLowerCase().includes('approved')) return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
    if (status.includes('Level')) return 'bg-blue-100 text-blue-700 border border-blue-200';
    return 'bg-amber-100 text-amber-700 border border-amber-200';
  };

  const getStatusIcon = (status: string) => {
    if (!status) return <Clock size={14} className="mr-1" />;
    if (status.includes('Approved Level 5') || status.toLowerCase().includes('approved')) return <CheckCircle size={14} className="mr-1" />;
    if (status.includes('Level')) return <UserCheck size={14} className="mr-1" />;
    return <Clock size={14} className="mr-1" />;
  };

  const detailChartConfig = useMemo(() => {
    if (!detailedRowData || !detailedRowData.repair_list) return null;
    
    const dailyMap: Record<string, number> = {};
    let unapprovedCost = 0;
    let latestApprove5Date = "";
    let latestWaitingDate = "";

    const scanDates = (items: any[]) => {
      items.forEach(item => {
        let isAppr5 = item.approved_level >= 5 || item.status_approval === 'approved' || item.status_approval === 'approved level 5';
        if (!isAppr5 && selectedRow?.min_approval_level >= 5) {
          isAppr5 = true;
        }
        let isWaiting = item.approved_level === 0 || item.status_approval === 'waiting';

        let dateToUse = item.date_approval || item.updated_at || item.created_at || detailedRowData?.created_at || selectedRow?.created_at || new Date().toISOString();

        if (isAppr5 && dateToUse > latestApprove5Date) latestApprove5Date = dateToUse;
        if (isWaiting && dateToUse > latestWaitingDate) latestWaitingDate = dateToUse;

        if (item.material && Array.isArray(item.material)) {
          scanDates(item.material);
        }
      });
    };
    scanDates(detailedRowData.repair_list);

    let allowLevel1To4 = false;
    if (latestWaitingDate === "" || latestWaitingDate <= latestApprove5Date) {
      allowLevel1To4 = true;
    }

    const extractItems = (items: any[]) => {
      items.forEach(item => {
        let isAppr5 = item.approved_level >= 5 || item.status_approval === 'approved' || item.status_approval === 'approved level 5';
        if (!isAppr5 && selectedRow?.min_approval_level >= 5) {
          isAppr5 = true;
        }
        
        let statusAppr = (item.status_approval || "").toLowerCase();
        let isLevel1To4 = (item.approved_level >= 1 && item.approved_level <= 4) || statusAppr.startsWith("level") || statusAppr.startsWith("approved level");
        
        let isAppr = isAppr5 || (allowLevel1To4 && isLevel1To4);

        let dateToUse = item.date_approval;
        if (isAppr && !dateToUse) {
          dateToUse = item.created_at || item.updated_at || detailedRowData?.created_at || selectedRow?.created_at || new Date().toISOString();
        }

        let finalCost = 0;
        if (item.volume_cost_final > 0) {
          const baseCost = Number(item.volume_cost_final) || 0;
          const volume = Number(item.volume) || 0;
          const progress = item.progress !== undefined ? Number(item.progress) : 100;
          finalCost = baseCost * volume * (progress / 100);
        }

        if (finalCost > 0) {
           if (isAppr && dateToUse) {
             const dateOnly = dateToUse.split(' ')[0];
             dailyMap[dateOnly] = (dailyMap[dateOnly] || 0) + finalCost;
           } else if (!isAppr) {
             unapprovedCost += finalCost;
           }
        }
        if (item.material && Array.isArray(item.material)) {
           extractItems(item.material);
        }
      });
    };
    extractItems(detailedRowData.repair_list);
    
    const dates = Object.keys(dailyMap).sort();
    if (dates.length === 0) return null;

    let cumulative = 0;
    const chartData = dates.map(d => {
       cumulative += dailyMap[d];
       return { date: d, dailyCost: dailyMap[d], cumCost: cumulative };
    });

    const width = 800;
    const height = 145;
    const padX = 40;
    const padY = 30;
    
    const maxCost = Math.max(...chartData.map(d => d.cumCost), 1);
    const pointDist = dates.length > 1 ? (width - padX * 2) / (dates.length - 1) : width / 2;
    
    const cumPoints = chartData.map((d, i) => {
      const x = dates.length === 1 ? width / 2 : padX + (i * pointDist);
      const ratio = d.cumCost / maxCost;
      const y = height - padY - (ratio * (height - padY * 2));
      const shortDate = d.date.substring(5).replace('-', '/');
      return { x, y, label: shortDate, key: d.date, cost: d.cumCost };
    });

    const dailyPoints = chartData.map((d, i) => {
      const x = dates.length === 1 ? width / 2 : padX + (i * pointDist);
      const ratio = d.dailyCost / maxCost;
      const y = height - padY - (ratio * (height - padY * 2));
      const shortDate = d.date.substring(5).replace('-', '/');
      return { x, y, label: shortDate, key: d.date, cost: d.dailyCost };
    });
    
    let cumPathD = "";
    let cumAreaD = "";
    let dailyPathD = "";

    if (cumPoints.length > 0) {
      if (cumPoints.length === 1) {
        cumPathD = `M ${cumPoints[0].x - 10} ${cumPoints[0].y} L ${cumPoints[0].x + 10} ${cumPoints[0].y}`;
        cumAreaD = `M ${cumPoints[0].x - 10} ${height} L ${cumPoints[0].x - 10} ${cumPoints[0].y} L ${cumPoints[0].x + 10} ${cumPoints[0].y} L ${cumPoints[0].x + 10} ${height} Z`;
        dailyPathD = `M ${dailyPoints[0].x - 10} ${dailyPoints[0].y} L ${dailyPoints[0].x + 10} ${dailyPoints[0].y}`;
      } else {
        cumPathD = `M ${cumPoints[0].x} ${cumPoints[0].y} ` + cumPoints.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");
        cumAreaD = cumPathD + ` L ${cumPoints[cumPoints.length - 1].x} ${height} L ${cumPoints[0].x} ${height} Z`;
        dailyPathD = `M ${dailyPoints[0].x} ${dailyPoints[0].y} ` + dailyPoints.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");
      }
    }
    
    return { cumPoints, dailyPoints, cumPathD, cumAreaD, dailyPathD, width, height, maxCost, unapprovedCost };
  }, [detailedRowData]);

  const fetchSyncData = async () => {
    try {
      // 1. Coba ambil dari Redis via API Go Server (Lebih cepat)
      const headers = await getHeaders();
      let res = await fetch('/api/cache/WorkOrders', { headers });
      
      let rawParsed = null;
      let lastSync = '';
      
      if (res.ok) {
        const responseJson = await res.json();
        rawParsed = responseJson.data;
        lastSync = responseJson.last_sync || '';
      } else {
        // 2. Fallback: ambil dari SQLite/Supabase jika API gagal (misal server belum direstart)
        const { data } = await api.from('sync_configs').select('*').eq('id', 'WorkOrders');
        if (data && data.length > 0) {
          const syncConfig = data[0];
          lastSync = syncConfig.last_sync || '';
          if (syncConfig.last_response) {
            rawParsed = JSON.parse(syncConfig.last_response);
          }
        }
      }

      if (rawParsed) {
        let list = [];
        if (Array.isArray(rawParsed)) list = rawParsed;
        else if (rawParsed.data && Array.isArray(rawParsed.data)) list = rawParsed.data;
        
        if (list.length > 0) {
          setRawData(list);
          setLastSyncDate(lastSync || '');

          // Update global cache
          setSyncCache(prev => ({ ...prev, WorkOrders: list }));
          setSyncDates(prev => ({ ...prev, WorkOrders: lastSync || '' }));
        }
      }
    } catch(e) {
      console.error("Gagal narik data dari cache/db:", e);
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
      // Hapus syarat fin.latest_date agar nominal tetap muncul meski tanggal kosong
      return fin && fin.final_cost > 0;
    }).map(item => {
      const fin = financialData[item.id];
      const jo = item.jo_code || "N/A";
      const ship = item.m_ship_name || "N/A";
      
      const levelStatus = item.min_approval_level >= 5 ? "Approved Level 5" : 
                         (item.min_approval_level > 0 ? `Approved Level ${item.min_approval_level}` : "Waiting");
      const combProjectName = `${jo.toUpperCase()} - ${ship.toUpperCase()}`;
      
      return {
        ...item,
        shipName: ship,
        joCode: jo.toUpperCase(),
        woCode: item.code || "N/A",
        vendorName: item.m_vendor_name || "Tanpa Vendor",
        final_cost: fin.latest_cost !== undefined ? fin.latest_cost : fin.final_cost, // Menggunakan latest_cost agar grafik murni delta
        previous_cost: fin.previous_cost !== undefined ? fin.previous_cost : 0,
        latest_date: fin.latest_date,
        pending: fin.pending,
        derivedStatus: levelStatus,
        totalCostNum: fin.final_cost, // totalCostNum bisa mempertahankan nilai full WO jika dibutuhkan, atau pakai item.total_cost
        projectName: combProjectName,
        createdAtStr: item.created_at ? item.created_at.split(' ')[0] : 'N/A'
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
    const approvals = new Set<string>();

    validData.forEach(item => {
      if (item.latest_date) years.add(item.latest_date.substring(0, 4));
      if (item.shipName) projects.add(item.shipName);
      if (item.vendorName) vendors.add(item.vendorName);
      if (item.derivedStatus) approvals.add(item.derivedStatus);
    });

    return {
      years: Array.from(years).sort().reverse(),
      projects: Array.from(projects).sort(),
      vendors: Array.from(vendors).sort(),
      approvals: Array.from(approvals).sort()
    };
  }, [validData]);

  const dateFilteredData = useMemo(() => {
    const end = new Date(latestDatasetDate);
    const start = new Date(latestDatasetDate);

    if (datePreset === "1week") start.setDate(end.getDate() - 6);
    else if (datePreset === "2weeks") start.setDate(end.getDate() - 13);
    else if (datePreset === "3weeks") start.setDate(end.getDate() - 20);
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
      if (selectedApprovalFilter !== "all") {
        if (item.derivedStatus !== selectedApprovalFilter) return false;
      }

      if (datePreset === "all") return true;
      // Jika tanggal kosong, berikan opsi untuk tetap menampilkannya jika filter adalah 'all'
      // Untuk filter spesifik, jika tidak punya tanggal, kita skip (atau sesuai preferensi, tapi masuk akal diskip)
      if (!item.latest_date) return false;

      const d = new Date(item.latest_date.replace(' ', 'T')).getTime();
      
      if (datePreset === "custom") {
        const sTime = customStartDate ? new Date(customStartDate).getTime() : 0;
        const eTime = customEndDate ? new Date(customEndDate).setHours(23, 59, 59, 999) : Infinity;
        return d >= sTime && d <= eTime;
      }
      
      return d >= start.getTime() && d <= end.getTime();
    });
  }, [validData, datePreset, customStartDate, customEndDate, latestDatasetDate, globalYear, globalProject, globalVendor, selectedApprovalFilter]);

  const getStartOfPeriod = (dateStr: string, period: 'day' | 'week' | 'month') => {
    if (!dateStr) return null;
    const cleanStr = dateStr.replace(' ', 'T');
    const d = new Date(cleanStr);
    if (isNaN(d.getTime())) return null;
    
    if (period === 'day') {
      return d.toISOString().split('T')[0];
    } else if (period === 'month') {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}-01`;
    } else {
      const day = d.getDay();
      // Week starts on Saturday (6)
      const daysToSubtract = (day + 1) % 7;
      const startOfWeek = new Date(d.setDate(d.getDate() - daysToSubtract));
      return startOfWeek.toISOString().split('T')[0];
    }
  };

  const crossFilteredData = useMemo(() => {
    return dateFilteredData.filter(item => {
      let pass = true;
      if (selectedTimeFilter && getStartOfPeriod(item.latest_date, timeGroupBy) !== selectedTimeFilter) pass = false;
      if (selectedVendorFilter && (item.vendorName || "Tanpa Vendor") !== selectedVendorFilter) pass = false;
      if (selectedShipFilter && (item.shipName || "Tanpa Proyek") !== selectedShipFilter) pass = false;
      return pass;
    });
  }, [dateFilteredData, selectedTimeFilter, selectedVendorFilter, selectedShipFilter, timeGroupBy]);

  const timeTrend = useMemo(() => {
    const groups: Record<string, number> = {};
    crossFilteredData.forEach(item => {
      const p = getStartOfPeriod(item.latest_date, timeGroupBy);
      if (p) {
        groups[p] = (groups[p] || 0) + item.final_cost;
      }
    });

    return Object.keys(groups).sort().map(pStr => {
      const startD = new Date(pStr);
      let label = "";
      
      const formatShort = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      
      if (timeGroupBy === 'day') {
        label = formatShort(startD);
      } else if (timeGroupBy === 'month') {
        label = startD.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      } else {
        const endD = new Date(startD);
        endD.setDate(startD.getDate() + 6);
        label = `${formatShort(startD)} - ${formatShort(endD)}`;
      }

      return {
        period: pStr,
        label: label,
        cost: groups[pStr]
      };
    });
  }, [crossFilteredData, timeGroupBy]);

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

  const sortedData = useMemo(() => {
    return [...crossFilteredData].sort((a, b) => {
      let aVal: any = '';
      let bVal: any = '';
      
      switch (sortColumn) {
        case 'latest_date':
          aVal = new Date(a.latest_date).getTime();
          bVal = new Date(b.latest_date).getTime();
          break;
        case 'woCode':
          aVal = a.woCode || a.code || '';
          bVal = b.woCode || b.code || '';
          break;
        case 'joCode':
          aVal = a.joCode || '';
          bVal = b.joCode || '';
          break;
        case 'shipName':
          aVal = a.shipName || '';
          bVal = b.shipName || '';
          break;
        case 'vendorName':
          aVal = a.vendorName || '';
          bVal = b.vendorName || '';
          break;
        case 'statusApproval':
          aVal = a.derivedStatus || '';
          bVal = b.derivedStatus || '';
          break;
        case 'prevCost':
          aVal = Number(a.total_cost || 0);
          bVal = Number(b.total_cost || 0);
          break;
        case 'finalCost':
          aVal = Number(a.final_cost || 0);
          bVal = Number(b.final_cost || 0);
          break;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [crossFilteredData, sortColumn, sortDirection]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedData.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedData, currentPage]);

  const totalPages = Math.ceil(sortedData.length / itemsPerPage) || 1;

  const formatIDR = (value: number) => {
    if (isNominalHidden) return 'Rp ****';
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(value);
  };

  const totalPaymentValue = crossFilteredData.reduce((acc, curr) => acc + curr.final_cost, 0);

  const totalJO = useMemo(() => {
    const joSet = new Set<string>();
    crossFilteredData.forEach(item => {
      if (item.joCode) joSet.add(item.joCode);
    });
    return joSet.size;
  }, [crossFilteredData]);

  // Chart Rendering (SVG)
  const renderChart = () => {
    if (timeTrend.length === 0) return <div className="h-64 flex items-center justify-center text-slate-400">Belum ada data tagihan</div>;
    
    const maxCost = Math.max(...timeTrend.map(t => t.cost), 1);
    const width = 1000;
    const height = 240;
    const padding = 40;
    const barWidth = Math.min(40, (width - 2 * padding) / timeTrend.length - 10);

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
        {timeTrend.map((item, idx) => {
          const x = padding + (idx * (width - 2 * padding)) / (timeTrend.length || 1) + ((width - 2 * padding) / (timeTrend.length || 1)) / 2;
          const barH = (item.cost / maxCost) * (height - 2 * padding);
          const y = height - padding - barH;
          
          return (
            <g 
              key={idx} 
              className="cursor-pointer transition-opacity hover:opacity-80 group"
              onClick={() => setSelectedTimeFilter(prev => prev === item.period ? null : item.period)}
            >
              <rect 
                x={x - barWidth / 2} 
                y={y} 
                width={barWidth} 
                height={barH} 
                fill={selectedTimeFilter && selectedTimeFilter !== item.period ? '#cbd5e1' : '#6366f1'} 
                rx="4" 
              />
              <text x={x} y={height - padding + 15} textAnchor="middle" className="text-[10px] fill-slate-500 font-medium">
                {timeGroupBy === 'week' ? (
                  <>
                    <tspan x={x} dy="0">{item.label.split(' - ')[0]}</tspan>
                    <tspan x={x} dy="12">- {item.label.split(' - ')[1]}</tspan>
                  </>
                ) : timeGroupBy === 'month' ? (
                  item.label.split(' ')[0]
                ) : (
                  item.label
                )}
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
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 transition-colors duration-300">
      
      <header className="sticky top-0 z-30 border-b backdrop-blur-md px-6 py-4 flex flex-wrap justify-between items-center gap-4 bg-white/80 border-slate-200">
        <div>
          <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight text-slate-800">Financial Dashboard</h2>
          <p className="text-xs md:text-sm text-slate-500 mt-1">Monitoring Arus Kas & Tagihan Mingguan (Berdasarkan Approval Date)</p>
        </div>
        <div className="flex items-center gap-3">
          {lastSyncDate && (
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200">
              <Clock size={12} />
              <span>{lastSyncDate}</span>
            </div>
          )}
          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            Terhubung
          </span>

          <button
            onClick={toggleHideNominal}
            title={isNominalHidden ? "Tampilkan Nominal" : "Sembunyikan Nominal"}
            className={`flex items-center justify-center p-2 rounded-xl border transition-all shadow-sm ${isNominalHidden ? 'bg-amber-100 border-amber-200 text-amber-600' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300'}`}
          >
            {isNominalHidden ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>

          <button
            onClick={triggerManualSync}
            disabled={isSyncing}
            title="Tarik Data Terbaru (Sync)"
            className={`flex items-center justify-center p-2 rounded-xl border transition-all shadow-sm ${isSyncing ? 'bg-indigo-100 border-indigo-200 text-indigo-400 cursor-not-allowed' : 'bg-white border-slate-200 hover:bg-indigo-50 text-indigo-600 hover:border-indigo-200'}`}
          >
            <RefreshCw size={18} className={isSyncing ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      <main className="w-full p-4 md:p-8 space-y-6">

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 md:p-6 rounded-2xl border border-slate-200 bg-white shadow-sm flex items-center gap-3 md:gap-4 transition-all hover:shadow-md">
          <div className="p-3 md:p-4 rounded-2xl bg-blue-500/10 text-blue-500">
            <DollarSign className="w-6 h-6 md:w-7 md:h-7" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] md:text-xs font-semibold text-slate-400 uppercase tracking-wider leading-tight">Total Tagihan Valid</p>
            <h3 className="text-lg md:text-xl lg:text-2xl font-bold mt-1 font-mono text-slate-800 leading-none break-all">{formatIDR(totalPaymentValue)}</h3>
          </div>
        </div>
        
        <div className="p-4 md:p-6 rounded-2xl border border-slate-200 bg-white shadow-sm flex items-center gap-3 md:gap-4 transition-all hover:shadow-md">
          <div className="p-3 md:p-4 rounded-2xl bg-emerald-500/10 text-emerald-500">
            <TrendingUp className="w-6 h-6 md:w-7 md:h-7" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] md:text-xs font-semibold text-slate-400 uppercase tracking-wider leading-tight">Jumlah Transaksi (WO)</p>
            <h3 className="text-lg md:text-xl lg:text-2xl font-bold mt-1 text-slate-800 leading-none break-words">{crossFilteredData.length} Dokumen</h3>
          </div>
        </div>

        <div className="p-4 md:p-6 rounded-2xl border border-slate-200 bg-white shadow-sm flex items-center gap-3 md:gap-4 transition-all hover:shadow-md">
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
      <div className="flex flex-col gap-3 p-4 rounded-xl border border-slate-200 bg-white shadow-sm transition-all">
        <div className="flex items-center gap-2 text-slate-500">
          <Filter size={16} />
          <span className="text-sm font-semibold">Filter Utama:</span>
        </div>
        <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${datePreset === "custom" ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}>
          <div className="z-40">
            <SearchableSelect 
              value={globalYear}
              onChange={setGlobalYear}
              options={filterOptions.years}
              allLabel="Tahun (Semua)"
            />
          </div>

          <div className="z-30">
            <SearchableSelect 
              value={globalProject}
              onChange={setGlobalProject}
              options={filterOptions.projects}
              allLabel="Proyek Kapal (Semua)"
            />
          </div>

          <div className="z-20">
            <SearchableSelect 
              value={globalVendor}
              onChange={setGlobalVendor}
              options={filterOptions.vendors}
              allLabel="Vendor (Semua)"
            />
          </div>
          
          <div className="z-10">
            <SearchableSelect 
              value={selectedApprovalFilter}
              onChange={setSelectedApprovalFilter}
              options={filterOptions.approvals}
              allLabel="Status Approval (Semua)"
              uppercaseText={true}
            />
          </div>

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
        {(selectedTimeFilter || selectedVendorFilter || selectedShipFilter) && (
          <div className="xl:col-span-3 flex items-center gap-3 mb-[-1rem]">
            <span className="text-xs font-bold text-slate-500">Filter Aktif:</span>
            {selectedTimeFilter && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 cursor-pointer hover:bg-indigo-200 transition" onClick={() => setSelectedTimeFilter(null)}>
                Waktu: {selectedTimeFilter} &times;
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
              onClick={() => { setSelectedTimeFilter(null); setSelectedVendorFilter(null); setSelectedShipFilter(null); }}
              className="text-[10px] font-bold text-slate-400 hover:text-red-500 transition underline ml-2"
            >
              Hapus Semua Filter
            </button>
          </div>
        )}

        <section className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm transition-all xl:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 shrink-0">
              <BarChart3 size={20} className="text-indigo-500" />
              Grafik Tagihan
            </h3>
            
            <div className="flex bg-slate-100 p-1 rounded-lg w-fit">
              <button 
                onClick={() => setTimeGroupBy('day')} 
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${timeGroupBy === 'day' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >Harian</button>
              <button 
                onClick={() => setTimeGroupBy('week')} 
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${timeGroupBy === 'week' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >Mingguan</button>
              <button 
                onClick={() => setTimeGroupBy('month')} 
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${timeGroupBy === 'month' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >Bulanan</button>
            </div>
          </div>
          <div className="w-full overflow-x-auto pb-4">
            <div className="min-w-[700px]">
              {renderChart()}
            </div>
          </div>
        </section>

        <section className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm transition-all xl:col-span-1">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <BarChart3 size={20} className="text-emerald-500" />
            Distribusi per Vendor
          </h3>
          {renderVendorChart()}
        </section>

        <section className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm transition-all xl:col-span-3">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <PieChart size={20} className="text-blue-500" />
            Proporsi per Proyek
          </h3>
          {renderProjectChart()}
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden transition-all">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <CalendarIcon size={18} className="text-indigo-500" />
            Daftar Transaksi Tagihan
          </h3>
          <span className="text-xs font-semibold text-slate-400">Halaman {currentPage} dari {totalPages}</span>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-400">
                {[
                  { key: 'latest_date', label: 'Tanggal Approval' },
                  { key: 'woCode', label: 'Kode WO' },
                  { key: 'joCode', label: 'Kode JO' },
                  { key: 'shipName', label: 'Proyek (Kapal)' },
                  { key: 'vendorName', label: 'Vendor' },
                  { key: 'statusApproval', label: 'Status Approval' },
                  { key: 'prevCost', label: 'Nilai Sebelumnya', align: 'right' },
                  { key: 'finalCost', label: 'Nilai Saat Ini', align: 'right', extraClass: 'text-blue-500' }
                ].map(col => (
                  <th 
                    key={col.key} 
                    className={`py-3 px-6 cursor-pointer hover:bg-slate-100 transition-colors ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.extraClass || ''}`}
                    onClick={() => {
                      if (sortColumn === col.key) {
                        setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
                      } else {
                        setSortColumn(col.key);
                        setSortDirection('asc');
                      }
                    }}
                  >
                    <div className={`flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : ''}`}>
                      {col.label}
                      {sortColumn === col.key ? (
                        sortDirection === 'asc' ? <ArrowUp size={12} className="text-indigo-500" /> : <ArrowDown size={12} className="text-indigo-500" />
                      ) : (
                        <ArrowUpDown size={12} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 text-sm">
              {paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400 text-xs">Belum ada data tagihan riil yang ditarik.</td>
                </tr>
              ) : (
                paginatedData.map(item => (
                  <tr key={item.id} className="hover:bg-slate-50 transition cursor-pointer" onClick={() => setSelectedRow(item)}>
                    <td className="py-3 px-6 font-semibold text-slate-700">{item.latest_date.split(' ')[0]}</td>
                    <td className="py-3 px-6 font-mono text-xs text-indigo-600 hover:text-indigo-800 transition">
                      <a 
                        href={`https://shipyard-siaga.samudera.id/v2/work-orders/progress/${item.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                        title="Buka detail WO di Samudera Shipyard"
                      >
                        {item.woCode || item.code}
                        <ExternalLink size={12} />
                      </a>
                    </td>
                    <td className="py-3 px-6 font-mono text-xs text-slate-500">{item.joCode}</td>
                    <td className="py-3 px-6 text-slate-600 truncate max-w-[200px]">{item.shipName}</td>
                    <td className="py-3 px-6 text-slate-600 truncate max-w-[200px]">{item.vendorName}</td>
                    <td className="py-3 px-6">
                      <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${item.derivedStatus.includes('5') ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {item.derivedStatus}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-right font-mono text-slate-400 text-xs">{formatIDR(item.previous_cost !== undefined ? item.previous_cost : 0)}</td>
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
      </main>

      {/* DETAILED ROW MODAL */}
      {selectedRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div 
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity"
            onClick={() => setSelectedRow(null)}
          ></div>

          <div className="relative w-full max-w-6xl max-h-[95vh] flex flex-col shadow-2xl rounded-2xl overflow-hidden bg-white border border-slate-200 text-slate-800">
            
            <div className="p-5 sm:p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="space-y-1">
                <span className="text-xs uppercase font-bold tracking-wider text-slate-400 px-2 py-0.5 rounded bg-slate-500/10">Detail Work Order</span>
                <h3 className="text-xl sm:text-2xl font-bold font-mono text-[#FDB913] mt-1 flex items-center gap-2">
                  {selectedRow.woCode}
                  <a 
                    href={`https://shipyard-siaga.samudera.id/v2/work-orders/progress/${selectedRow.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-[#FDB913] transition"
                    title="Buka detail WO di Samudera Shipyard"
                  >
                    <ExternalLink size={20} />
                  </a>
                </h3>
              </div>
              <button 
                onClick={() => setSelectedRow(null)}
                className="p-2 rounded-full hover:bg-slate-200 text-slate-400 hover:text-rose-500 transition"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 sm:p-8 space-y-8 custom-scrollbar">
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 p-5 rounded-xl bg-slate-50 border border-slate-100">
                <div>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2">Status Approval</p>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${getStatusBadgeStyles(selectedRow.derivedStatus)}`}>
                    {getStatusIcon(selectedRow.derivedStatus)}
                    {selectedRow.derivedStatus}
                  </span>
                </div>
                
                <div>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2">Total Biaya Jasa</p>
                  <div className="flex flex-col">
                    <p className="text-2xl font-black font-mono text-emerald-600 tracking-tighter">
                      {formatIDR(selectedRow.totalCostNum)}
                    </p>
                    {detailChartConfig && detailChartConfig.unapprovedCost > 0 && (
                      <p className="text-xs font-mono font-medium text-amber-500 mt-1 bg-amber-50 px-2 py-0.5 rounded w-fit border border-amber-100" title="Estimasi biaya yang belum mencapai Approval Level 5">
                        + {formatIDR(detailChartConfig.unapprovedCost)} (Pending)
                      </p>
                    )}
                  </div>
                </div>

                {(() => {
                  const totalMatCost = detailedRowData?.t_requisition_details?.reduce((acc: number, req: any) => {
                    const reqTotal = req.t_delivery_details?.reduce((sum: number, del: any) => {
                      const qty = parseFloat(del.quantity || '0');
                      const price = parseFloat(del.t_receiving_detail?.unit_price || '0');
                      return sum + (qty * price);
                    }, 0) || 0;
                    return acc + reqTotal;
                  }, 0) || 0;

                  return totalMatCost > 0 ? (
                    <div>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2">Total Material</p>
                      <p className="text-2xl font-black font-mono text-indigo-600 tracking-tighter" title="Total Biaya Material Terkirim">
                        {formatIDR(totalMatCost)}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2">Total Material</p>
                      <p className="text-2xl font-black font-mono text-slate-300 tracking-tighter">
                        -
                      </p>
                    </div>
                  );
                })()}

                <div>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2">Vendor / Partner</p>
                  <p className="text-sm font-bold text-slate-800 line-clamp-2" title={selectedRow.vendorName}>{selectedRow.vendorName}</p>
                </div>

                {/* Line Chart: Total Volume Cost Final per Tanggal */}
                {detailChartConfig && (
                  <div className="col-span-full mt-2 pt-4 border-t border-slate-200/60">
                    <div className="flex items-center justify-between mb-3">
                      <div className="space-y-1">
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Grafik Pertumbuhan Biaya (Final Cost)</p>
                        <div className="flex items-center gap-4 text-[10px] font-semibold text-slate-400">
                          <button 
                            onClick={() => setShowChartCum(!showChartCum)} 
                            className={`flex items-center gap-1.5 transition-opacity hover:opacity-80 ${!showChartCum ? 'opacity-40 grayscale' : ''}`}
                          >
                            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div> Kumulatif Total
                          </button>
                          <button 
                            onClick={() => setShowChartDaily(!showChartDaily)}
                            className={`flex items-center gap-1.5 transition-opacity hover:opacity-80 ${!showChartDaily ? 'opacity-40 grayscale' : ''}`}
                          >
                            <div className="w-2 h-2 rounded-full bg-blue-400"></div> Harian (Non-Kumulatif)
                          </button>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono text-right">*Berdasarkan tanggal disetujui<br/>(Approval Level 5)</span>
                    </div>
                    <div className="relative w-full overflow-x-auto custom-scrollbar pb-2 mt-2">
                      <svg width="100%" height="145" viewBox={`0 0 ${detailChartConfig.width} ${detailChartConfig.height}`} preserveAspectRatio="none" className="min-w-[500px]">
                        <defs>
                          <linearGradient id="detail-chart-glow" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        
                        {showChartCum && detailChartConfig.cumAreaD && (
                          <path d={detailChartConfig.cumAreaD} fill="url(#detail-chart-glow)" className="transition-all duration-500" />
                        )}
                        
                        {/* Daily Path */}
                        {showChartDaily && detailChartConfig.dailyPathD && (
                          <path d={detailChartConfig.dailyPathD} fill="none" stroke="#60a5fa" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" strokeLinejoin="round" className="transition-all duration-500 opacity-60" />
                        )}

                        {/* Cumulative Path */}
                        {showChartCum && detailChartConfig.cumPathD && (
                          <path d={detailChartConfig.cumPathD} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-all duration-500 drop-shadow-sm" />
                        )}
                        
                        {/* Daily Points */}
                        {showChartDaily && detailChartConfig.dailyPoints.map((pt: any, idx: number) => (
                          <g key={`daily-${idx}`} className="group">
                            <circle cx={pt.x} cy={pt.y} r="3" fill="#ffffff" stroke="#3b82f6" strokeWidth="1.5" className="transition-all duration-200" />
                            <circle cx={pt.x} cy={pt.y} r="15" fill="transparent" className="cursor-crosshair" title={`Tanggal: ${pt.label}\nBiaya Harian: ${formatIDR(pt.cost)}`} />
                            <text x={pt.x} y={pt.y - 8} fill="#3b82f6" fontSize="9" textAnchor="middle" className="opacity-0 group-hover:opacity-100 transition-opacity font-mono font-bold drop-shadow-sm bg-white px-1">
                              {formatIDR(pt.cost)}
                            </text>
                          </g>
                        ))}

                        {/* Cumulative Points */}
                        {showChartCum && detailChartConfig.cumPoints.map((pt: any, idx: number) => (
                          <g key={`cum-${idx}`} className="group">
                            <circle cx={pt.x} cy={pt.y} r="4.5" fill="#ffffff" stroke="#10b981" strokeWidth="2" className="transition-all duration-200 group-hover:r-[6px]" />
                            <circle cx={pt.x} cy={pt.y} r="15" fill="transparent" className="cursor-crosshair" title={`Tanggal: ${pt.label}\nTotal Kumulatif: ${formatIDR(pt.cost)}`} />
                            <text x={pt.x} y={pt.y - 12} fill="#059669" fontSize="10" textAnchor="middle" className="opacity-0 group-hover:opacity-100 transition-opacity font-mono font-extrabold drop-shadow-md bg-white/80 px-1">
                              {formatIDR(pt.cost)}
                            </text>
                          </g>
                        ))}
                        
                        {/* Timeline Date Labels (Unconditional) */}
                        {detailChartConfig.cumPoints.map((pt: any, idx: number) => {
                          const isSelected = selectedDetailDate === pt.key;
                          return (
                            <g key={`label-${idx}`} className="cursor-pointer transition-all hover:opacity-70" onClick={() => setSelectedDetailDate(isSelected ? null : pt.key)}>
                              <rect x={pt.x - 20} y={detailChartConfig.height - 14} width="40" height="14" rx="4" fill={isSelected ? '#FDB913' : 'transparent'} />
                              <text x={pt.x} y={detailChartConfig.height - 4} fill={isSelected ? '#ffffff' : '#94a3b8'} fontSize="10" textAnchor="middle" fontWeight={isSelected ? "800" : "600"}>
                                {pt.label}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <h4 className="text-sm font-bold uppercase text-slate-400 tracking-wider pb-2 border-b border-dashed border-slate-200">Informasi Proyek & Kapal</h4>
                  
                  <div className="space-y-4 text-sm">
                    <div>
                      <span className="text-xs text-slate-400 block mb-1">Nama Proyek (Gabungan):</span>
                      <p className="font-bold text-[#FDB913]">{selectedRow.projectName}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-xs text-slate-400 block mb-1">Nama Kapal (m_ship_name):</span>
                        <p className="font-bold text-slate-800">{selectedRow.shipName}</p>
                      </div>
                      <div>
                        <span className="text-xs text-slate-400 block mb-1">Kode Job Order (jo_code):</span>
                        <p className="font-bold font-mono text-slate-700">{selectedRow.joCode}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-sm font-bold uppercase text-slate-400 tracking-wider pb-2 border-b border-dashed border-slate-200">Detail Teknis & Manajemen</h4>
                  
                  <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                    <div>
                      <span className="text-xs text-slate-400 block mb-1">Tipe Billing:</span>
                      <p className="font-semibold text-slate-800">{selectedRow.billing_type || '-'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block mb-1">Jumlah Man Power:</span>
                      <p className="font-bold text-slate-800">{selectedRow.man_power} Orang</p>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block mb-1">Dibuat Oleh:</span>
                      <p className="font-semibold text-slate-800">{selectedRow.created_name || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 block mb-1">
                        {selectedRow.derivedStatus === 'Waiting' ? 'Dibuat Pada:' : 'Disetujui Terakhir:'}
                      </span>
                      <p className={`font-semibold ${selectedRow.derivedStatus === 'Waiting' ? 'text-amber-500' : 'text-emerald-500'}`}>
                        {selectedRow.derivedStatus === 'Waiting' ? (selectedRow.createdAtStr || '-') : (selectedRow.last_approved || '-')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Rincian API Detail */}
              <div className="mt-8 pt-6 border-t border-slate-200">
                <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                  <Layers className="text-[#FDB913]" />
                  Rincian Item Pekerjaan & Material (Samudera API)
                </h3>

                {isFetchingDetail ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <div className="w-8 h-8 border-4 border-[#FDB913] border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-sm font-medium text-slate-500 animate-pulse">Memeriksa Database Lokal...</p>
                  </div>
                ) : detailedRowData ? (
                  <div className="space-y-6">
                    {/* Tabs Header */}
                    <div className="flex border-b border-slate-200">
                      <button
                        onClick={() => setActiveDetailTab('pekerjaan')}
                        className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeDetailTab === 'pekerjaan' ? 'border-[#FDB913] text-[#FDB913]' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'}`}
                      >
                        Daftar Pekerjaan
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{detailedRowData.repair_list?.length || 0}</span>
                      </button>
                      <button
                        onClick={() => setActiveDetailTab('material')}
                        className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeDetailTab === 'material' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'}`}
                      >
                        Kebutuhan Material
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{detailedRowData.t_requisition_details?.length || 0}</span>
                      </button>
                    </div>

                    {/* Tab Content: Pekerjaan */}
                    {activeDetailTab === 'pekerjaan' && (
                      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <h4 className="text-sm font-bold uppercase text-[#FDB913] tracking-wider pb-2 border-b-2 border-solid border-[#FDB913]/20 flex flex-wrap justify-between items-center gap-4">
                          <span>Daftar Pekerjaan (Repair List)</span>
                          <div className="flex items-center gap-2">
                            <Filter size={14} className="text-slate-400" />
                            <select
                              value={selectedDetailStatus || ''}
                              onChange={(e) => setSelectedDetailStatus(e.target.value || null)}
                              className="text-xs font-semibold px-2 py-1 rounded bg-white border border-slate-200 text-slate-600 focus:outline-none focus:border-[#FDB913]"
                            >
                              <option value="">Semua Status Approval</option>
                              <option value="approved">Approved</option>
                              <option value="waiting">Waiting</option>
                              <option value="level 1">Level 1</option>
                              <option value="level 2">Level 2</option>
                              <option value="level 3">Level 3</option>
                              <option value="level 4">Level 4</option>
                            </select>
                          </div>
                        </h4>
                        
                        {!detailedRowData.repair_list || detailedRowData.repair_list.length === 0 ? (
                           <p className="text-sm text-slate-500 italic p-6 bg-slate-50 rounded-xl text-center">Tidak ada detail pekerjaan tersedia</p>
                        ) : (
                          <div className="space-y-3">
                            {(selectedDetailDate || selectedDetailStatus) && (
                              <div className="bg-[#FDB913]/10 border border-[#FDB913]/30 rounded-lg p-3 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
                                <p className="text-sm font-semibold text-slate-700 flex flex-wrap items-center gap-2">
                                  <Filter size={16} className="text-[#FDB913]" />
                                  Filter Aktif: 
                                  {selectedDetailDate && <span className="font-bold text-[#FDB913]">Tanggal {selectedDetailDate}</span>}
                                  {selectedDetailDate && selectedDetailStatus && <span className="text-slate-400">|</span>}
                                  {selectedDetailStatus && <span className="font-bold text-[#FDB913]">Status {selectedDetailStatus.toUpperCase()}</span>}
                                </p>
                                <button onClick={() => { setSelectedDetailDate(null); setSelectedDetailStatus(null); }} className="text-xs font-bold text-rose-500 hover:bg-rose-50 px-2 py-1 rounded transition">Reset Filter</button>
                              </div>
                            )}
                            {(() => {
                              let totalFilteredCost = 0;
                              const calculateFilteredCost = (nodes: any[]) => {
                                nodes.forEach(node => {
                                  let dateMatch = true;
                                  if (selectedDetailDate) {
                                    const d = node.date_approval ? node.date_approval.split(' ')[0] : 
                                              (node.created_at || node.updated_at || detailedRowData?.created_at)?.split(' ')[0];
                                    dateMatch = d === selectedDetailDate;
                                  }

                                  let statusMatch = true;
                                  if (selectedDetailStatus) {
                                    let statusStr = node.status_approval;
                                    if (node.approved_level !== undefined && node.approved_level !== null) {
                                      if (node.approved_level >= 5) statusStr = "approved";
                                      else if (node.approved_level > 0) statusStr = `approved level ${node.approved_level}`;
                                      else if (node.approved_level === 0) statusStr = "waiting";
                                    }
                                    
                                    if (selectedRow?.min_approval_level >= 5) {
                                      statusStr = "approved";
                                    } else if (selectedRow?.min_approval_level > 0 && (!statusStr || statusStr === "waiting" || statusStr.includes('level'))) {
                                      const currentLevelMatch = statusStr?.match(/level\s+(\d+)/i);
                                      const currentLevel = currentLevelMatch ? parseInt(currentLevelMatch[1]) : 0;
                                      if (currentLevel < selectedRow.min_approval_level) {
                                        statusStr = `approved level ${selectedRow.min_approval_level}`;
                                      }
                                    }

                                    const nodeStatus = statusStr?.toLowerCase() || '';
                                    const filterVal = selectedDetailStatus.toLowerCase();
                                    
                                    if (filterVal === 'approved') {
                                      statusMatch = nodeStatus.includes('approved') && !nodeStatus.includes('level 1') && !nodeStatus.includes('level 2') && !nodeStatus.includes('level 3') && !nodeStatus.includes('level 4'); 
                                    } else {
                                      statusMatch = nodeStatus.includes(filterVal);
                                    }
                                  }

                                  const nodeMatches = dateMatch && statusMatch;

                                  if (nodeMatches) {
                                    let costToAdd = 0;
                                    if (node.volume_cost_final > 0) {
                                      const vol = Number(node.volume) || 0;
                                      const prog = node.progress !== undefined ? Number(node.progress) : 100;
                                      costToAdd = Number(node.volume_cost_final) * vol * (prog / 100);
                                    } else {
                                      costToAdd = node.total_price || 0;
                                    }
                                    totalFilteredCost += costToAdd;
                                  }

                                  if (node.material && node.material.length > 0) {
                                    calculateFilteredCost(node.material);
                                  }
                                });
                              };
                              if (detailedRowData.repair_list) {
                                calculateFilteredCost(detailedRowData.repair_list);
                              }

                              const matchesFilters = (node: any): boolean => {
                                let dateMatch = true;
                                if (selectedDetailDate) {
                                  const d = node.date_approval ? node.date_approval.split(' ')[0] : 
                                            (node.created_at || node.updated_at || detailedRowData?.created_at)?.split(' ')[0];
                                  dateMatch = d === selectedDetailDate;
                                }

                                let statusMatch = true;
                                if (selectedDetailStatus) {
                                  let statusStr = node.status_approval;
                                  if (node.approved_level !== undefined && node.approved_level !== null) {
                                    if (node.approved_level >= 5) statusStr = "approved";
                                    else if (node.approved_level > 0) statusStr = `approved level ${node.approved_level}`;
                                    else if (node.approved_level === 0) statusStr = "waiting";
                                  }
                                  
                                  if (selectedRow?.min_approval_level >= 5) {
                                    statusStr = "approved";
                                  } else if (selectedRow?.min_approval_level > 0 && (!statusStr || statusStr === "waiting" || statusStr.includes('level'))) {
                                    const currentLevelMatch = statusStr?.match(/level\s+(\d+)/i);
                                    const currentLevel = currentLevelMatch ? parseInt(currentLevelMatch[1]) : 0;
                                    if (currentLevel < selectedRow.min_approval_level) {
                                      statusStr = `approved level ${selectedRow.min_approval_level}`;
                                    }
                                  }

                                  const nodeStatus = statusStr?.toLowerCase() || '';
                                  const filterVal = selectedDetailStatus.toLowerCase();
                                  
                                  if (filterVal === 'approved') {
                                    statusMatch = nodeStatus.includes('approved') && !nodeStatus.includes('level 1') && !nodeStatus.includes('level 2') && !nodeStatus.includes('level 3') && !nodeStatus.includes('level 4'); 
                                  } else {
                                    statusMatch = nodeStatus.includes(filterVal);
                                  }
                                }

                                if (dateMatch && statusMatch) return true;

                                if (node.material && node.material.length > 0) {
                                  return node.material.some(matchesFilters);
                                }
                                return false;
                              };

                              const renderItem = (item: any, depth = 0): React.ReactNode => {
                                const match = matchesFilters(item);
                                
                                // Aturan: Repair List Induk (depth 0) selalu muncul, hanya detail anak yang disembunyikan
                                if (depth > 0 && !match) return null;

                                let titleHtml = '';
                                if (item.group_flag || item.label?.toLowerCase() === 'grup') {
                                  titleHtml = item.description || item.label;
                                } else {
                                  titleHtml = item.label || item.description;
                                }
                                
                                if (!titleHtml) titleHtml = 'Pekerjaan / Item';

                                return (
                                  <div key={item.id || item.uniqcode || Math.random()} className={`mt-3 ${depth > 0 ? 'ml-4 md:ml-8 border-l-2 border-[#FDB913]/20 pl-4 md:pl-6' : ''}`}>
                                    <div className={`p-4 rounded-xl border transition-colors flex flex-col md:flex-row justify-between items-start gap-4 shadow-sm ${depth === 0 ? 'bg-[#FDB913]/5 border-[#FDB913]/30' : 'bg-white border-slate-200 hover:border-[#FDB913]/50'}`}>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm sm:text-base font-bold text-slate-800 leading-relaxed" dangerouslySetInnerHTML={{ __html: titleHtml }}></p>
                                        
                                        {/* Parameter / Quantity Display */}
                                        {(!item.group_flag && item.label?.toLowerCase() !== 'grup' && (!item.material || item.material.length === 0)) && (
                                          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-xs text-slate-600 font-medium items-center">
                                            <span className="bg-white border border-slate-200 shadow-sm px-2.5 py-1 rounded-md text-[#FDB913]">
                                              Volume: <span className="font-black text-sm">{item.volume || item.act_quantity || item.quantity || 0}</span> {item.volume_unit || item.unit || ''}
                                            </span>
                                            {(() => {
                                              let statusStr = item.status_approval;
                                              if (item.approved_level !== undefined && item.approved_level !== null) {
                                                if (item.approved_level >= 5) statusStr = "approved";
                                                else if (item.approved_level > 0) statusStr = `approved level ${item.approved_level}`;
                                                else if (item.approved_level === 0) statusStr = "waiting";
                                              }
                                              
                                              // Fallback: Paksa mengikuti master header (selectedRow) jika detail masih tertinggal
                                              if (selectedRow?.min_approval_level >= 5) {
                                                statusStr = "approved";
                                              } else if (selectedRow?.min_approval_level > 0 && (!statusStr || statusStr === "waiting" || statusStr.includes('level'))) {
                                                // Jangan turunkan level jika item sudah lebih tinggi dari header
                                                const currentLevelMatch = statusStr?.match(/level\s+(\d+)/i);
                                                const currentLevel = currentLevelMatch ? parseInt(currentLevelMatch[1]) : 0;
                                                if (currentLevel < selectedRow.min_approval_level) {
                                                  statusStr = `approved level ${selectedRow.min_approval_level}`;
                                                }
                                              }

                                              if (!statusStr) return null;
                                              
                                              const isAppr = statusStr.toLowerCase().includes('approved');
                                              return (
                                                <span className={`uppercase tracking-wider font-black ${isAppr ? 'text-emerald-600' : 'text-amber-500'}`}>
                                                  [{statusStr}]
                                                </span>
                                              );
                                            })()}
                                            
                                          </div>
                                        )}
                                      </div>
                                      
                                      {(item.volume_cost_final > 0 || item.total_price > 0) && (
                                        <div className="text-left md:text-right shrink-0 mt-2 md:mt-0 bg-white px-3 py-2 rounded-lg border border-slate-100 flex flex-col md:items-end justify-center">
                                          {item.volume_cost_final > 0 && (
                                            <span className="text-[9px] text-slate-400 font-mono mb-1 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                                              Satuan: {formatIDR(item.volume_cost_final)}
                                            </span>
                                          )}
                                          <span className="text-[10px] text-slate-400 block mb-0.5 uppercase tracking-wider font-bold">Total Harga</span>
                                          <p className="text-base font-black text-emerald-600 font-mono tracking-tight">
                                            {(() => {
                                              let costToDisplay = 0;
                                              if (item.volume_cost_final > 0) {
                                                const vol = Number(item.volume) || 0;
                                                const prog = item.progress !== undefined ? Number(item.progress) : 100;
                                                costToDisplay = Number(item.volume_cost_final) * vol * (prog / 100);
                                              } else {
                                                costToDisplay = item.total_price || 0;
                                              }
                                              return formatIDR(costToDisplay);
                                            })()}
                                          </p>
                                        </div>
                                      )}
                                    </div>
                                    
                                    {/* Recursion for Children */}
                                    {item.material && item.material.length > 0 && (
                                      <div className="mt-2 space-y-2">
                                        {item.material.map((m: any) => renderItem(m, depth + 1))}
                                      </div>
                                    )}
                                  </div>
                                );
                              };
                              return (
                                <>
                                  {totalFilteredCost > 0 && (
                                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex justify-between items-center mb-2 shadow-sm">
                                      <span className="text-sm font-bold text-emerald-800">Total Biaya Pekerjaan (Terfilter):</span>
                                      <span className="text-lg font-black text-emerald-600 font-mono">{formatIDR(totalFilteredCost)}</span>
                                    </div>
                                  )}
                                  {detailedRowData.repair_list.map((m: any) => renderItem(m, 0))}
                                </>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tab Content: Material */}
                    {activeDetailTab === 'material' && (
                      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {(() => {
                          const totalMaterialCost = detailedRowData.t_requisition_details?.reduce((acc: number, req: any) => {
                            const reqTotal = req.t_delivery_details?.reduce((sum: number, del: any) => {
                              const qty = parseFloat(del.quantity || '0');
                              const price = parseFloat(del.t_receiving_detail?.unit_price || '0');
                              return sum + (qty * price);
                            }, 0) || 0;
                            return acc + reqTotal;
                          }, 0) || 0;

                          return (
                            <h4 className="text-sm font-bold uppercase text-emerald-500 tracking-wider pb-2 border-b-2 border-solid border-emerald-500/20 flex justify-between items-end">
                              <span>Kebutuhan Material (Requisition)</span>
                              {totalMaterialCost > 0 && (
                                <span className="bg-emerald-500 text-white px-3 py-1 rounded-lg text-xs tracking-normal">
                                  Total: {formatIDR(totalMaterialCost)}
                                </span>
                              )}
                            </h4>
                          );
                        })()}
                        
                        {!detailedRowData.t_requisition_details || detailedRowData.t_requisition_details.length === 0 ? (
                           <p className="text-sm text-slate-500 italic p-6 bg-slate-50 rounded-xl text-center">Tidak ada daftar kebutuhan material tersedia</p>
                        ) : (
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {detailedRowData.t_requisition_details.map((req: any) => {
                              const compFromReq = req.m_component || req.t_delivery_details?.[0]?.m_component;
                              const localComp = masterComponentsMap[req.m_component_id?.toString()];
                              
                              const materialName = 
                                localComp?.description_code || localComp?.description || 
                                compFromReq?.description_code || compFromReq?.description || 
                                `Barang/Material (ID: ${req.m_component_id})`;
                              
                              return (
                                <div key={req.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between gap-3 hover:border-emerald-500/30 transition-colors">
                                  <div className="min-w-0">
                                    <p className="text-sm font-bold text-slate-800 leading-snug" title={materialName}>
                                      {materialName}
                                    </p>
                                    <div className="flex flex-wrap gap-x-3 gap-y-2 mt-3 text-xs text-slate-600">
                                    <span className="font-bold text-[#FDB913] bg-[#FDB913]/10 px-2 py-1 rounded-md border border-[#FDB913]/20">Req: {req.quantity} {localComp?.unit || req.unit}</span>
                                    <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100">Terkirim: {req.quantity_delivered}</span>
                                    {req.quantity_undelivered > 0 && <span className="font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-md border border-rose-100">Sisa: {req.quantity_undelivered}</span>}
                                  </div>
                                </div>
                                  {req.t_delivery_details?.length > 0 && (
                                     <div className="mt-2 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                                        <div className="flex items-center gap-2">
                                          <span className="bg-emerald-500 text-white px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">Terkirim pada</span>
                                          <span className="font-mono text-slate-500 font-bold">
                                            {req.t_delivery_details[0].t_delivery?.date ? new Date(req.t_delivery_details[0].t_delivery.date).toLocaleDateString('id-ID', {day:'numeric', month:'long', year:'numeric'}) : ''}
                                          </span>
                                        </div>
                                        {(() => {
                                          const subTotal = req.t_delivery_details.reduce((sum: number, del: any) => {
                                            const qty = parseFloat(del.quantity || '0');
                                            const price = parseFloat(del.t_receiving_detail?.unit_price || '0');
                                            return sum + (qty * price);
                                          }, 0);
                                          return subTotal > 0 ? (
                                            <div className="font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100" title="Harga Total Material">
                                              {formatIDR(subTotal)}
                                            </div>
                                          ) : null;
                                        })()}
                                     </div>
                                  )}
                              </div>
                            )})}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-16 flex flex-col items-center justify-center gap-5 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                    <div className="text-center max-w-md">
                      <div className="w-16 h-16 bg-[#FDB913]/20 rounded-full flex items-center justify-center mx-auto mb-4 text-[#FDB913]">
                        <DownloadCloud size={32} />
                      </div>
                      <p className="text-lg font-bold text-slate-800">Data Rincian Belum Tersedia di Lokal</p>
                      <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                        Detail item pekerjaan dan material untuk Work Order ini belum tersimpan di database lokal sistem Anda.
                      </p>
                    </div>
                    {detailFetchError && (
                      <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm font-bold border border-red-200 shadow-sm">
                        Error: {detailFetchError}
                      </div>
                    )}
                    <button 
                      onClick={triggerSyncDetail}
                      disabled={isSyncingDetail}
                      className="mt-2 flex items-center gap-2 px-6 py-3 bg-[#FDB913] hover:bg-[#e5a611] text-slate-900 text-sm font-bold rounded-xl transition-all shadow-lg shadow-[#FDB913]/30 hover:shadow-[#FDB913]/50 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                    >
                      {isSyncingDetail ? (
                        <>
                          <RefreshCw size={18} className="animate-spin" />
                          Menarik Data dari API Samudera...
                        </>
                      ) : (
                        <>
                          <DownloadCloud size={18} />
                          Tarik Data Rincian Sekarang
                        </>
                      )}
                    </button>
                  </div>
                )}

                <div className="space-y-2 mt-8 pt-6 border-t border-slate-200">
                  <span className="text-xs font-bold uppercase text-slate-500 tracking-wider flex items-center justify-between cursor-pointer hover:text-slate-800 transition-colors" onClick={(e) => {
                    const wrapper = e.currentTarget.nextElementSibling;
                    if (wrapper) wrapper.classList.toggle('hidden');
                  }}>
                    <span>Lihat Raw JSON Response (Mode Debug)</span>
                    <span className="text-[10px] bg-slate-200 px-2 py-0.5 rounded-md text-slate-600 shadow-inner">KLIK UNTUK TOGGLE</span>
                  </span>
                  <div className="hidden relative mt-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(detailedRowData || selectedRow, null, 2));
                        alert('JSON dicopy ke clipboard!');
                      }}
                      className="absolute top-3 right-8 p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition border border-slate-700"
                      title="Copy JSON"
                    >
                      <Copy size={14} />
                    </button>
                    <pre className="text-xs p-5 pt-10 rounded-xl overflow-x-auto font-mono bg-slate-950 text-emerald-400 max-h-96 border border-slate-800 custom-scrollbar shadow-inner">
                      {JSON.stringify(detailedRowData || selectedRow, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
