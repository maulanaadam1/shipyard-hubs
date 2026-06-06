import React, { useState, useMemo, useEffect } from 'react';
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
  X, 
  Ship, 
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
  DownloadCloud
} from 'lucide-react';
import { api, getHeaders } from '@/lib/api-client';

const MOCK_DATA: any[] = [];

export default function WorkOrderDashboard() {
  const [rawData, setRawData] = useState<any[]>(MOCK_DATA);
  const [isUsingMock, setIsUsingMock] = useState(true);
  const [fileName, setFileName] = useState("Data Contoh (Demo)");
  const [lastSyncDate, setLastSyncDate] = useState<string>('');
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
        setPendingApprovals(prev => ({ ...prev, ...map }));
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
        if (!hasLocalData) {
           triggerSyncDetail();
        }
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

  // Auto fetch sync config on mount
  useEffect(() => {
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
              setIsUsingMock(false);
              setFileName(`Auto-Synced (${syncConfig.last_sync || 'Baru Saja'})`);
              setLastSyncDate(syncConfig.last_sync || '');
            }
          }
        }
      } catch(e) {
        // Fallback to mock data silently
      }
    };
    fetchSyncData();
  }, []);

  const triggerManualSync = async () => {
    setIsSyncing(true);
    try {
      const headers = await getHeaders();
      const body = JSON.stringify({ id: 'WorkOrders' });
      const res = await fetch('/api/sync/trigger', { method: 'POST', headers, body });
      if (!res.ok) throw new Error("Gagal");
      // Give a tiny delay so the animation feels complete
      setTimeout(() => {
        window.location.reload();
      }, 800);
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

  // Tentukan Tanggal Jangkar Terbaru dalam Dataset secara Dinamis
  const latestDatasetDate = useMemo(() => {
    if (rawData.length === 0) return new Date("2026-06-02");
    let maxTime = 0;
    rawData.forEach(item => {
      const targetDate = item.updated_at || item.created_at;
      if (targetDate) {
        const t = new Date(targetDate.replace(' ', 'T')).getTime();
        if (t > maxTime) maxTime = t;
      }
    });
    return maxTime > 0 ? new Date(maxTime) : new Date("2026-06-02");
  }, [rawData]);

  // Kalkulasi Rentang Tanggal Efektif berdasarkan Preset
  const effectiveDateRange = useMemo(() => {
    const end = new Date(latestDatasetDate);
    const start = new Date(latestDatasetDate);

    if (datePreset === "week") {
      start.setDate(end.getDate() - 7);
    } else if (datePreset === "2weeks") {
      start.setDate(end.getDate() - 14);
    } else if (datePreset === "month") {
      start.setDate(end.getDate() - 30);
    } else if (datePreset === "3months") {
      start.setDate(end.getDate() - 90);
    } else if (datePreset === "6months") {
      start.setDate(end.getDate() - 180);
    } else if (datePreset === "year") {
      start.setDate(end.getDate() - 365);
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
      const levelStatus = getApprovalStatusText(item.min_approval_level);
      const jo = item.jo_code || "N/A";
      const ship = item.m_ship_name || "N/A";
      const combProjectName = `${jo.toUpperCase()} - ${ship.toUpperCase()}`;

      return {
        ...item,
        derivedStatus: levelStatus,
        totalCostNum: Number(item.total_cost || 0),
        projectName: combProjectName, 
        shipName: ship.toUpperCase(),
        vendorName: item.m_vendor_name || "Tanpa Vendor",
        joCode: jo,
        woCode: item.code || "N/A",
        createdAtStr: item.created_at ? item.created_at.split(' ')[0] : 'N/A'
      };
    });
  }, [rawData]);

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
    return processedData.filter(item => {
      const targetDate = item.updated_at || item.created_at;
      if (!targetDate) return false;
      const cleanStr = targetDate.replace(' ', 'T');
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

    const totalCostValue = filteredData.reduce((acc, curr) => acc + curr.totalCostNum, 0);

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

  // Pengelompokan dinamis (Daily / Weekly / Monthly) agar grafik terlihat seimbang
  const trendGroupingMode = useMemo(() => {
    if (datePreset === "week") return "daily";
    if (datePreset === "2weeks") return "daily";
    if (datePreset === "month") return "weekly";
    if (datePreset === "3months") return "weekly"; // 3 bulan dikelompokkan mingguan
    if (datePreset === "6months") return "monthly"; // 6 bulan dikelompokkan bulanan (Sintaks telah diperbaiki dari kesalahan return=)
    if (datePreset === "year") return "monthly";
    
    const { start, end } = effectiveDateRange;
    if (!start || !end) return "monthly"; 
    
    const diffDays = Math.ceil(Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 10) return "daily";
    if (diffDays <= 100) return "weekly";
    return "monthly";
  }, [datePreset, effectiveDateRange]);

  // Kalkulasi Tren Finansial Mingguan / Harian / Bulanan secara Kronologis
  const weeklyCostTrend = useMemo(() => {
    const groups: Record<string, { cost: number; count: number }> = {};
    filteredData.forEach(item => {
      const targetDate = item.updated_at || item.created_at;
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
      groups[groupKey].cost += item.totalCostNum;
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

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredData, currentPage]);

  useEffect(() => {
    const pageIds = paginatedData.map(d => d.id);
    fetchPendingApprovals(pageIds);
  }, [paginatedData]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage) || 1;

  const formatIDR = (value: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(value);
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
            <h2 className={`font-display font-bold text-2xl tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Work Order Dashboard</h2>
            <p className="text-sm text-slate-500 mt-1">Resume & Analitika Work Order Logistik Perkapalan</p>
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

        {/* SECTION 2: TOP METRICS (4 Columns) */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className={`p-5 rounded-2xl border flex items-center gap-4 transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div className="p-3 rounded-xl bg-blue-500/10 text-blue-500">
              <FileText size={24} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total WO</p>
              <h3 className="text-2xl font-bold mt-1">{stats.totalWOs}</h3>
              <p className="text-[10px] text-slate-400 mt-1">Work Orders Terfilter</p>
            </div>
          </div>

          <div className={`p-5 rounded-2xl border flex items-center gap-4 transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div className="p-3 rounded-xl bg-purple-500/10 text-purple-500">
              <Layers size={24} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total JO Unik</p>
              <h3 className="text-2xl font-bold mt-1">{stats.totalJOs}</h3>
              <p className="text-[10px] text-slate-400 mt-1">Kode Job Order Berbeda</p>
            </div>
          </div>

          <div className={`p-5 rounded-2xl border flex items-center gap-4 transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div className="p-3 rounded-xl bg-cyan-500/10 text-cyan-500">
              <Ship size={24} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Project</p>
              <h3 className="text-2xl font-bold mt-1">{stats.totalProjects}</h3>
              <p className="text-[10px] text-slate-400 mt-1">Kombinasi JO & Kapal</p>
            </div>
          </div>

          <div className={`p-5 rounded-2xl border flex items-center gap-4 transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500">
              <Users size={24} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Vendor</p>
              <h3 className="text-2xl font-bold mt-1">{stats.totalVendors}</h3>
              <p className="text-[10px] text-slate-400 mt-1">Vendor Aktif Tergabung</p>
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
              <h2 className="text-3xl font-extrabold tracking-tight mt-2 text-slate-900 break-all">
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
                  {stats.totalWOs > 0 ? formatIDR(Math.round(stats.totalCostValue / stats.totalWOs)) : "Rp 0"}
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
                    Tren Biaya Operasional ({trendGroupingMode === "daily" ? "Harian" : trendGroupingMode === "weekly" ? "Mingguan" : "Bulanan"})
                  </h3>
                  <p className="text-[10px] text-slate-400 font-medium">Pengelompokan otomatis menyesuaikan jangka waktu</p>
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
              <span>* Data dihimpun berdasarkan tanggal logistik dibuat dalam database.</span>
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
            <div>
              <select
                value={selectedProject}
                onChange={(e) => { setSelectedProject(e.target.value); setCurrentPage(1); }}
                className={`w-full px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
              >
                <option value="All">Proyek / JO - Kapal (Semua - Terbaru Teratas)</option>
                {filterOptions.projects.filter(p => p !== "All").map(proj => (
                  <option key={proj} value={proj}>{proj}</option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <select
                value={selectedStatus}
                onChange={(e) => { setSelectedStatus(e.target.value); setCurrentPage(1); }}
                className={`w-full px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
              >
                <option value="All">Status Approval (Semua)</option>
                <option value="Waiting">Waiting (Level 0)</option>
                <option value="Approval Level 1">Approval Level 1</option>
                <option value="Approval Level 2">Approval Level 2</option>
                <option value="Approval Level 3">Approval Level 3</option>
                <option value="Approval Level 4">Approval Level 4</option>
                <option value="Approval Level 5">Approval Level 5</option>
              </select>
            </div>

            {/* Vendor Filter */}
            <div>
              <select
                value={selectedVendor}
                onChange={(e) => { setSelectedVendor(e.target.value); setCurrentPage(1); }}
                className={`w-full px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-800'}`}
              >
                <option value="All">Vendor Rekanan (Semua)</option>
                {filterOptions.vendors.filter(v => v !== "All").map(vend => (
                  <option key={vend} value={vend}>{vend}</option>
                ))}
              </select>
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
                  <th className="py-3.5 px-6">Kode WO (Work Order)</th>
                  <th className="py-3.5 px-6">Kode JO (Job Order)</th>
                  <th className="py-3.5 px-6">Proyek (JO - Nama Kapal)</th>
                  <th className="py-3.5 px-6">Vendor Rekanan</th>
                  <th className="py-3.5 px-6 text-right">Nilai WO</th>
                  <th className="py-3.5 px-6 text-right">Pending Approval</th>
                  <th className="py-3.5 px-6 text-center">Terakhir Diperbarui</th>
                  <th className="py-3.5 px-6 text-center">Status Approval</th>
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
                        {formatIDR(item.totalCostNum)}
                      </td>

                      {/* Kolom Pending Approval */}
                      <td className="py-3.5 px-6 text-right font-bold font-mono text-xs text-amber-500">
                        {pendingApprovals[item.id] !== undefined ? formatIDR(pendingApprovals[item.id]) : 'Rp 0'}
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
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-5 rounded-xl bg-slate-50 border border-slate-100">
                <div className="md:col-span-1">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2">Status Approval</p>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${getStatusBadgeStyles(selectedRow.derivedStatus)}`}>
                    {getStatusIcon(selectedRow.derivedStatus)}
                    {selectedRow.derivedStatus}
                  </span>
                </div>
                
                <div className="col-span-2 md:col-span-2">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2">Total Biaya (IDR)</p>
                  <p className="text-2xl font-black font-mono text-emerald-600 tracking-tighter">
                    {formatIDR(selectedRow.totalCostNum)}
                  </p>
                </div>

                <div className="col-span-2 md:col-span-1">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2">Vendor / Partner</p>
                  <p className="text-sm font-bold text-slate-800">{selectedRow.vendorName}</p>
                </div>
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
                      <span className="text-xs text-slate-400 block mb-1">Disetujui Terakhir:</span>
                      <p className="font-semibold text-emerald-500">{selectedRow.last_approved || '-'}</p>
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
                        <h4 className="text-sm font-bold uppercase text-[#FDB913] tracking-wider pb-2 border-b-2 border-solid border-[#FDB913]/20 flex justify-between items-end">
                          <span>Daftar Pekerjaan (Repair List)</span>
                        </h4>
                        
                        {!detailedRowData.repair_list || detailedRowData.repair_list.length === 0 ? (
                           <p className="text-sm text-slate-500 italic p-6 bg-slate-50 rounded-xl text-center">Tidak ada detail pekerjaan tersedia</p>
                        ) : (
                          <div className="space-y-3">
                            {(() => {
                              const renderItem = (item: any, depth = 0): React.ReactNode => {
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
                                              if (detailedRowData?.min_approval_level >= 5) {
                                                statusStr = "approved";
                                              } else if (detailedRowData?.min_approval_level > 0 && (!statusStr || statusStr === "waiting")) {
                                                statusStr = `approved level ${detailedRowData.min_approval_level}`;
                                              }

                                              if (!statusStr) return null;
                                              
                                              const isAppr = statusStr.toLowerCase().includes('approved');
                                              return (
                                                <span className={`uppercase tracking-wider font-black ${isAppr ? 'text-emerald-600' : 'text-amber-500'}`}>
                                                  [{statusStr}]
                                                </span>
                                              );
                                            })()}
                                            {item.progress !== undefined && <span className="text-[#e5a611] font-bold bg-[#FDB913]/10 px-2 py-0.5 rounded">Progress: {item.progress}%</span>}
                                          </div>
                                        )}
                                      </div>
                                      
                                      {(item.volume_cost_final > 0 || item.total_price > 0 || item.price > 0) && (
                                        <div className="text-left md:text-right shrink-0 mt-2 md:mt-0 bg-white px-3 py-2 rounded-lg border border-slate-100">
                                          <span className="text-[10px] text-slate-400 block mb-0.5 uppercase tracking-wider font-bold">Total Harga</span>
                                          <p className="text-base font-black text-emerald-600 font-mono tracking-tight">
                                            {formatIDR(item.volume_cost_final || item.total_price || item.price || 0)}
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
                              return detailedRowData.repair_list.map((m: any) => renderItem(m, 0));
                            })()}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tab Content: Material */}
                    {activeDetailTab === 'material' && (
                      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <h4 className="text-sm font-bold uppercase text-emerald-500 tracking-wider pb-2 border-b-2 border-solid border-emerald-500/20 flex justify-between items-end">
                          <span>Kebutuhan Material (Requisition)</span>
                        </h4>
                        
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
                    const pre = e.currentTarget.nextElementSibling;
                    if (pre) pre.classList.toggle('hidden');
                  }}>
                    <span>Lihat Raw JSON Response (Mode Debug)</span>
                    <span className="text-[10px] bg-slate-200 px-2 py-0.5 rounded-md text-slate-600 shadow-inner">KLIK UNTUK TOGGLE</span>
                  </span>
                  <pre className="hidden text-xs p-5 rounded-xl overflow-x-auto font-mono bg-slate-950 text-emerald-400 max-h-96 border border-slate-800 custom-scrollbar shadow-inner mt-2">
                    {JSON.stringify(detailedRowData || selectedRow, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}
