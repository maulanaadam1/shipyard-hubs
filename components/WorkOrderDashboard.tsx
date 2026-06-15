import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Search, 
  FileText, 
  Layers, 
  Users, 
  CheckCircle, 
  Clock, 
  AlertCircle, 
  Filter, 
  RefreshCw, 
  ChevronLeft, 
  ChevronRight, 
  Eye, 
  EyeOff,
  X, 
  Ship, 
  ArrowUp,
  ArrowDown,
  TrendingUp,
  Briefcase,
  DollarSign,
  UploadCloud,
  FileSpreadsheet,
  UserCheck,
  Calendar,
  ExternalLink,
  Settings,
  CloudLightning,
  DownloadCloud,
  Copy
} from 'lucide-react';
import { api, getHeaders } from '@/lib/api-client';
import { useData } from '@/context/DataContext';
import { SearchableSelect } from './SearchableSelect';

const MOCK_DATA: any[] = [];

export default function WorkOrderDashboard() {
  const { syncCache, setSyncCache, syncDates, setSyncDates } = useData();
  const [rawData, setRawData] = useState<any[]>(syncCache['WorkOrders'] || MOCK_DATA);
  const [financialData, setFinancialData] = useState<Record<string, any>>({});
  const [isUsingMock, setIsUsingMock] = useState(!syncCache['WorkOrders']);
  const [fileName, setFileName] = useState(syncDates['WorkOrders'] ? `Auto-Synced (${syncDates['WorkOrders']})` : "Data Contoh (Demo)");
  const [lastSyncDate, setLastSyncDate] = useState<string>(syncDates['WorkOrders'] || '');
  const isDarkMode = false;
  const [loading, setLoading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Filter States
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProject, setSelectedProject] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("All");
  const [selectedVendor, setSelectedVendor] = useState("All");
  
  // Date Filtering States
  const [datePreset, setDatePreset] = useState("week"); // Options: "week", "month", "3months", "6months", "year", "all", "custom"
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  // Table Page State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Pagination states for sub-cards
  const [projectPage, setProjectPage] = useState(1);
  const [vendorPage, setVendorPage] = useState(1);
  const cardItemsPerPage = 5;

  // Selected Detail Row State (Drawer)
  const [selectedRow, setSelectedRow] = useState<any>(null);
  const [detailedRowData, setDetailedRowData] = useState<any>(null);
  const [isFetchingDetail, setIsFetchingDetail] = useState(false);
  const [isSyncingDetail, setIsSyncingDetail] = useState(false);
  const [detailFetchError, setDetailFetchError] = useState<string | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<'pekerjaan' | 'material'>('pekerjaan');
  const [masterComponentsMap, setMasterComponentsMap] = useState<Record<string, any>>({});

  // Hover state for SVG weekly trend interaction
  const [hoveredTrendPoint, setHoveredTrendPoint] = useState<any>(null);

  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, number>>({});
  const [finalCosts, setFinalCosts] = useState<Record<string, number>>({});
  const [previousCosts, setPreviousCosts] = useState<Record<string, number>>({});
  const [finalDates, setFinalDates] = useState<Record<string, string>>({});
  const [trendGroupingMode, setTrendGroupingMode] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [sortColumn, setSortColumn] = useState('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

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
        // Not synced yet, this is expected.
        setDetailedRowData(null);
        return false;
      } else {
        setDetailFetchError("Gagal membaca database lokal.");
        return false;
      }
    } catch (error) {
      setDetailFetchError("Terjadi kesalahan jaringan.");
      return false;
    } finally {
      setIsFetchingDetail(false);
    }
  };

  useEffect(() => {
    if (rawData.length === 0) return;
    const fetchFinances = async () => {
      const ids = rawData.map(d => d.id);
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

  const fetchPendingApprovals = async (ids: string[]) => {
    if (!ids || ids.length === 0) return;
    try {
      const headers = await getHeaders();
      const res = await fetch('/api/work-orders/bulk-pending-approvals', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids: ids.map(String) })
      });
      if (res.ok) {
        const map = await res.json();
        const newPending: Record<string, number> = {};
        const newFinal: Record<string, number> = {};
        const newFinalDates: Record<string, string> = {};
        const newPrev: Record<string, number> = {};
        
        Object.keys(map).forEach(id => {
          if (map[id] && typeof map[id] === 'object') {
            newPending[id] = map[id].pending || 0;
            // "Nilai Saat Ini" menggunakan latest_cost (delta di tanggal terakhir)
            newFinal[id] = map[id].latest_cost !== undefined ? map[id].latest_cost : (map[id].final_cost || 0);
            newPrev[id] = map[id].previous_cost !== undefined ? map[id].previous_cost : (map[id].final_cost || 0);
            newFinalDates[id] = map[id].latest_date || '';
          } else {
            // Backward compatibility
            newPending[id] = map[id] || 0;
            newPrev[id] = map[id] || 0;
            newFinalDates[id] = '';
          }
        });

        setPendingApprovals(prev => ({ ...prev, ...newPending }));
        setFinalCosts(prev => ({ ...prev, ...newFinal }));
        setPreviousCosts(prev => ({ ...prev, ...newPrev }));
        setFinalDates(prev => ({ ...prev, ...newFinalDates }));
      }
    } catch (e) {}
  };

  const triggerSyncDetail = async () => {
    if (!selectedRow || !selectedRow.id) return;
    setIsSyncingDetail(true);
    setDetailFetchError(null);
    try {
      const headers = await getHeaders();
      const res = await fetch(`/api/work-orders/${selectedRow.id}/sync`, { method: 'POST', headers });
      if (res.ok) {
        const result = await res.json();
        setDetailedRowData(result.data || result);
        fetchPendingApprovals([selectedRow.id]); // update main table immediately
      } else {
        const errObj = await res.json().catch(() => ({}));
        setDetailFetchError(errObj.error || "Gagal melakukan sinkronisasi dengan API Samudera.");
      }
    } catch (error) {
      setDetailFetchError("Terjadi kesalahan jaringan saat proses sinkronisasi.");
    } finally {
      setIsSyncingDetail(false);
    }
  };

  useEffect(() => {
    if (selectedRow) {
      setActiveDetailTab('pekerjaan'); // reset tab on new selection
      fetchDetail().then((hasLocalData) => {
        // Automatically sync to pull the latest details when modal opens
        // If hasLocalData is false, we definitely need it.
        // Even if it's true, we trigger sync in the background so the user always has latest data.
        triggerSyncDetail();
      });
    } else {
      setDetailedRowData(null);
    }
  }, [selectedRow]);

  // Fetch Master Components on mount for a base map
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

  // Dynamically fetch missing master components for the current detail view
  useEffect(() => {
    if (!detailedRowData || !detailedRowData.t_requisition_details) return;

    const fetchMissing = async () => {
      let missingIds: string[] = [];
      detailedRowData.t_requisition_details.forEach((req: any) => {
        if (req.m_component_id && !masterComponentsMap[req.m_component_id.toString()]) {
          missingIds.push(req.m_component_id.toString());
        }
      });

      // Deduplicate
      missingIds = Array.from(new Set(missingIds));
      if (missingIds.length === 0) return;

      const newMap = { ...masterComponentsMap };
      let updated = false;

      // Fetch each missing ID individually (since bulk IN is not supported locally)
      for (const id of missingIds) {
        try {
          const { data, error } = await api.from('master_components').eq('id', id).select();
          if (!error && data && data.length > 0) {
            newMap[id] = data[0];
            updated = true;
          }
        } catch (e) {
          console.error("Failed to fetch component ID", id, e);
        }
      }

      if (updated) {
        setMasterComponentsMap(newMap);
      }
    };

    fetchMissing();
  }, [detailedRowData, masterComponentsMap]);

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
          setIsUsingMock(false);
          setFileName(`Auto-Synced (${lastSync || 'Baru Saja'})`);
          setLastSyncDate(lastSync || '');

          // Update global cache
          setSyncCache(prev => ({ ...prev, WorkOrders: list }));
          setSyncDates(prev => ({ ...prev, WorkOrders: lastSync || '' }));
        }
      }
    } catch(e) {
      console.error("Gagal narik data dari cache/db:", e);
      // Fallback to mock data silently
    }
  };

  // Load data from local DB on mount (no auto remote sync)
  useEffect(() => {
    if (!syncCache['WorkOrders']) {
      fetchSyncData();
    }
  }, []);

  const triggerManualSync = async () => {
    setIsSyncing(true);
    try {
      const headers = await getHeaders();
      const body = JSON.stringify({ id: 'WorkOrders' });
      const res = await fetch('/api/sync/trigger', { method: 'POST', headers, body });
      if (!res.ok) throw new Error("Gagal");
      
      // Update data silently without reloading window
      await fetchSyncData();
      setIsSyncing(false);
    } catch (e) {
      alert("Gagal melakukan sinkronisasi. Cek log server atau pastikan URL API valid di menu API Sync Config.");
      setIsSyncing(false);
    }
  };

  // Reset pagination when data presets change
  useEffect(() => {
    setProjectPage(1);
    setVendorPage(1);
    setCurrentPage(1);
  }, [rawData, datePreset, customStartDate, customEndDate]);

  // Kalkulasi Chart Modal Header
  const detailChartConfig = useMemo(() => {
    if (!detailedRowData || !detailedRowData.repair_list) return null;
    
    const dailyMap: Record<string, number> = {};
    let unapprovedCost = 0;
    let latestApprove5Date = "";
    let latestWaitingDate = "";

    const scanDates = (items: any[]) => {
      items.forEach(item => {
        let statusAppr = (item.status_approval || "").toLowerCase();
        let isRejected = statusAppr === 'rejected';
        let isAppr5 = !isRejected && (item.approved_level >= 5 || statusAppr === 'approved' || statusAppr === 'approved level 5');
        if (!isRejected && !isAppr5 && selectedRow?.min_approval_level >= 5) {
          isAppr5 = true;
        }
        let isWaiting = !isRejected && (item.approved_level === 0 || statusAppr === 'waiting');

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
        let statusAppr = (item.status_approval || "").toLowerCase();
        let isRejected = statusAppr === 'rejected';
        
        // Logika Fallback Approval (sama seperti UI)
        let isAppr5 = !isRejected && (item.approved_level >= 5 || statusAppr === 'approved' || statusAppr === 'approved level 5');
        if (!isRejected && !isAppr5 && selectedRow?.min_approval_level >= 5) {
          isAppr5 = true; // Paksa anggap approved jika headernya approved
        }
        
        let isLevel1To4 = !isRejected && ((item.approved_level >= 1 && item.approved_level <= 4) || statusAppr.startsWith("level") || statusAppr.startsWith("approved level"));
        
        let isAppr = isAppr5 || (allowLevel1To4 && isLevel1To4);

        let dateToUse = item.date_approval;
        if (isAppr && !dateToUse) {
          // Jika tidak ada date_approval tapi statusnya dipaksa approved, pakai fallback tanggal
          dateToUse = item.created_at || item.updated_at || detailedRowData?.created_at || selectedRow?.created_at || new Date().toISOString();
        }

        let finalCost = 0;
        if (item.volume_cost_final > 0) {
          const baseCost = Number(item.volume_cost_final) || 0;
          const volume = Number(item.volume) || 0;
          const progress = item.progress !== undefined ? Number(item.progress) : 100;
          finalCost = baseCost * volume * (progress / 100);
        } else if (item.total_price > 0) {
          finalCost = Number(item.total_price);
        }

        if (finalCost > 0) {
           if (isAppr && dateToUse) {
             const dateOnly = dateToUse.split(' ')[0]; // YYYY-MM-DD
             dailyMap[dateOnly] = (dailyMap[dateOnly] || 0) + finalCost;
           } else if (!isAppr && !isRejected) {
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
    if (dates.length === 0) {
       if (unapprovedCost === 0 && selectedRow?.totalCostNum > 0) {
          unapprovedCost = selectedRow.totalCostNum;
       }
       return { cumPoints: [], dailyPoints: [], cumPathD: '', cumAreaD: '', dailyPathD: '', width: 800, height: 145, maxCost: 0, unapprovedCost };
    }

    let cumulative = 0;
    const chartData = dates.map(d => {
       cumulative += dailyMap[d];
       return { date: d, dailyCost: dailyMap[d], cumCost: cumulative };
    });

    const width = 800; // arbitrary base width for SVG viewBox
    const height = 145; // increased height
    const padX = 40; // increased padding
    const padY = 30; // increased padding
    
    const maxCost = Math.max(...chartData.map(d => d.cumCost), 1);
    const pointDist = dates.length > 1 ? (width - padX * 2) / (dates.length - 1) : width / 2;
    
    const cumPoints = chartData.map((d, i) => {
      const x = dates.length === 1 ? width / 2 : padX + (i * pointDist);
      const ratio = d.cumCost / maxCost;
      const y = height - padY - (ratio * (height - padY * 2));
      const shortDate = d.date.substring(5).replace('-', '/'); // MM/DD
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



  const getApprovalStatusText = (level: any) => {
    const lvl = Number(level);
    switch (lvl) {
      case 0: return "Waiting";
      case 1: return "Approval Level 1";
      case 2: return "Approval Level 2";
      case 3: return "Approval Level 3";
      case 4: return "Approval Level 4";
      case 5: return "Approval Level 5";
      default: return `Approval Level ${lvl}`;
    }
  };

  const getStatusBadgeStyles = (status: string) => {
    switch (status) {
      case "Waiting":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20";
      case "Approval Level 1":
        return "bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20";
      case "Approval Level 2":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20";
      case "Approval Level 3":
        return "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20";
      case "Approval Level 4":
        return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20";
      case "Approval Level 5":
        return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20";
      default:
        return "bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20";
    }
  };

  const getStatusIcon = (status: string) => {
    if (status === "Waiting") {
      return <Clock size={12} />;
    }
    if (status === "Approval Level 5") {
      return <CheckCircle size={12} />;
    }
    return <UserCheck size={12} />;
  };

  // 1. Ekstraksi Data Dasar & Struktur Proyek
  const processedData = useMemo(() => {
    return rawData.map(item => {
      const fin = financialData[item.id];
      const levelStatus = getApprovalStatusText(item.min_approval_level);
      const jo = item.jo_code || "N/A";
      const ship = item.m_ship_name || "N/A";
      const combProjectName = `${jo.toUpperCase()} - ${ship.toUpperCase()}`;

      return {
        ...item,
        derivedStatus: levelStatus,
        fullWoCost: Number(item.total_cost || 0),
        fullApprovedCost: fin ? fin.final_cost : 0,
        totalCostNum: fin && fin.latest_cost !== undefined ? fin.latest_cost : (fin ? fin.final_cost : Number(item.total_cost || 0)), // Delta for compatibility
        latest_date: fin ? fin.latest_date : null,
        projectName: combProjectName, 
        shipName: ship.toUpperCase(),
        vendorName: item.m_vendor_name || "Tanpa Vendor",
        joCode: jo,
        woCode: item.code || "N/A",
        createdAtStr: item.created_at ? item.created_at.split(' ')[0] : 'N/A'
      };
    });
  }, [rawData, financialData]);

  const latestDatasetDate = useMemo(() => {
    if (processedData.length === 0) return new Date();
    
    return processedData.reduce((latest, current) => {
      const currentDate = current.latest_date ? new Date(current.latest_date) : null;
      if (!currentDate || isNaN(currentDate.getTime())) return latest;
      return currentDate > latest ? currentDate : latest;
    }, new Date('2000-01-01'));
  }, [processedData]);

  // Kalkulasi Rentang Tanggal Efektif berdasarkan Preset
  const effectiveDateRange = useMemo(() => {
    const end = new Date(latestDatasetDate);
    const start = new Date(latestDatasetDate);

    if (datePreset === "week") {
      start.setDate(end.getDate() - 6);
    } else if (datePreset === "2weeks") {
      start.setDate(end.getDate() - 13);
    } else if (datePreset === "month") {
      start.setMonth(end.getMonth() - 1);
    } else if (datePreset === "3months") {
      start.setMonth(end.getMonth() - 3);
    } else if (datePreset === "6months") {
      start.setMonth(end.getMonth() - 6);
    } else if (datePreset === "year") {
      start.setFullYear(end.getFullYear() - 1);
    } else if (datePreset === "custom") {
      const s = customStartDate ? new Date(customStartDate) : null;
      const e = customEndDate ? new Date(customEndDate) : null;
      return { 
        start: s && !isNaN(s.getTime()) ? s : null, 
        end: e && !isNaN(e.getTime()) ? e : null 
      };
    } else {
      // "all"
      return { start: null, end: null };
    }

    return { start, end };
  }, [latestDatasetDate, datePreset, customStartDate, customEndDate]);

  // 1.1. Unsur filter list yang unik (filterOptions) - DIURUTKAN SECARA KRONOLOGIS (TERBARU DI ATAS)
  const filterOptions = useMemo(() => {
    const projectMap: Record<string, number> = {}; // projectName -> t_job_order_id tertinggi
    const vendors = new Set<string>();

    processedData.forEach(item => {
      if (item.projectName) {
        const currentId = Number(item.t_job_order_id || 0);
        if (!projectMap[item.projectName] || currentId > projectMap[item.projectName]) {
          projectMap[item.projectName] = currentId;
        }
      }
      if (item.vendorName) vendors.add(item.vendorName);
    });

    // Mengurutkan nama proyek berdasarkan nomor ID Job Order (t_job_order_id) secara menurun (terbaru/tertinggi terlebih dahulu)
    const sortedProjects = Object.keys(projectMap).sort((a, b) => {
      return projectMap[b] - projectMap[a];
    });

    return {
      projects: ["All", ...sortedProjects],
      vendors: ["All", ...Array.from(vendors).sort()]
    };
  }, [processedData]);

  // 2. Terapkan Filter Tanggal Terlebih Dahulu (Dasar dari Seluruh Komponen Dashboard)
  const dateFilteredData = useMemo(() => {
    const { start, end } = effectiveDateRange;
    
    // Jika tidak ada filter tanggal aktif (Semua / All), return semua data
    if (!start && !end) return processedData;

    return processedData.filter(item => {
      // Untuk filter spesifik, jika tanggal kosong, maka skip. 
      // Jika filter adalah "Semua", sudah tertangkap oleh return processedData di atas.
      if (!item.latest_date) return false;
      const cleanStr = item.latest_date.replace(' ', 'T');
      const itemTime = new Date(cleanStr).getTime();
      if (isNaN(itemTime)) return false;

      if (start && itemTime < start.getTime()) return false;
      if (end) {
        const endOfDay = new Date(end);
        endOfDay.setHours(23, 59, 59, 999); // Pastikan mencakup seluruh jam di hari terakhir
        if (itemTime > endOfDay.getTime()) return false;
      }
      return true;
    });
  }, [processedData, effectiveDateRange]);

  // 3. Terapkan Filter Pencarian Global
  const searchFilteredData = useMemo(() => {
    return dateFilteredData.filter(item => {
      return (
        item.woCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.joCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.vendorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.shipName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.created_name && item.created_name.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    });
  }, [dateFilteredData, searchTerm]);

  // 4. Data spesifik untuk di-render pada Kartu Sub-Project (Hanya di-filter oleh Vendor & Status)
  const dataForProjectCard = useMemo(() => {
    return searchFilteredData.filter(item => {
      const matchStatus = selectedStatus === "All" || item.derivedStatus === selectedStatus;
      const matchVendor = selectedVendor === "All" || item.vendorName === selectedVendor;
      return matchStatus && matchVendor;
    });
  }, [searchFilteredData, selectedStatus, selectedVendor]);

  // 5. Data spesifik untuk di-render pada Kartu Sub-Vendor (Hanya di-filter oleh Proyek & Status)
  const dataForVendorCard = useMemo(() => {
    return searchFilteredData.filter(item => {
      const matchProject = selectedProject === "All" || item.projectName === selectedProject;
      const matchStatus = selectedStatus === "All" || item.derivedStatus === selectedStatus;
      return matchProject && matchStatus;
    });
  }, [searchFilteredData, selectedProject, selectedStatus]);

  // 6. Data Terfilter Akhir untuk Tabel Utama
  const filteredData = useMemo(() => {
    return searchFilteredData.filter(item => {
      const matchProject = selectedProject === "All" || item.projectName === selectedProject;
      const matchStatus = selectedStatus === "All" || item.derivedStatus === selectedStatus;
      const matchVendor = selectedVendor === "All" || item.vendorName === selectedVendor;
      return matchProject && matchStatus && matchVendor;
    });
  }, [searchFilteredData, selectedProject, selectedStatus, selectedVendor]);

  // 7. Kalkulasi Folder Master Directory untuk Sidebar / Sub Cards
  const masterDirectories = useMemo(() => {
    const projectTracker: Record<string, any> = {};
    dataForProjectCard.forEach(item => {
      const pName = item.projectName;
      const jobOrderId = Number(item.t_job_order_id || 0);
      
      if (!projectTracker[pName]) {
        projectTracker[pName] = {
          name: pName,
          count: 0,
          maxJobOrderId: 0,
          latestDate: ""
        };
      }
      projectTracker[pName].count++;
      if (jobOrderId > projectTracker[pName].maxJobOrderId) {
        projectTracker[pName].maxJobOrderId = jobOrderId;
      }
      if (!projectTracker[pName].latestDate || item.created_at > projectTracker[pName].latestDate) {
        projectTracker[pName].latestDate = item.created_at;
      }
    });
    
    const allSortedProjects = Object.values(projectTracker)
      .sort((a, b) => b.maxJobOrderId - a.maxJobOrderId);

    const vendorProjectTracker: Record<string, any> = {};
    dataForVendorCard.forEach(item => {
      const vName = item.vendorName;
      const pName = item.projectName;
      const combKey = `${vName}::${pName}`;
      const woId = Number(item.id || 0);
      const woCode = item.woCode;
      const createdAt = item.created_at || "";

      if (!vendorProjectTracker[combKey]) {
        vendorProjectTracker[combKey] = {
          key: combKey,
          vendorName: vName,
          projectName: pName,
          count: 0,
          cost: 0,
          latestWOId: 0,
          latestWOCode: "",
          latestWODate: ""
        };
      }
      vendorProjectTracker[combKey].count++;
      vendorProjectTracker[combKey].cost += item.total_cost || 0;
      
      if (woId > vendorProjectTracker[combKey].latestWOId) {
        vendorProjectTracker[combKey].latestWOId = woId;
        vendorProjectTracker[combKey].latestWOCode = woCode;
        vendorProjectTracker[combKey].latestWODate = createdAt;
      }
    });

    const allSortedVendorProjects = Object.values(vendorProjectTracker)
      .sort((a, b) => b.latestWOId - a.latestWOId);

    return { allSortedProjects, allSortedVendorProjects };
  }, [dataForProjectCard, dataForVendorCard]);

  // 8. Statistik Global Real-time
  const stats = useMemo(() => {
    const totalWOs = filteredData.length;
    
    const joSet = new Set(filteredData.map(d => d.joCode).filter(c => c !== "N/A"));
    const totalJOs = joSet.size;

    const vendorSet = new Set(filteredData.map(d => d.vendorName));
    const totalVendors = vendorSet.size;

    const projectSet = new Set(filteredData.map(d => d.projectName));
    const totalProjects = projectSet.size;

    // Kalkulasi Total Estimasi Biaya (berdasarkan nilai approve penuh, bukan delta, atau gunakan fullWoCost jika dinginkan)
    // Sebaiknya ini menggunakan fullApprovedCost agar yang dijumlahkan adalah nominal yang fix.
    const totalCostValue = filteredData.reduce((acc, curr) => acc + curr.fullApprovedCost, 0);

    const approvalCounts: Record<string, number> = {
      "Waiting": 0,
      "Approval Level 1": 0,
      "Approval Level 2": 0,
      "Approval Level 3": 0,
      "Approval Level 4": 0,
      "Approval Level 5": 0
    };
    
    filteredData.forEach(item => {
      const statusKey = item.derivedStatus;
      if (approvalCounts[statusKey] !== undefined) {
        approvalCounts[statusKey]++;
      } else {
        approvalCounts[statusKey] = (approvalCounts[statusKey] || 0) + 1;
      }
    });

    return {
      totalWOs,
      totalJOs,
      totalVendors,
      totalProjects,
      totalCostValue,
      approvalCounts
    };
  }, [filteredData]);

  // Helper: Pengelompokan Tanggal ke Hari / Senin Mingguan / Bulan
  const getStartOfWeek = (dateStr: string) => {
    if (!dateStr) return null;
    const cleanStr = dateStr.replace(' ', 'T');
    const d = new Date(cleanStr);
    if (isNaN(d.getTime())) return null;
    
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const startOfWeek = new Date(d.setDate(diff));
    return startOfWeek.toISOString().split('T')[0];
  };

  // Update otomatis trendGroupingMode ketika preset tanggal berubah (dengan fallback ke manual override jika user klik toggle)
  useEffect(() => {
    if (datePreset === "week") setTrendGroupingMode("daily");
    else if (datePreset === "2weeks") setTrendGroupingMode("daily");
    else if (datePreset === "month") setTrendGroupingMode("weekly");
    else if (datePreset === "3months") setTrendGroupingMode("monthly");
    else if (datePreset === "6months") setTrendGroupingMode("monthly");
    else if (datePreset === "year") setTrendGroupingMode("monthly");
    else if (datePreset === "all") setTrendGroupingMode("monthly");
    else if (datePreset === "custom" && effectiveDateRange.start && effectiveDateRange.end) {
      const diffDays = Math.ceil(Math.abs(effectiveDateRange.end.getTime() - effectiveDateRange.start.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays <= 14) setTrendGroupingMode("daily");
      else if (diffDays <= 90) setTrendGroupingMode("weekly");
      else setTrendGroupingMode("monthly");
    }
  }, [datePreset, effectiveDateRange.start, effectiveDateRange.end]);

  // Kalkulasi Tren Finansial Mingguan / Harian / Bulanan secara Kronologis
  const weeklyCostTrend = useMemo(() => {
    const groups: Record<string, { cost: number; count: number }> = {};
    filteredData.forEach(item => {
      // Hanya plot dokumen yang sudah memiliki latest_date (approval finansial)
      // untuk menyamakan bentuk grafik dengan Financial Dashboard
      const targetDate = item.latest_date;
      if (!targetDate) return;
      
      let groupKey: string | null = "";
      if (trendGroupingMode === "daily") {
        groupKey = targetDate.split(' ')[0]; // YYYY-MM-DD
      } else if (trendGroupingMode === "weekly") {
        groupKey = getStartOfWeek(targetDate); // Hari Senin Terdekat
      } else {
        groupKey = targetDate.substring(0, 7); // YYYY-MM (Bulanan)
      }

      if (!groupKey) return;
      if (!groups[groupKey]) {
        groups[groupKey] = { cost: 0, count: 0 };
      }
      
      // Ambil nilai yang memang diproses pada hari/minggu/bulan tersebut
      // Karena kita asumsikan targetDate = latest_date, maka biaya pada targetDate = latest_cost
      const costToAdd = financialData[item.id] && financialData[item.id].latest_cost !== undefined ? financialData[item.id].latest_cost : item.totalCostNum;
      
      groups[groupKey].cost += costToAdd;
      groups[groupKey].count += 1;
    });

    return Object.keys(groups)
      .sort() 
      .map(groupKey => {
        let formattedLabel = "";
        if (trendGroupingMode === "daily") {
          const d = new Date(groupKey);
          formattedLabel = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        } else if (trendGroupingMode === "weekly") {
          const d = new Date(groupKey);
          formattedLabel = "Mng-" + d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        } else {
          const [year, month] = groupKey.split('-');
          const d = new Date(Number(year), Number(month) - 1, 1);
          formattedLabel = d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
        }

        return {
          key: groupKey,
          label: formattedLabel,
          cost: groups[groupKey].cost,
          count: groups[groupKey].count
        };
      });
  }, [filteredData, trendGroupingMode]);

  // SVG Coordinates Generator untuk Trendline Dinamis
  const svgChartConfig = useMemo(() => {
    const width = 1000;
    const height = 180;
    const paddingLeft = 55;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 25;

    if (weeklyCostTrend.length === 0) return { points: [], pathD: "", areaD: "", gridLines: [], width, height, paddingLeft, paddingRight, paddingTop, paddingBottom };

    const maxCost = Math.max(...weeklyCostTrend.map(t => t.cost), 1);
    
    const points = weeklyCostTrend.map((item, idx) => {
      const x = weeklyCostTrend.length > 1
        ? paddingLeft + (idx * (width - paddingLeft - paddingRight)) / (weeklyCostTrend.length - 1)
        : paddingLeft + (width - paddingLeft - paddingRight) / 2;
      
      const y = height - paddingBottom - (item.cost / maxCost) * (height - paddingTop - paddingBottom);
      return {
        x,
        y,
        ...item
      };
    });

    let pathD = "";
    let areaD = "";
    
    if (points.length > 0) {
      pathD = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');
      areaD = `M ${points[0].x} ${height - paddingBottom} ` + 
              points.map(p => `L ${p.x} ${p.y}`).join(' ') + 
              ` L ${points[points.length - 1].x} ${height - paddingBottom} Z`;
    }

    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(factor => {
      const y = height - paddingBottom - factor * (height - paddingTop - paddingBottom);
      const value = factor * maxCost;
      return { y, value };
    });

    return { points, pathD, areaD, gridLines, width, height, paddingLeft, paddingRight, paddingTop, paddingBottom };
  }, [weeklyCostTrend]);

  // Handle file uploads & reset
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setLoading(true);
    setUploadError("");
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        let list = [];
        if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed)) {
            list = parsed;
          } else if (parsed.data && Array.isArray(parsed.data)) {
            list = parsed.data;
          } else {
            throw new Error("Format JSON harus berupa Array atau mengandung 'data' berupa Array.");
          }
        } else {
          throw new Error("Format JSON tidak valid.");
        }

        if (list.length === 0) {
          throw new Error("Berkas JSON kosong.");
        }

        setRawData(list);
        setIsUsingMock(false);
      } catch (err: any) {
        setUploadError(err.message || "Gagal mengurai file JSON.");
        setRawData(MOCK_DATA);
        setIsUsingMock(true);
        setFileName("Data Contoh (Demo)");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  };

  const handleResetData = () => {
    setRawData(MOCK_DATA);
    setIsUsingMock(true);
    setFileName("Data Contoh (Demo)");
    setUploadError("");
    setDatePreset("week"); // reset ke preset default
  };

  const paginatedProjects = useMemo(() => {
    const startIndex = (projectPage - 1) * cardItemsPerPage;
    return masterDirectories.allSortedProjects.slice(startIndex, startIndex + cardItemsPerPage);
  }, [masterDirectories.allSortedProjects, projectPage]);

  const totalProjectPages = Math.ceil(masterDirectories.allSortedProjects.length / cardItemsPerPage) || 1;

  const paginatedVendorProjects = useMemo(() => {
    const startIndex = (vendorPage - 1) * cardItemsPerPage;
    return masterDirectories.allSortedVendorProjects.slice(startIndex, startIndex + cardItemsPerPage);
  }, [masterDirectories.allSortedVendorProjects, vendorPage]);

  const totalVendorPages = Math.ceil(masterDirectories.allSortedVendorProjects.length / cardItemsPerPage) || 1;

  const sortedData = useMemo(() => {
    return [...filteredData].sort((a, b) => {
      let valA: any = a[sortColumn as keyof typeof a];
      let valB: any = b[sortColumn as keyof typeof b];

      if (sortColumn === 'pending_approvals') {
        valA = pendingApprovals[a.id] || 0;
        valB = pendingApprovals[b.id] || 0;
      } else if (sortColumn === 'final_costs') {
        valA = finalCosts[a.id] || 0;
        valB = finalCosts[b.id] || 0;
      } else if (sortColumn === 'totalCostNum') {
        valA = a.totalCostNum || 0;
        valB = b.totalCostNum || 0;
      } else if (sortColumn === 'derivedStatus') {
        valA = a.derivedStatus || '';
        valB = b.derivedStatus || '';
      } else {
        valA = valA || '';
        valB = valB || '';
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortColumn, sortDirection, pendingApprovals, finalCosts]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedData.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedData, currentPage]);

  const fetchedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const pageIds = paginatedData.map(d => String(d.id));
    const newIds = pageIds.filter(id => !fetchedIdsRef.current.has(id));
    
    if (newIds.length > 0) {
      newIds.forEach(id => fetchedIdsRef.current.add(id));
      fetchPendingApprovals(newIds);
      
      // Retry after 8s for IDs that still have no data (API may have been slow the first time)
      const retryTimer = setTimeout(() => {
        const retryIds = newIds.filter(id => !finalCosts[id] && !pendingApprovals[id]);
        if (retryIds.length > 0) {
          fetchPendingApprovals(retryIds);
        }
      }, 8000);
      return () => clearTimeout(retryTimer);
    }
  }, [paginatedData]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;

  const formatIDR = (value: number) => {
    if (isNominalHidden) return 'Rp ****';
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(value);
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc'); // Default ke desc kalau kolom baru
    }
  };

  const renderSortIcon = (column: string) => {
    if (sortColumn !== column) return <span className="text-slate-300 ml-1 opacity-0 group-hover:opacity-100 transition"><ArrowDown size={12} /></span>;
    return sortDirection === 'asc' ? <ArrowUp size={12} className="ml-1 text-indigo-500" /> : <ArrowDown size={12} className="ml-1 text-indigo-500" />;
  };

  const handleApprovalClick = (statusName: string) => {
    if (selectedStatus === statusName) {
      setSelectedStatus("All");
    } else {
      setSelectedStatus(statusName);
    }
  };

  const handleProjectClick = (projectName: string) => {
    if (selectedProject === projectName) {
      setSelectedProject("All");
    } else {
      setSelectedProject(projectName);
    }
  };

  const handleVendorProjectClick = (vendorName: string, projectName: string) => {
    if (selectedVendor === vendorName && selectedProject === projectName) {
      setSelectedVendor("All");
      setSelectedProject("All");
    } else {
      setSelectedVendor(vendorName);
      setSelectedProject(projectName);
    }
  };

  return (
    <div className={`min-h-screen font-sans transition-colors duration-300 ${isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      
      {/* SYNC LOADING OVERLAY REMOVED (User preferred non-intrusive sync) */}

      {/* DRAWER: Detail Work Order (muncul jika selectedRow tidak null) */}
      
      {/* HEADER BAR */}
      <header className={`sticky top-0 z-30 border-b backdrop-blur-md px-6 py-4 flex flex-wrap justify-between items-center gap-4 ${isDarkMode ? 'bg-slate-900/80 border-slate-800' : 'bg-white/80 border-slate-200'}`}>
        <div className="flex items-center gap-3">
          <div>
            <h2 className={`font-display font-bold text-xl md:text-2xl tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Work Order Dashboard</h2>
            <p className="text-xs md:text-sm text-slate-500 mt-1">Resume & Analitika Work Order Logistik Perkapalan</p>
          </div>
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

        {/* SECTION 2: SUMMARY METRICS STATS */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <div className={`p-4 md:p-5 rounded-2xl border flex flex-col md:flex-row md:items-center gap-3 md:gap-4 transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div className="p-2 md:p-3 rounded-xl bg-blue-500/10 text-blue-500 w-fit">
              <FileText className="w-5 h-5 md:w-6 md:h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] md:text-xs font-semibold text-slate-400 uppercase tracking-wider truncate">Total WO</p>
              <h3 className="text-xl md:text-2xl font-bold mt-0.5 md:mt-1 truncate">{stats.totalWOs}</h3>
              <p className="text-[9px] md:text-[10px] text-slate-400 mt-0.5 md:mt-1 truncate">Work Orders Terfilter</p>
            </div>
          </div>

          <div className={`p-4 md:p-5 rounded-2xl border flex flex-col md:flex-row md:items-center gap-3 md:gap-4 transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div className="p-2 md:p-3 rounded-xl bg-purple-500/10 text-purple-500 w-fit">
              <Layers className="w-5 h-5 md:w-6 md:h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] md:text-xs font-semibold text-slate-400 uppercase tracking-wider truncate">Total JO Unik</p>
              <h3 className="text-xl md:text-2xl font-bold mt-0.5 md:mt-1 truncate">{stats.totalJOs}</h3>
              <p className="text-[9px] md:text-[10px] text-slate-400 mt-0.5 md:mt-1 truncate">Kode Job Order Berbeda</p>
            </div>
          </div>

          <div className={`p-4 md:p-5 rounded-2xl border flex flex-col md:flex-row md:items-center gap-3 md:gap-4 transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div className="p-2 md:p-3 rounded-xl bg-cyan-500/10 text-cyan-500 w-fit">
              <Ship className="w-5 h-5 md:w-6 md:h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] md:text-xs font-semibold text-slate-400 uppercase tracking-wider truncate">Total Project</p>
              <h3 className="text-xl md:text-2xl font-bold mt-0.5 md:mt-1 truncate">{stats.totalProjects}</h3>
              <p className="text-[9px] md:text-[10px] text-slate-400 mt-0.5 md:mt-1 truncate">Kombinasi JO & Kapal</p>
            </div>
          </div>

          <div className={`p-4 md:p-5 rounded-2xl border flex flex-col md:flex-row md:items-center gap-3 md:gap-4 transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div className="p-2 md:p-3 rounded-xl bg-emerald-500/10 text-emerald-500 w-fit">
              <Users className="w-5 h-5 md:w-6 md:h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] md:text-xs font-semibold text-slate-400 uppercase tracking-wider truncate">Total Vendor</p>
              <h3 className="text-xl md:text-2xl font-bold mt-0.5 md:mt-1 truncate">{stats.totalVendors}</h3>
              <p className="text-[9px] md:text-[10px] text-slate-400 mt-0.5 md:mt-1 truncate">Vendor Aktif Tergabung</p>
            </div>
          </div>
        </section>

        {/* SECTION 3: FINANCES & GARIS TREN BIAYA MINGGUAN */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Card Status Keuangan Aktual */}
          <div className={`p-6 rounded-2xl border flex flex-col justify-between transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500">
                  <DollarSign size={24} />
                </div>
                <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest bg-emerald-500/10 px-2.5 py-1 rounded-lg">Aktual Cost</span>
              </div>
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Estimasi & Aktual Pengeluaran</p>
              <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-1 md:mt-2 text-slate-900 break-all truncate" title={formatIDR(stats.totalCostValue)}>
                {formatIDR(stats.totalCostValue)}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2.5 leading-relaxed">
                Akumulasi seluruh nilai finansial dari Work Order logistik perkapalan yang terdaftar pada filter aktif saat ini.
              </p>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 grid grid-cols-2 gap-2 text-center">
              <div className="border-r border-slate-100">
                <p className="text-[10px] font-bold text-slate-600 uppercase">Rata-Rata WO</p>
                <p className="text-sm font-bold text-slate-800 mt-1">
                  {stats.totalWOs > 0 ? formatIDR(Math.round(stats.totalCostValue / stats.totalWOs)) : formatIDR(0)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-600 uppercase">Kontrak WO</p>
                <p className="text-sm font-bold text-indigo-600 mt-1">{stats.totalWOs} Berkas</p>
              </div>
            </div>
          </div>

          {/* Card Grafik Tren Biaya Mingguan */}
          <div className={`p-6 rounded-2xl border flex flex-col justify-between lg:col-span-2 transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div>
              {/* Header Grafik & Pengendali Filter */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-4">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
                    <Calendar size={16} className="text-indigo-500" />
                    Tren Biaya Operasional
                  </h3>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <button 
                      onClick={() => setTrendGroupingMode('daily')} 
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${trendGroupingMode === 'daily' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-500/5 hover:bg-slate-500/10 text-slate-500 dark:text-slate-400'}`}
                    >Harian</button>
                    <button 
                      onClick={() => setTrendGroupingMode('weekly')} 
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${trendGroupingMode === 'weekly' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-500/5 hover:bg-slate-500/10 text-slate-500 dark:text-slate-400'}`}
                    >Mingguan</button>
                    <button 
                      onClick={() => setTrendGroupingMode('monthly')} 
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${trendGroupingMode === 'monthly' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-500/5 hover:bg-slate-500/10 text-slate-500 dark:text-slate-400'}`}
                    >Bulanan</button>
                  </div>
                </div>

                {/* Preset Buttons */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: "week", label: "1 Mng" },
                    { id: "2weeks", label: "2 Mng" },
                    { id: "month", label: "1 Bln" },
                    { id: "3months", label: "3 Bln" },
                    { id: "6months", label: "6 Bln" },
                    { id: "year", label: "1 Thn" },
                    { id: "all", label: "Semua" },
                    { id: "custom", label: "Kustom" }
                  ].map(preset => (
                    <button
                      key={preset.id}
                      onClick={() => setDatePreset(preset.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                        datePreset === preset.id 
                          ? 'bg-indigo-600 text-white shadow-sm' 
                          : 'bg-slate-500/5 hover:bg-slate-500/10 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tampilkan Input Tanggal Kustom jika preset = "custom" */}
              {datePreset === "custom" && (
                <div className="flex flex-wrap items-center gap-3 p-3 mb-4 rounded-xl bg-slate-500/5 border border-slate-200 dark:border-slate-800 transition-all duration-300">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Dari:</span>
                    <input 
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className={`px-2 py-1 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-indigo-500 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Hingga:</span>
                    <input 
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className={`px-2 py-1 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-indigo-500 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}
                    />
                  </div>
                </div>
              )}

              {/* Status Informasi titik yang di-hover */}
              <div className="flex justify-between items-center h-6 text-xs">
                {hoveredTrendPoint ? (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                    <span className="font-semibold text-slate-600 dark:text-slate-300">Periode {hoveredTrendPoint.label}:</span>
                    <span className="font-bold text-emerald-500 font-mono">{formatIDR(hoveredTrendPoint.cost)}</span>
                    <span className="text-[10px] text-slate-400">({hoveredTrendPoint.count} WO)</span>
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-400 italic">Arahkan kursor Anda pada titik koordinat untuk melihat angka detail</p>
                )}
              </div>

              {/* Weekly SVG Chart */}
              <div className="relative mt-2 w-full">
                {weeklyCostTrend.length === 0 ? (
                  <div className="h-28 flex flex-col items-center justify-center text-xs text-slate-400 bg-slate-500/5 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                    <TrendingUp size={24} className="mb-2 text-slate-300" />
                    Belum ada riwayat transaksi pada rentang waktu terpilih
                  </div>
                ) : (
                  <div className="w-full overflow-x-auto overflow-y-hidden">
                    <svg viewBox={`0 0 ${svgChartConfig.width} ${svgChartConfig.height}`} className="w-full h-auto max-h-[180px] select-none overflow-visible">
                      <defs>
                        <linearGradient id="chart-glow" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.25"/>
                          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.00"/>
                        </linearGradient>
                      </defs>

                      {/* Horizontal Gridlines */}
                      {svgChartConfig.gridLines.map((line, idx) => (
                        <g key={idx}>
                          <line 
                            x1={svgChartConfig.paddingLeft} 
                            y1={line.y} 
                            x2={svgChartConfig.width - svgChartConfig.paddingRight} 
                            y2={line.y} 
                            stroke={isDarkMode ? "#1e293b" : "#f1f5f9"} 
                            strokeWidth="1" 
                          />
                          <text 
                            x={svgChartConfig.paddingLeft - 8} 
                            y={line.y + 3} 
                            fill={isDarkMode ? "#64748b" : "#94a3b8"} 
                            fontSize="8" 
                            textAnchor="end"
                            fontWeight="500"
                          >
                            {line.value >= 1000000 ? `${(line.value / 1000000).toFixed(1)}M` : `${line.value.toLocaleString('id-ID')}`}
                          </text>
                        </g>
                      ))}

                      {/* Glow Area */}
                      {svgChartConfig.areaD && (
                        <path d={svgChartConfig.areaD} fill="url(#chart-glow)" className="transition-all duration-300" />
                      )}

                      {/* Trendline */}
                      {svgChartConfig.pathD && (
                        <path 
                          d={svgChartConfig.pathD} 
                          fill="none" 
                          stroke="#6366f1" 
                          strokeWidth="2.5" 
                          strokeLinecap="round" 
                          strokeLinejoin="round"
                          className="transition-all duration-300" 
                        />
                      )}

                      {/* Koordinat Points */}
                      {svgChartConfig.points.map((pt, idx) => (
                        <g key={idx}>
                          <circle 
                            cx={pt.x} 
                            cy={pt.y} 
                            r={hoveredTrendPoint?.key === pt.key ? "6" : "3.5"} 
                            fill={hoveredTrendPoint?.key === pt.key ? "#10b981" : "#6366f1"}
                            stroke={isDarkMode ? "#0b1329" : "#ffffff"}
                            strokeWidth="1.5"
                            className="cursor-pointer transition-all duration-200"
                            onMouseEnter={() => setHoveredTrendPoint(pt)}
                            onMouseLeave={() => setHoveredTrendPoint(null)}
                          />
                          <circle 
                            cx={pt.x} 
                            cy={pt.y} 
                            r="15" 
                            fill="transparent" 
                            className="cursor-pointer"
                            onMouseEnter={() => setHoveredTrendPoint(pt)}
                            onMouseLeave={() => setHoveredTrendPoint(null)}
                          />
                        </g>
                      ))}

                      {/* X-Axis Labels */}
                      {svgChartConfig.points.map((pt, idx) => (
                        <text 
                          key={idx} 
                          x={pt.x} 
                          y={svgChartConfig.height - 6} 
                          fill={isDarkMode ? "#475569" : "#64748b"} 
                          fontSize="8" 
                          textAnchor="middle"
                          fontWeight="600"
                        >
                          {pt.label}
                        </text>
                      ))}
                    </svg>
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex flex-wrap justify-between items-center text-[10px] text-slate-500 dark:text-slate-400 mt-2">
              <span>* Data dihimpun berdasarkan tanggal approval finansial.</span>
              <span className="font-mono text-indigo-500">
                Penyaringan: {new Date(effectiveDateRange.start || latestDatasetDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })} s.d {new Date(effectiveDateRange.end || latestDatasetDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
          </div>

        </section>

        {/* SECTION 4: CHARTS & VISUALIZATIONS */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Chart Card 1: 5-Level + Waiting Approval Status Distribution */}
          <div className={`p-5 rounded-2xl border transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-sm font-bold tracking-wide uppercase text-slate-400">Tingkat Approval & Status</h3>
                <p className="text-[10px] text-indigo-500 font-medium">Klik baris status untuk menyaring data</p>
              </div>
              <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500"><CheckCircle size={16} /></span>
            </div>
            
            <div className="space-y-2 py-1">
              {Object.keys(stats.approvalCounts).map((statusName) => {
                const count = stats.approvalCounts[statusName] || 0;
                const percent = stats.totalWOs ? Math.round((count / stats.totalWOs) * 100) : 0;
                const isCurrentFilter = selectedStatus === statusName;
                
                let barColor = "bg-amber-500";
                if (statusName === "Approval Level 1") barColor = "bg-sky-500";
                if (statusName === "Approval Level 2") barColor = "bg-blue-500";
                if (statusName === "Approval Level 3") barColor = "bg-indigo-500";
                if (statusName === "Approval Level 4") barColor = "bg-purple-500";
                if (statusName === "Approval Level 5") barColor = "bg-emerald-500";

                return (
                  <div 
                    key={statusName}
                    onClick={() => handleApprovalClick(statusName)}
                    className={`p-2 rounded-xl cursor-pointer transition-all ${
                      isCurrentFilter 
                        ? 'bg-indigo-500/10 ring-2 ring-indigo-500 dark:ring-indigo-400' 
                        : 'hover:bg-slate-500/5'
                    }`}
                    title={`Klik untuk menyaring ${statusName}`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-semibold flex items-center gap-1.5">
                        <span className={`w-2.5 h-2.5 rounded-full inline-block ${barColor}`}></span>
                        {statusName}
                        {isCurrentFilter && (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-indigo-500 text-white dark:bg-indigo-400 dark:text-slate-950 uppercase tracking-widest scale-90">
                            Aktif
                          </span>
                        )}
                      </span>
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                        {count} WO ({percent}%)
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-500 ${barColor}`} 
                        style={{ width: `${percent}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 p-2.5 rounded-xl bg-slate-500/5 text-slate-400 text-center text-[10px] leading-relaxed">
              * Klik status di atas untuk langsung menyaring tabel di bawah. Klik sekali lagi untuk mereset.
            </div>
          </div>

          {/* Chart Card 2: Daftar Proyek Terbaru */}
          <div className={`p-5 rounded-2xl border flex flex-col justify-between transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold tracking-wide uppercase text-slate-400">Proyek Terbaru (Kronologis)</h3>
                  <p className="text-[10px] text-indigo-500 font-medium">Klik proyek untuk menyaring data & vendor</p>
                </div>
                <span className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500"><Briefcase size={16} /></span>
              </div>

              <div className="space-y-3 py-1">
                {paginatedProjects.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-xs text-slate-400">Tidak ada data proyek</div>
                ) : (
                  paginatedProjects.map((project) => {
                    const isCurrentProjectFilter = selectedProject === project.name;
                    
                    return (
                      <div 
                        key={project.name} 
                        onClick={() => handleProjectClick(project.name)}
                        className={`border-b border-slate-100 dark:border-slate-800/30 pb-2 last:border-0 last:pb-0 p-2 rounded-xl cursor-pointer transition-all ${
                          isCurrentProjectFilter 
                            ? 'bg-indigo-500/10 ring-2 ring-indigo-500 dark:ring-indigo-400' 
                            : 'hover:bg-slate-500/5'
                        }`}
                        title={`Klik untuk menyaring ${project.name}`}
                      >
                        <div className="flex justify-between items-start">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-slate-900 truncate pr-2 flex items-center gap-1" title={project.name}>
                              {project.name}
                              {isCurrentProjectFilter && (
                                <span className="text-[8px] font-bold px-1.5 py-0.2 rounded bg-indigo-500 text-white uppercase tracking-wider">
                                  Aktif
                                </span>
                              )}
                            </p>
                            <p className="text-[10px] text-slate-500 font-medium truncate pr-2 mt-0.5">
                              ID Project: #{project.maxJobOrderId}
                            </p>
                          </div>
                          <div className="text-right pl-2 shrink-0">
                            <p className="text-xs font-bold text-indigo-500">{project.count} WO</p>
                            <p className="text-[9px] font-medium text-slate-400 opacity-0">-</p>
                          </div>
                        </div>
                        <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
                          <span className="font-mono">Tgl: {project.latestDate ? project.latestDate.split(' ')[0] : 'N/A'}</span>
                          <span>{project.latestDate ? project.latestDate.split(' ')[0] : 'N/A'}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="pt-4 mt-2 border-t border-slate-100 dark:border-slate-800/50 flex items-center justify-between text-xs">
              <span className="text-[10px] text-slate-400 font-semibold">Hal. {projectPage} dari {totalProjectPages}</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setProjectPage(prev => Math.max(prev - 1, 1))}
                  disabled={projectPage === 1}
                  className="p-1 rounded-md border dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition"
                  title="Halaman Sebelumnya"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => setProjectPage(prev => Math.min(prev + 1, totalProjectPages))}
                  disabled={projectPage === totalProjectPages}
                  className="p-1 rounded-md border dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition"
                  title="Halaman Selanjutnya"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Chart Card 3: Partner Vendor Berdasarkan Project */}
          <div className={`p-5 rounded-2xl border flex flex-col justify-between transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold tracking-wide uppercase text-slate-400">Partner Vendor per Proyek</h3>
                  <p className="text-[10px] text-indigo-500 font-medium">Klik baris untuk mengunci Vendor & Proyek</p>
                </div>
                <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500"><Users size={16} /></span>
              </div>

              <div className="space-y-3 py-1">
                {paginatedVendorProjects.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-xs text-slate-400">Tidak ada data vendor</div>
                ) : (
                  paginatedVendorProjects.map((vp) => {
                    const isCurrentVendorFilter = selectedVendor === vp.vendorName && selectedProject === vp.projectName;

                    return (
                      <div 
                        key={vp.key} 
                        onClick={() => handleVendorProjectClick(vp.vendorName, vp.projectName)}
                        className={`border-b border-slate-100 dark:border-slate-800/30 pb-2 last:border-0 last:pb-0 p-2 rounded-xl cursor-pointer transition-all ${
                          isCurrentVendorFilter 
                            ? 'bg-emerald-500/10 ring-2 ring-emerald-500 dark:ring-emerald-400' 
                            : 'hover:bg-slate-500/5'
                        }`}
                        title={`Klik untuk menyaring Vendor ${vp.vendorName} pada Proyek ${vp.projectName}`}
                      >
                        <div className="flex justify-between items-start">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-slate-900 truncate pr-2 flex items-center gap-1" title={vp.vendorName}>
                              {vp.vendorName}
                              {isCurrentVendorFilter && (
                                <span className="text-[8px] font-bold px-1.5 py-0.2 rounded bg-emerald-500 text-white uppercase tracking-wider">
                                  Aktif
                                </span>
                              )}
                            </p>
                            <p className="text-[10px] text-slate-500 font-medium truncate pr-2 mt-0.5" title={vp.projectName}>
                              Proyek: {vp.projectName}
                            </p>
                          </div>
                          <div className="text-right pl-2 shrink-0">
                            <p className="text-xs font-bold text-emerald-500">{formatIDR(vp.cost)}</p>
                            <p className="text-[9px] font-medium text-slate-400">({vp.count} WO)</p>
                          </div>
                        </div>
                        <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
                          <span className="font-mono">WO: {vp.latestWOCode}</span>
                          <span>{vp.latestWODate ? vp.latestWOCode.split(' ')[0] : 'N/A'}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="pt-4 mt-2 border-t border-slate-100 dark:border-slate-800/50 flex items-center justify-between text-xs">
              <span className="text-[10px] text-slate-400 font-semibold">Hal. {vendorPage} dari {totalVendorPages}</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setVendorPage(prev => Math.max(prev - 1, 1))}
                  disabled={vendorPage === 1}
                  className="p-1 rounded-md border dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition"
                  title="Halaman Sebelumnya"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => setVendorPage(prev => Math.min(prev + 1, totalVendorPages))}
                  disabled={vendorPage === totalVendorPages}
                  className="p-1 rounded-md border dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition"
                  title="Halaman Selanjutnya"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>

        </section>

        {/* SECTION 5: INTERACTIVE FILTER CONTROLS */}
        <section className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h3 className="text-sm font-bold tracking-wide uppercase text-slate-400 flex items-center gap-1.5">
              <Filter size={16} className="text-indigo-500" />
              Kontrol Filter & Penelusuran WO
            </h3>
            <button 
              onClick={() => {
                setSearchTerm("");
                setSelectedProject("All");
                setSelectedStatus("All");
                setSelectedVendor("All");
                setDatePreset("week");
                setCustomStartDate("");
                setCustomEndDate("");
              }}
              className="text-xs font-semibold text-indigo-500 hover:text-indigo-600 transition"
            >
              Reset Semua Filter
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            
            {/* Search Input */}
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                <Search size={16} />
              </span>
              <input 
                type="text" 
                placeholder="Cari WO, JO, Vendor, Kapal..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className={`w-full pl-9 pr-4 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-500' : 'bg-slate-50 border-slate-200 placeholder-slate-400 text-slate-800'}`}
              />
            </div>

            {/* Project Filter - SEKARANG DIURUTKAN SECARA KRONOLOGIS TERBARU DI ATAS */}
            <div className="flex-1 min-w-[200px] z-30">
              <SearchableSelect 
                value={selectedProject}
                onChange={(val) => { setSelectedProject(val); setCurrentPage(1); }}
                options={filterOptions.projects.filter(p => p !== "All")}
                allLabel="Proyek Kapal (Semua - Terbaru)"
              />
            </div>

            {/* Status Filter */}
            <div className="flex-1 min-w-[200px] z-20">
              <SearchableSelect 
                value={selectedStatus}
                onChange={(val) => { setSelectedStatus(val); setCurrentPage(1); }}
                options={[
                  "Waiting",
                  "Approval Level 1",
                  "Approval Level 2",
                  "Approval Level 3",
                  "Approval Level 4",
                  "Approval Level 5"
                ]}
                allLabel="Status Approval (Semua)"
              />
            </div>

            {/* Vendor Filter */}
            <div className="flex-1 min-w-[200px] z-10">
              <SearchableSelect 
                value={selectedVendor}
                onChange={(val) => { setSelectedVendor(val); setCurrentPage(1); }}
                options={filterOptions.vendors.filter(v => v !== "All")}
                allLabel="Vendor Rekanan (Semua)"
              />
            </div>

          </div>
        </section>

        {/* SECTION 6: MASTER DATA TABLE */}
        <section className={`rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
          
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap justify-between items-center gap-4">
            <div>
              <h3 className="text-base font-bold">Daftar Job Order & Work Order</h3>
              <p className="text-xs text-slate-400 mt-0.5">Menampilkan {filteredData.length} data Work Order sesuai filter</p>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">Halaman: {currentPage} dari {totalPages}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <th className="py-3.5 px-6">No</th>
                  <th className="py-3.5 px-6 cursor-pointer group hover:bg-slate-100 transition select-none" onClick={() => handleSort('woCode')}>
                    <div className="flex items-center">Kode WO {renderSortIcon('woCode')}</div>
                  </th>
                  <th className="py-3.5 px-6 cursor-pointer group hover:bg-slate-100 transition select-none" onClick={() => handleSort('joCode')}>
                    <div className="flex items-center">Kode JO {renderSortIcon('joCode')}</div>
                  </th>
                  <th className="py-3.5 px-6 cursor-pointer group hover:bg-slate-100 transition select-none" onClick={() => handleSort('projectName')}>
                    <div className="flex items-center">Proyek {renderSortIcon('projectName')}</div>
                  </th>
                  <th className="py-3.5 px-6 cursor-pointer group hover:bg-slate-100 transition select-none" onClick={() => handleSort('vendorName')}>
                    <div className="flex items-center">Vendor Rekanan {renderSortIcon('vendorName')}</div>
                  </th>
                  <th className="px-6 py-4 font-bold uppercase tracking-wider text-right cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors" onClick={() => handleSort('totalCostNum')}>
                    <div className="flex items-center justify-end">Nilai Sebelumnya {renderSortIcon('totalCostNum')}</div>
                  </th>
                  <th className="px-6 py-4 font-bold uppercase tracking-wider text-right cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors" onClick={() => handleSort('final_costs')}>
                    <div className="flex items-center justify-end">Nilai Saat Ini {renderSortIcon('final_costs')}</div>
                  </th>
                  <th className="py-3.5 px-6 text-right cursor-pointer group hover:bg-slate-100 transition select-none" onClick={() => handleSort('pending_approvals')}>
                    <div className="flex items-center justify-end">Pending Approval {renderSortIcon('pending_approvals')}</div>
                  </th>
                  <th className="py-3.5 px-6 text-center cursor-pointer group hover:bg-slate-100 transition select-none" onClick={() => handleSort('updated_at')}>
                    <div className="flex items-center justify-center">Terakhir Diperbarui {renderSortIcon('updated_at')}</div>
                  </th>
                  <th className="py-3.5 px-6 text-center cursor-pointer group hover:bg-slate-100 transition select-none" onClick={() => handleSort('derivedStatus')}>
                    <div className="flex items-center justify-center">Status Approval {renderSortIcon('derivedStatus')}</div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 text-sm">
                {paginatedData.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400 text-xs">
                      Tidak ada data Work Order yang cocok dengan penyaringan Anda pada rentang waktu ini.
                    </td>
                  </tr>
                ) : (
                  paginatedData.map((item, idx) => (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-indigo-500/5 transition cursor-pointer ${selectedRow && selectedRow.id === item.id ? 'bg-indigo-500/10 dark:bg-indigo-500/10' : ''}`}
                      onClick={() => setSelectedRow(item)}
                    >
                      <td className="py-3.5 px-6 font-semibold text-slate-500 text-xs">
                        {(currentPage - 1) * itemsPerPage + idx + 1}
                      </td>
                      {/* Kode WO berupa Tautan Aktif dengan Ikon Eksternal */}
                      <td className="py-3.5 px-6 font-mono font-semibold text-xs">
                        <a 
                          href={`https://shipyard-siaga.samudera.id/v2/work-orders/progress/${item.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 hover:underline inline-flex items-center gap-1"
                          title="Buka Detail Progres WO di Samudera Shipyard"
                          onClick={(e) => e.stopPropagation()} // Cegah drawer samping terbuka saat klik link
                        >
                          {item.woCode}
                          <ExternalLink size={12} className="opacity-70" />
                        </a>
                      </td>

                      <td className="py-3.5 px-6 font-mono text-slate-900 font-semibold text-xs">
                        {item.joCode}
                      </td>

                      <td className="py-3.5 px-6">
                        <div className="font-semibold text-xs text-slate-900 max-w-[280px] truncate" title={item.projectName}>
                          {item.projectName}
                        </div>
                      </td>

                      <td className="py-3.5 px-6">
                        <div className="max-w-[200px] truncate font-medium text-xs" title={item.vendorName}>
                          {item.vendorName}
                        </div>
                      </td>

                      <td className="py-3.5 px-6 text-right font-semibold font-mono text-xs">
                        {(previousCosts[item.id] !== undefined && previousCosts[item.id] > 0) ? (
                          formatIDR(previousCosts[item.id])
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      {/* Kolom Biaya Harian Terakhir */}
                      <td className="py-3.5 px-6 text-right font-mono text-xs text-blue-500">
                        <div className="font-bold">{finalCosts[item.id] !== undefined ? formatIDR(finalCosts[item.id]) : formatIDR(0)}</div>
                        {finalDates[item.id] && (
                          <div className="text-[10px] text-slate-400 font-sans font-normal mt-0.5">{finalDates[item.id]}</div>
                        )}
                      </td>

                      {/* Kolom Pending Approval */}
                      <td className="py-3.5 px-6 text-right font-bold font-mono text-xs text-amber-500">
                        {pendingApprovals[item.id] !== undefined ? formatIDR(pendingApprovals[item.id]) : formatIDR(0)}
                      </td>

                      {/* Kolom Terakhir Diperbarui */}
                      <td className="py-3.5 px-6 text-center font-mono text-xs text-slate-500 dark:text-slate-400">
                        {item.updated_at || '-'}
                      </td>

                      <td className="py-3.5 px-6 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadgeStyles(item.derivedStatus)}`}>
                          {getStatusIcon(item.derivedStatus)}
                          {item.derivedStatus}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between gap-4">
            <span className="text-xs text-slate-400">
              Menampilkan {Math.min(filteredData.length, (currentPage - 1) * itemsPerPage + 1)}-{Math.min(filteredData.length, currentPage * itemsPerPage)} dari {filteredData.length} data
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
                      {formatIDR(financialData[selectedRow.id] ? financialData[selectedRow.id].final_cost : selectedRow.totalCostNum)}
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
                        {showChartDaily && detailChartConfig.dailyPoints.map((pt, idx) => (
                          <g key={`daily-${idx}`} className="group">
                            <circle cx={pt.x} cy={pt.y} r="3" fill="#ffffff" stroke="#3b82f6" strokeWidth="1.5" className="transition-all duration-200" />
                            <circle cx={pt.x} cy={pt.y} r="15" fill="transparent" className="cursor-crosshair" title={`Tanggal: ${pt.label}\nBiaya Harian: ${formatIDR(pt.cost)}`} />
                            <text x={pt.x} y={pt.y - 8} fill="#3b82f6" fontSize="9" textAnchor="middle" className="opacity-0 group-hover:opacity-100 transition-opacity font-mono font-bold drop-shadow-sm bg-white px-1">
                              {formatIDR(pt.cost)}
                            </text>
                          </g>
                        ))}

                        {/* Cumulative Points */}
                        {showChartCum && detailChartConfig.cumPoints.map((pt, idx) => (
                          <g key={`cum-${idx}`} className="group">
                            <circle cx={pt.x} cy={pt.y} r="4.5" fill="#ffffff" stroke="#10b981" strokeWidth="2" className="transition-all duration-200 group-hover:r-[6px]" />
                            <circle cx={pt.x} cy={pt.y} r="15" fill="transparent" className="cursor-crosshair" title={`Tanggal: ${pt.label}\nTotal Kumulatif: ${formatIDR(pt.cost)}`} />
                            <text x={pt.x} y={pt.y - 12} fill="#059669" fontSize="10" textAnchor="middle" className="opacity-0 group-hover:opacity-100 transition-opacity font-mono font-extrabold drop-shadow-md bg-white/80 px-1">
                              {formatIDR(pt.cost)}
                            </text>
                          </g>
                        ))}
                        
                        {/* Timeline Date Labels (Unconditional) */}
                        {detailChartConfig.cumPoints.map((pt, idx) => {
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
                                    let isRejected = (statusStr || "").toLowerCase() === 'rejected';
                                    
                                    if (!isRejected && node.approved_level !== undefined && node.approved_level !== null) {
                                      if (node.approved_level >= 5) statusStr = "approved";
                                      else if (node.approved_level > 0) statusStr = `approved level ${node.approved_level}`;
                                      else if (node.approved_level === 0) statusStr = "waiting";
                                    }
                                    
                                    if (!isRejected && selectedRow?.min_approval_level >= 5) {
                                      statusStr = "approved";
                                    } else if (!isRejected && selectedRow?.min_approval_level > 0 && (!statusStr || statusStr === "waiting" || statusStr.includes('level'))) {
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
                                  let isRejected = (statusStr || "").toLowerCase() === 'rejected';

                                  if (!isRejected && node.approved_level !== undefined && node.approved_level !== null) {
                                    if (node.approved_level >= 5) statusStr = "approved";
                                    else if (node.approved_level > 0) statusStr = `approved level ${node.approved_level}`;
                                    else if (node.approved_level === 0) statusStr = "waiting";
                                  }
                                  
                                  if (!isRejected && selectedRow?.min_approval_level >= 5) {
                                    statusStr = "approved";
                                  } else if (!isRejected && selectedRow?.min_approval_level > 0 && (!statusStr || statusStr === "waiting" || statusStr.includes('level'))) {
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
                                if (item.parameter?.path_name) {
                                  titleHtml = item.parameter.path_name.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
                                } else if (item.group_flag || item.label?.toLowerCase() === 'grup') {
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
                                              let isRejected = (statusStr || "").toLowerCase() === 'rejected';

                                              if (!isRejected && item.approved_level !== undefined && item.approved_level !== null) {
                                                if (item.approved_level >= 5) statusStr = "approved";
                                                else if (item.approved_level > 0) statusStr = `approved level ${item.approved_level}`;
                                                else if (item.approved_level === 0) statusStr = "waiting";
                                              }
                                              
                                              // Fallback: Paksa mengikuti master header (selectedRow) jika detail masih tertinggal
                                              if (!isRejected && selectedRow?.min_approval_level >= 5) {
                                                statusStr = "approved";
                                              } else if (!isRejected && selectedRow?.min_approval_level > 0 && (!statusStr || statusStr === "waiting" || statusStr.includes('level'))) {
                                                // Jangan turunkan level jika item sudah lebih tinggi dari header
                                                const currentLevelMatch = statusStr?.match(/level\s+(\d+)/i);
                                                const currentLevel = currentLevelMatch ? parseInt(currentLevelMatch[1]) : 0;
                                                if (currentLevel < selectedRow.min_approval_level) {
                                                  statusStr = `approved level ${selectedRow.min_approval_level}`;
                                                }
                                              }

                                              if (!statusStr) return null;
                                              
                                              const isAppr = statusStr.toLowerCase().includes('approved');
                                              const dateStr = item.date_approval;

                                              return (
                                                <div className="flex items-center gap-2">
                                                  <span className={`uppercase tracking-wider font-black ${isAppr ? 'text-emerald-600' : isRejected ? 'text-rose-600' : 'text-amber-500'}`}>
                                                    [{statusStr}]
                                                  </span>
                                                  {dateStr && isAppr && (
                                                    <span className="text-slate-500 text-[11px] bg-slate-100 px-2 py-0.5 rounded">
                                                      Disetujui: <span className="font-bold text-slate-700">{dateStr}</span>
                                                    </span>
                                                  )}
                                                </div>
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
