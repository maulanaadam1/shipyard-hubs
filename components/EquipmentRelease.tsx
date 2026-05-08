import React, { useState } from 'react';
import { 
  Package, 
  Search, 
  Filter, 
  MoreVertical, 
  CheckCircle2, 
  Clock, 
  ArrowRight,
  Plus,
  History,
  FileText,
  User,
  ExternalLink,
  ChevronRight,
  Download,
  Trash2,
  Calendar,
  ShieldCheck,
  AlertCircle,
  X,
  ChevronLeft
} from 'lucide-react';
import { useData, LoanRequest, Equipment, ReleaseRecord, ReleaseItem } from '@/context/DataContext';
import { api } from '@/lib/api-client';
import { motion, AnimatePresence } from 'framer-motion';

export default function EquipmentRelease() {
  const { fleet: assets, loans, fetchData, currentUser, releases, projects: allProjects, canAccess } = useData();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<LoanRequest | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('history');
  const [currentPagePending, setCurrentPagePending] = useState(1);
  const [currentPageHistory, setCurrentPageHistory] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(10);

  const generateHexId = () => {
    return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  };

  const [releaseForm, setReleaseForm] = useState({
    received_by: '',
    notes: '',
    items: [] as ReleaseItem[]
  });

  const handleDeleteAll = async () => {
    if (!confirm('⚠️ CRITICAL: Are you sure you want to PERMANENTLY DELETE ALL history (Loans, Releases, and Return records)? This is needed for a clean re-import.')) return;
    
    setIsLoading(true);
    try {
      // 1. Delete all releases
      const { error: relErr } = await api.from('equipment_release').delete().eq('id', 'all');
      if (relErr) throw relErr;
      
      // 2. Delete all loans (to avoid unique constraint errors on re-import)
      const { error: loanErr } = await api.from('loan_requests').delete().eq('id', 'all');
      if (loanErr) throw loanErr;

      // 3. Delete all deployment records (menu return)
      const { error: depErr } = await api.from('deployment_records').delete().eq('unique_id', 'all');
      if (depErr) throw depErr;
      
      alert('✅ Database has been cleared. You can now perform a fresh import.');
      await fetchData();
    } catch (err: any) {
      alert('Delete Error: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLegacyImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    
    try {
      // 1. Fetch current projects to match references
      const { data: existingProjects } = await api.from('projects').select('id, idproject');
      const projectMap = new Map();
      (existingProjects || []).forEach(p => {
        if (p.id) projectMap.set(p.id.toLowerCase(), p.idproject || p.id);
        if (p.idproject) projectMap.set(p.idproject.toLowerCase(), p.idproject);
      });

      // 2. Fetch Equipment Loan Workflow
      const { data: workflowSteps } = await api.from('approval_workflow')
        .select('*')
        .eq('module', 'Equipment Loan')
        .order('step_order', { ascending: true });

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          let text = event.target?.result as string;
          if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);

          const rows = text.split(/\r?\n/).filter(row => row.trim() !== '');
          if (rows.length < 2) {
            alert('Error: No data rows found.');
            setIsLoading(false);
            return;
          }

          const firstRow = rows[0];
          const tabCount = (firstRow.match(/\t/g) || []).length;
          const commaCount = (firstRow.match(/,/g) || []).length;
          const semiCount = (firstRow.match(/;/g) || []).length;
          let delimiter = ',';
          if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';
          else if (semiCount > commaCount && semiCount > tabCount) delimiter = ';';

          const rawHeaders = firstRow.split(delimiter).map(h => h.trim().replace(/^"|"$/g, '').replace(/[^\x20-\x7E]/g, ''));
          const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/^_+|_+$/g, ''));
          
          const dataRows = rows.slice(1);
          
          // Helper to convert MM/DD/YYYY to YYYY-MM-DD (Clean date only)
          const formatCSVDate = (dateStr: string) => {
            if (!dateStr || !dateStr.includes('/')) return '2024-01-01';
            // Extract only the date part before space or T
            const cleanDatePart = dateStr.split(' ')[0].split('T')[0];
            const parts = cleanDatePart.split('/');
            if (parts.length !== 3) return '2024-01-01';
            // CSV is MM/DD/YYYY
            const [m, d, y] = parts;
            return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
          };

          // 1. Group records by Vendor + Start Date + Project (to create single Loans)
          const groups: Record<string, any[]> = {};
          for (const row of dataRows) {
            const cols = row.split(delimiter).map(c => c.trim().replace(/^"|"$/g, ''));
            if (cols.length < 3) continue;

            const record: any = {};
            headers.forEach((h, idx) => { record[h] = cols[idx] || ''; });
            
            const groupKey = `${record.vendor_list}_${record.start_date}_${record.code_project}`.toLowerCase().replace(/\s+/g, '');
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(record);
          }

          const loanChunks = [];
          const releaseChunks = [];
          const deploymentChunks = [];
          const equipmentUpdates = [];
          
          // Sequential counter per Month
          const monthCounters: Record<string, number> = {};

          for (const key in groups) {
            const groupRecords = groups[key];
            const first = groupRecords[0];
            const loanId = first.unique_id || generateHexId();

            // Match project reference
            const csvProjCode = (first.code_project || '').toLowerCase();
            const matchedProjectId = projectMap.get(csvProjCode) || first.code_project || '';

            // Generate Standardized Request ID: REQ/MM/SEQ/YWTS
            const rawCreateDate = first.create_date || first.start_date || '01/01/2024';
            const isoCreateDate = formatCSVDate(rawCreateDate);
            const createDate = new Date(isoCreateDate);
            const month = (createDate.getMonth() + 1).toString().padStart(2, '0');
            const yearMonth = `${createDate.getFullYear()}-${month}`;
            
            monthCounters[yearMonth] = (monthCounters[yearMonth] || 0) + 1;
            const seq = monthCounters[yearMonth].toString().padStart(3, '0');
            const formattedRequestId = `REQ/${month}/${seq}/YWTS`;

            // Aggregate items for Loan Header
            const itemSummary: Record<string, number> = {};
            groupRecords.forEach(rec => {
              const type = rec.item || 'Unknown';
              itemSummary[type] = (itemSummary[type] || 0) + 1;
              
              // NEW: Create Deployment Record for EACH unit
              const depRecord = {
                unique_id: rec.unique_id || generateHexId(),
                create_date: isoCreateDate, // Added to match DB schema
                create_by: 'Legacy Import',
                last_updated: isoCreateDate, 
                request_id: formattedRequestId,
                year: createDate.getFullYear(),
                month: createDate.getMonth() + 1,
                item: rec.item || 'Unknown',
                product_id: rec.product_id, 
                product_name: rec.item || '',
                code_project: matchedProjectId,
                project_name: matchedProjectId,
                shipname: first.project_name || first.shipname || 'Unknown',
                vendor_list: first.vendor_list || first.vendor || 'Unknown',
                vendor: first.vendor || first.vendor_list || 'Unknown',
                start_date: formatCSVDate(first.start_date),
                finish_date: formatCSVDate(first.finish_date),
                duration: parseInt(first.duration) || 1,
                duration_hour: parseFloat(first.duration_hour) || 0,
                return_date: '',
                return_status: 'Deployed',
                description: first.description || 'Legacy Imported Deployment'
              };
              deploymentChunks.push(depRecord);
            });

            // Create Loan Header
            const loanData = {
              id: loanId,
              request_id: formattedRequestId,
              project_id: matchedProjectId, 
              shipname: first.project_name || first.shipname || 'Unknown', // Swapped: using project_name for ship field
              vendor: first.vendor_list || first.vendor || 'Unknown',
              work_order: first.shipname || '', // Swapped: using shipname for WO field
              date_start: formatCSVDate(first.start_date),
              date_finish: formatCSVDate(first.finish_date),
              duration: parseInt(first.duration) || 1,
              status: 'Released',
              items: Object.entries(itemSummary).map(([type, qty]) => ({
                id: generateHexId(),
                type: type,
                quantity: qty
              })),
              approval_steps: [
                { status: 'Approved', label: 'Request Created (Legacy)', date: isoCreateDate, user: 'Legacy System', isCompleted: true, isCurrent: false },
                ...(workflowSteps || []).map(w => ({
                  status: 'Approved',
                  label: w.label,
                  jabatan: w.jabatan,
                  user_id: w.user_id,
                  date: isoCreateDate,
                  user: 'Legacy Admin',
                  comment: 'Auto-approved legacy data',
                  isCompleted: true,
                  isCurrent: false
                }))
              ],
              date_created: isoCreateDate
            };
            loanChunks.push(loanData);

          // Create Release Record linked to Loan
          const releaseData = {
            id: generateHexId(),
            loan_id: loanId,
            release_no: `REL/LEGACY/${loanId}`,
            date_released: formatCSVDate(first.start_date),
            date_finish: formatCSVDate(first.finish_date),
            released_by: 'Legacy Import',
            received_by: first.vendor || first.vendor_list || 'Unknown',
            items_released: JSON.stringify(groupRecords.map(rec => ({
              item_id: generateHexId(),
              equipment_id: rec.product_id,
              condition: 'Good'
            }))),
            status: 'Deployed',
            notes: first.description || 'Imported Integrated Data (Loan + Release)'
          };
          releaseChunks.push(releaseData);

          // Prepare Equipment Status Updates
          groupRecords.forEach(rec => {
            if (rec.product_id) equipmentUpdates.push(rec.product_id);
          });
        }

        // BATCH INSERTS
        const chunkSize = 100;
        
        console.log(`Starting Batch Insert: ${loanChunks.length} loans, ${releaseChunks.length} releases, ${deploymentChunks.length} deployments`);

        // Save Loans
        for (let i = 0; i < loanChunks.length; i += chunkSize) {
          const chunk = loanChunks.slice(i, i + chunkSize).map(l => ({
            ...l,
            items: JSON.stringify(l.items),
            approval_steps: JSON.stringify(l.approval_steps)
          }));
          const { error } = await api.from('loan_requests').insert(chunk);
          if (error) {
            console.error('Error inserting loans:', error);
            throw new Error(`Failed to save Loan Requests: ${error.message}`);
          }
        }

        // Save Deployment Records (FOR RETURN MENU)
        for (let i = 0; i < deploymentChunks.length; i += chunkSize) {
          const chunk = deploymentChunks.slice(i, i + chunkSize);
          const { error } = await api.from('deployment_records').insert(chunk);
          if (error) {
            console.error('Error inserting deployments:', error, chunk[0]);
            alert(`❌ Error saving Deployment Records: ${error.message}\n\nSample Data: ${JSON.stringify(chunk[0])}`);
            throw new Error(`Failed to save Deployment Records: ${error.message}`);
          }
        }

        // Save Releases
        for (let i = 0; i < releaseChunks.length; i += chunkSize) {
          const chunk = releaseChunks.slice(i, i + chunkSize);
          const { error } = await api.from('equipment_release').insert(chunk);
          if (error) {
            console.error('Error inserting releases:', error, chunk[0]);
            alert(`❌ Error saving Equipment Releases: ${error.message}\n\nSample Data: ${JSON.stringify(chunk[0])}`);
            throw new Error(`Failed to save Equipment Releases: ${error.message}`);
          }
        }

        // Update Equipment Status
        for (const hull of equipmentUpdates) {
          const { error } = await api.from('equipment').update({ available: 'No' }).eq('id', hull);
          if (error) console.warn(`Could not update status for equipment ${hull}:`, error.message);
        }

        alert(`✅ Integrated Import Success!\n\n- Created ${loanChunks.length} Loan Headers\n- Created ${releaseChunks.length} Release Records\n- Created ${deploymentChunks.length} Deployment Items (Visible in Return Menu)\n- Updated ${equipmentUpdates.length} Equipment statuses`);
        setActiveTab('history');
        await fetchData();
      } catch (err: any) {
        alert('Import Error: ' + err.message);
      } finally {
        setIsLoading(false);
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  } catch (err: any) {
    alert('System Error: ' + err.message);
    setIsLoading(false);
  }
};

  const openReleaseModal = (loan: LoanRequest) => {
    setSelectedLoan(loan);
    setReleaseForm({
      received_by: loan.vendor,
      notes: '',
      items: loan.items.map(item => ({
        item_id: item.id!,
        type: item.type,
        equipment_id: '',
        condition: 'Good'
      }))
    });
    setIsModalOpen(true);
  };

  const addReleaseUnit = (item: any) => {
    const currentCount = releaseForm.items.filter(i => i.item_id === item.id).length;
    if (currentCount < item.quantity) {
      setReleaseForm({
        ...releaseForm,
        items: [
          ...releaseForm.items,
          {
            item_id: item.id!,
            type: item.type,
            equipment_id: '',
            condition: 'Good'
          }
        ]
      });
    }
  };

  const removeReleaseUnit = (idx: number) => {
    const newItems = [...releaseForm.items];
    newItems.splice(idx, 1);
    setReleaseForm({ ...releaseForm, items: newItems });
  };

  const getItemsList = (items: any) => {
    try {
      if (Array.isArray(items)) return items;
      if (typeof items === 'string') return JSON.parse(items);
      return [];
    } catch (e) {
      return [];
    }
  };

  const getFulfilledQuantity = (loanId: string, itemId: string) => {
    const loanReleases = (releases || []).filter(r => r.loan_id === loanId);
    let total = 0;
    loanReleases.forEach(r => {
      const items = getItemsList(r.items_released);
      items.forEach((i: any) => {
        if (i.item_id === itemId) total++;
      });
    });
    return total;
  };

  const isLoanFullyReleased = (loan: LoanRequest) => {
    return loan.items.every(item => getFulfilledQuantity(loan.id, item.id) >= item.quantity);
  };

  const handleRelease = async () => {
    if (!selectedLoan) return;
    setIsLoading(true);

    try {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      
      const monthReleasesCount = (releases || []).filter(r => {
        const d = new Date(r.date_released);
        return d.getFullYear() === currentYear && (d.getMonth() + 1) === currentMonth;
      }).length;
      
      const relNo = `ERL/${currentYear}/${String(currentMonth).padStart(2, '0')}/${String(monthReleasesCount + 1).padStart(3, '0')}/YWTS`;

      const releaseData = {
        id: generateHexId(),
        loan_id: selectedLoan.id,
        release_no: relNo,
        date_released: now.toISOString(),
        released_by: currentUser?.name || 'Admin',
        received_by: releaseForm.received_by,
        items_released: JSON.stringify(releaseForm.items.filter(i => i.equipment_id)),
        status: 'Deployed',
        notes: releaseForm.notes
      };

      // 1. Insert Release History
      const { error: relError } = await api.from('equipment_release').insert([releaseData]);
      if (relError) throw relError;

      // 2. Check if this release completes the loan
      const tempReleases = [...(releases || []), releaseData];
      const checkFulfilled = (itemId: string) => {
        let total = 0;
        tempReleases.filter(r => r.loan_id === selectedLoan.id).forEach(r => {
          getItemsList(r.items_released).forEach((i: any) => {
            if (i.item_id === itemId) total++;
          });
        });
        return total;
      };

      const isComplete = selectedLoan.items.every(item => checkFulfilled(item.id) >= item.quantity);
      
      // Update Loan Status: Mark as Released only when ALL items are deployed
      await api.from('loan_requests').update({ 
        status: isComplete ? 'Released' : 'Approved' 
      }).eq('id', selectedLoan.id);

      // 3. Process Each Item: Update Equipment & Insert Deployment Records
      for (const item of releaseForm.items) {
        if (item.equipment_id) {
          const asset = assets.find(a => a.id === item.equipment_id);
          await api.from('equipment').update({ available: 'No' }).eq('id', item.equipment_id);
          
          const depRecord = {
            unique_id: generateHexId(),
            create_date: now.toISOString().split('T')[0],
            create_by: currentUser?.name || 'Admin',
            last_updated: now.toISOString().split('T')[0],
            request_id: selectedLoan.request_id,
            year: currentYear,
            month: currentMonth,
            item: (item as any).type || 'Equipment', 
            product_id: item.equipment_id,
            product_name: item.alias || asset?.name || item.equipment_id,
            code_project: selectedLoan.project_id,
            project_name: selectedLoan.shipname,
            shipname: selectedLoan.shipname,
            vendor: selectedLoan.vendor,
            start_date: selectedLoan.date_start,
            finish_date: selectedLoan.date_finish,
            duration: selectedLoan.duration,
            return_status: 'Deployed',
            description: releaseForm.notes
          };
          
          await api.from('deployment_records').insert([depRecord]);
        }
      }

      setIsModalOpen(false);
      await fetchData();
    } catch (err) {
      console.error('Release error:', err);
      alert('Failed to process release');
    } finally {
      setIsLoading(false);
    }
  };

  const approvedLoans = loans.filter(l => 
    (l.status === 'Approved' || l.status === 'Released') && !isLoanFullyReleased(l)
  );

  const filteredLoans = approvedLoans.filter(l => 
    l.shipname.toLowerCase().includes(searchTerm.toLowerCase()) ||
    l.vendor.toLowerCase().includes(searchTerm.toLowerCase()) ||
    l.id.includes(searchTerm)
  );

  const [selectedHistory, setSelectedHistory] = useState<ReleaseRecord | null>(null);

  const filteredHistory = (releases || []).filter(r => 
    r.release_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.received_by.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (r.loan_id || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination Logic for History
  const totalHistory = filteredHistory.length;
  const historyItemsPerPage = itemsPerPage === 'all' ? totalHistory : (itemsPerPage as number);
  const totalPagesHistory = Math.ceil(totalHistory / (historyItemsPerPage || 1));
  const startIdxHistory = (currentPageHistory - 1) * historyItemsPerPage;
  const paginatedHistory = itemsPerPage === 'all' 
    ? filteredHistory 
    : filteredHistory.slice(startIdxHistory, startIdxHistory + historyItemsPerPage);

  // Pagination Logic for Pending
  const totalPending = filteredLoans.length;
  const pendingItemsPerPage = itemsPerPage === 'all' ? totalPending : (itemsPerPage as number);
  const totalPagesPending = Math.ceil(totalPending / (pendingItemsPerPage || 1));
  const startIdxPending = (currentPagePending - 1) * pendingItemsPerPage;
  const paginatedPending = itemsPerPage === 'all' 
    ? filteredLoans 
    : filteredLoans.slice(startIdxPending, startIdxPending + pendingItemsPerPage);

  // Reset page when searching
  React.useEffect(() => {
    setCurrentPagePending(1);
    setCurrentPageHistory(1);
  }, [searchTerm]);


  return (
    <div className="p-8 space-y-8 min-h-screen bg-slate-50/50">
      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h2 className="font-display font-bold text-3xl text-slate-800 tracking-tight">Equipment Release</h2>
          <p className="text-sm text-slate-500 mt-1">Manage physical deployment and track release history.</p>
        </div>
        <div className="flex items-center gap-3">
          {canAccess('Release', 'delete') && (
            <button 
              onClick={handleDeleteAll}
              className="flex items-center justify-center gap-2 px-6 py-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm font-bold hover:bg-red-100 transition-all shadow-sm"
            >
              <Trash2 className="w-4 h-4" /> Delete All
            </button>
          )}
          {canAccess('Release', 'import') && (
            <label className="flex items-center justify-center gap-2 px-6 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all cursor-pointer shadow-sm">
              <Download className="w-4 h-4 text-[#FDB913]" /> Import Legacy
              <input type="file" className="hidden" accept=".csv,.txt" onChange={handleLegacyImport} />
            </label>
          )}
          <div className="relative w-full lg:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search data..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 shadow-sm"
            />
          </div>
        </div>
      </header>

      {/* Tabs Navigation */}
      <div className="flex border-b border-slate-200">
        <button 
          onClick={() => setActiveTab('pending')}
          className={`px-8 py-4 text-sm font-bold transition-all relative ${
            activeTab === 'pending' ? 'text-[#e5a611]' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Pending Release ({approvedLoans.length})
          </div>
          {activeTab === 'pending' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#FDB913]" />}
        </button>
        <button 
          onClick={() => setActiveTab('history')}
          className={`px-8 py-4 text-sm font-bold transition-all relative ${
            activeTab === 'history' ? 'text-[#e5a611]' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <div className="flex items-center gap-2">
            <History className="w-4 h-4" />
            Release History ({releases?.length || 0})
          </div>
          {activeTab === 'history' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#FDB913]" />}
        </button>
      </div>

      <div className="space-y-6">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          {activeTab === 'pending' ? (
            /* Pending Release Table */
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="px-6 py-4 w-12 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">No</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ship / Project</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vendor</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Items Requested</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedPending.map((loan, idx) => (
                      <tr key={loan.id} className="hover:bg-slate-50/80 transition-colors group">
                        <td className="px-6 py-4 text-center">
                          <span className="text-xs font-bold text-slate-400">{startIdxPending + idx + 1}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-800">{loan.shipname}</span>
                            <span className="text-[10px] text-slate-400 font-mono">REQ ID: {loan.id}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-semibold text-slate-700">{loan.vendor}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-2">
                            {loan.items.map((item, i) => (
                              <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-bold border border-blue-100">
                                {item.type} x{item.quantity}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center">
                            <button 
                              onClick={() => openReleaseModal(loan)}
                              className="flex items-center gap-2 px-4 py-2 bg-[#FDB913] text-slate-900 rounded-xl text-xs font-bold hover:bg-[#e5a611] transition-all shadow-sm"
                            >
                              Release <ArrowRight className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredLoans.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-20 text-center">
                          <p className="text-slate-400 text-sm">No pending release requests found.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              
              {/* Pagination Footer for Pending */}
              <div className="p-4 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  Showing <span className="font-bold text-slate-700">{paginatedPending.length}</span> of <span className="font-bold text-slate-700">{totalPending}</span> entries
                </p>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setCurrentPagePending(prev => Math.max(1, prev - 1))}
                    disabled={currentPagePending === 1}
                    className="p-1.5 border border-slate-200 rounded-lg text-slate-400 hover:text-[#FDB913] hover:border-[#FDB913]/30 disabled:opacity-50 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-2 px-3">
                    <span className="text-xs font-bold text-slate-600">
                      {currentPagePending} <span className="text-slate-400 font-medium mx-1">/</span> {totalPagesPending || 1}
                    </span>
                  </div>
                  <button 
                    onClick={() => setCurrentPagePending(prev => Math.min(totalPagesPending, prev + 1))}
                    disabled={currentPagePending === totalPagesPending || totalPagesPending === 0}
                    className="p-1.5 border border-slate-200 rounded-lg text-slate-400 hover:text-[#FDB913] hover:border-[#FDB913]/30 disabled:opacity-50 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Release History Table */
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="px-6 py-4 w-12 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">No</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Release No</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vendor / Receiver</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Items Deployed</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedHistory.map((release, idx) => (
                      <tr 
                        key={release.id} 
                        onClick={() => setSelectedHistory(release)}
                        className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                      >
                        <td className="px-6 py-4 text-center">
                          <span className="text-xs font-bold text-slate-400">{startIdxHistory + idx + 1}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-800">{release.release_no}</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              LOAN REF: {loans.find(l => l.id === release.loan_id)?.request_id || release.loan_id}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-slate-600">
                            <Calendar className="w-3.5 h-3.5" />
                            <span className="text-sm">{new Date(release.date_released).toLocaleDateString()}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-slate-700">{release.received_by}</span>
                            <span className="text-[10px] text-slate-400">Released by: {release.released_by}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-2">
                            {getItemsList(release.items_released).slice(0, 3).map((item: any, i: number) => (
                              <span key={i} className="px-2 py-1 bg-[#FDB913]/10 text-[#e5a611] rounded-md text-[10px] font-bold border border-[#FDB913]/20">
                                {item.alias || item.equipment_id}
                              </span>
                            ))}
                            {getItemsList(release.items_released).length > 3 && (
                              <span className="text-[10px] text-slate-400 font-bold self-center">
                                +{getItemsList(release.items_released).length - 3} more
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center gap-2">
                            <button 
                              onClick={(e) => { e.stopPropagation(); setSelectedHistory(release); }}
                              className="p-2 text-slate-400 hover:text-[#e5a611] hover:bg-[#FDB913]/10 rounded-lg transition-all"
                            >
                              <FileText className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredHistory.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-20 text-center">
                          <p className="text-slate-400 text-sm">No release history found.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Footer for History */}
              <div className="p-4 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  Showing <span className="font-bold text-slate-700">{paginatedHistory.length}</span> of <span className="font-bold text-slate-700">{totalHistory}</span> entries
                </p>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setCurrentPageHistory(prev => Math.max(1, prev - 1))}
                    disabled={currentPageHistory === 1}
                    className="p-1.5 border border-slate-200 rounded-lg text-slate-400 hover:text-[#FDB913] hover:border-[#FDB913]/30 disabled:opacity-50 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-2 px-3">
                    <span className="text-xs font-bold text-slate-600">
                      {currentPageHistory} <span className="text-slate-400 font-medium mx-1">/</span> {totalPagesHistory || 1}
                    </span>
                  </div>
                  <button 
                    onClick={() => setCurrentPageHistory(prev => Math.min(totalPagesHistory, prev + 1))}
                    disabled={currentPageHistory === totalPagesHistory || totalPagesHistory === 0}
                    className="p-1.5 border border-slate-200 rounded-lg text-slate-400 hover:text-[#FDB913] hover:border-[#FDB913]/30 disabled:opacity-50 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && selectedLoan && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-[40px] w-full max-w-3xl overflow-hidden shadow-2xl border border-slate-200"
            >
              {/* Header */}
              <div className="p-8 border-b border-slate-100">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center text-[#FDB913]">
                      <ShieldCheck className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-800">Process Release</h3>
                      <p className="text-sm text-slate-500">Assign physical equipment units for deployment</p>
                    </div>
                  </div>
                  <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-50 rounded-xl transition-colors">
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>
              </div>

              <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
                {/* Deployment Metadata */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">WORK ORDER / PROJECT</p>
                    <div className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-700">
                      {selectedLoan.work_order || 'N/A'} - {selectedLoan.shipname}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">VENDOR</p>
                    <div className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold text-slate-700">
                      {selectedLoan.vendor}
                    </div>
                  </div>
                </div>

                {/* Duration Banner Style */}
                <div className="bg-slate-900 rounded-3xl p-5 flex items-center gap-4 text-white shadow-lg">
                  <div className="w-10 h-10 bg-[#FDB913]/20 rounded-xl flex items-center justify-center text-[#FDB913]">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Loan Duration</p>
                    <p className="text-lg font-bold">{selectedLoan.duration} Days</p>
                  </div>
                </div>

                {/* Receiver & Notes */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">RECEIVED BY (PERSON NAME)</p>
                    <input 
                      type="text"
                      value={releaseForm.received_by}
                      onChange={(e) => setReleaseForm({ ...releaseForm, received_by: e.target.value })}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 transition-all"
                      placeholder="Enter receiver name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">INTERNAL NOTES</p>
                    <input 
                      type="text"
                      value={releaseForm.notes}
                      onChange={(e) => setReleaseForm({ ...releaseForm, notes: e.target.value })}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 transition-all"
                      placeholder="Optional notes"
                    />
                  </div>
                </div>

                {/* Assignment Cards */}
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <div className="flex justify-between items-center">
                    <h4 className="font-bold text-slate-800">Deployment Items</h4>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Assign physical units</span>
                  </div>

                  {selectedLoan.items.map((item, idx) => {
                    const previouslyFulfilled = getFulfilledQuantity(selectedLoan.id, item.id);
                    const assignedInThisSession = releaseForm.items
                      .map((u, i) => ({ ...u, originalIdx: i }))
                      .filter(u => u.item_id === item.id);
                    const totalProcessed = previouslyFulfilled + assignedInThisSession.length;
                    const isFullyMet = totalProcessed >= item.quantity;
                    const remainingNeeded = item.quantity - previouslyFulfilled;

                    return (
                      <div key={idx} className="bg-slate-50 p-6 rounded-3xl border border-slate-200 space-y-4">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-slate-700">{item.type}</span>
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-600 text-[10px] font-black rounded-md">
                              QTY: {item.quantity}
                            </span>
                            {previouslyFulfilled > 0 && (
                              <span className="px-2 py-0.5 bg-green-100 text-green-600 text-[10px] font-black rounded-md">
                                {previouslyFulfilled} RELEASED
                              </span>
                            )}
                          </div>
                          {!isFullyMet && (
                            <button 
                              onClick={() => addReleaseUnit(item)}
                              className="text-xs font-bold text-[#FDB913] hover:text-[#e5a611] flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" /> Add Unit
                            </button>
                          )}
                        </div>

                        <div className="space-y-3">
                          {assignedInThisSession.map((unit, uIdx) => (
                            <div key={uIdx} className="flex gap-3">
                              <select 
                                className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                                value={unit.equipment_id}
                                onChange={(e) => {
                                  const assetId = e.target.value;
                                  const asset = assets.find(a => a.id === assetId);
                                  const newItems = [...releaseForm.items];
                                  newItems[unit.originalIdx] = { 
                                    ...newItems[unit.originalIdx], 
                                    equipment_id: assetId,
                                    alias: asset?.alias || asset?.name || ''
                                  };
                                  setReleaseForm({ ...releaseForm, items: newItems });
                                }}
                              >
                                <option value="">Select Physical Asset</option>
                                {assets
                                  .filter(a => 
                                    a.type === item.type && 
                                    (a.available === 'Yes' || a.id === unit.equipment_id) &&
                                    !releaseForm.items.some(other => other.equipment_id === a.id && other !== releaseForm.items[unit.originalIdx])
                                  )
                                  .map(a => (
                                    <option key={a.id} value={a.id}>{a.alias || a.name} [{a.no_asset}]</option>
                                  ))
                                }
                              </select>
                              <button 
                                onClick={() => removeReleaseUnit(unit.originalIdx)}
                                className="p-2.5 text-slate-400 hover:text-red-500 hover:bg-white rounded-xl border border-transparent hover:border-red-100 transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                          {assignedInThisSession.length === 0 && !isFullyMet && (
                            <div className="py-4 border-2 border-dashed border-slate-200 rounded-2xl flex items-center justify-center">
                              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest italic">No units assigned yet</p>
                            </div>
                          )}
                          {isFullyMet && assignedInThisSession.length === 0 && (
                            <div className="py-4 bg-green-50 border border-green-100 rounded-2xl flex items-center justify-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                              <p className="text-[10px] text-green-600 font-bold uppercase tracking-widest">Fully Fulfilled</p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer */}
              <div className="p-8 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="px-8 py-3 bg-white border border-slate-200 text-slate-600 rounded-2xl text-sm font-bold hover:bg-slate-100 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleRelease}
                  disabled={isLoading || releaseForm.items.length === 0 || releaseForm.items.some(i => !i.equipment_id)}
                  className="px-10 py-3 bg-[#FDB913] text-slate-900 rounded-2xl text-sm font-black hover:bg-[#e5a611] transition-all disabled:opacity-50 shadow-lg shadow-[#FDB913]/20"
                >
                  {isLoading ? 'Processing...' : 'Confirm Release'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* History Detail Modal */}
      <AnimatePresence>
        {selectedHistory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-[40px] w-full max-w-2xl overflow-hidden shadow-2xl border border-slate-200"
            >
              <div className="p-8 border-b border-slate-100 bg-slate-50/50">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-0.5 bg-[#FDB913]/10 text-[#e5a611] text-[10px] font-bold rounded-md uppercase tracking-wider">Release Documentation</span>
                    </div>
                    <h3 className="text-2xl font-display font-bold text-slate-800">{selectedHistory.release_no}</h3>
                    <p className="text-sm text-slate-500 mt-1">Full audit trail for this equipment deployment.</p>
                  </div>
                  <button 
                    onClick={() => setSelectedHistory(null)} 
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white rounded-xl transition-all flex items-center gap-2 text-xs font-bold"
                  >
                    <X className="w-5 h-5" /> Exit
                  </button>
                </div>
              </div>

              <div className="p-8 space-y-8 max-h-[60vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date Released</p>
                    <div className="flex items-center gap-2 text-slate-700 font-semibold">
                      <Calendar className="w-4 h-4 text-[#FDB913]" />
                      {new Date(selectedHistory.date_released).toLocaleDateString(undefined, { dateStyle: 'long' })}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Releasing Officer</p>
                    <div className="flex items-center gap-2 text-slate-700 font-semibold">
                      <ShieldCheck className="w-4 h-4 text-blue-500" />
                      {selectedHistory.released_by}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Receiver / Vendor</p>
                    <div className="flex items-center gap-2 text-slate-700 font-semibold">
                      <User className="w-4 h-4 text-slate-400" />
                      {selectedHistory.received_by}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Loan reference</p>
                    <div className="font-mono text-xs text-[#e5a611] font-bold truncate">
                      {loans.find(l => l.id === selectedHistory.loan_id)?.request_id || selectedHistory.loan_id}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                    <Package className="w-4 h-4 text-[#FDB913]" /> Items Deployed
                  </h4>
                  <div className="bg-slate-50 rounded-3xl border border-slate-100 overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-slate-100/50 border-b border-slate-200/50">
                        <tr>
                          <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Asset Name / Alias</th>
                          <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Condition</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/50">
                        {getItemsList(selectedHistory.items_released).map((item: any, idx: number) => (
                          <tr key={idx} className="text-sm">
                            <td className="px-6 py-4">
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-700">{item.alias || item.equipment_id}</span>
                                <span className="text-[10px] text-slate-400 font-mono">{item.equipment_id}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className="px-2 py-1 bg-green-50 text-green-600 text-[10px] font-bold rounded-lg border border-green-100">
                                {item.condition || 'Good'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {selectedHistory.notes && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Notes</p>
                    <div className="p-5 bg-blue-50/50 rounded-3xl border border-blue-100 text-sm text-slate-600 italic leading-relaxed">
                      "{selectedHistory.notes}"
                    </div>
                  </div>
                )}
              </div>

              <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
                <button 
                  onClick={() => setSelectedHistory(null)}
                  className="w-full px-8 py-4 bg-white border border-slate-200 text-slate-600 rounded-2xl text-sm font-bold hover:bg-slate-50 transition-all shadow-sm"
                >
                  Close Detail
                </button>
                <button 
                  className="w-full px-8 py-4 bg-[#FDB913] text-slate-900 rounded-2xl text-sm font-bold hover:bg-[#e5a611] transition-all shadow-lg shadow-[#FDB913]/20 flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" /> Export Document
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
