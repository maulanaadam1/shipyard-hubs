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
  X
} from 'lucide-react';
import { useData, LoanRequest, Equipment, ReleaseRecord, ReleaseItem } from '@/context/DataContext';
import { api } from '@/lib/api-client';
import { motion, AnimatePresence } from 'framer-motion';

export default function EquipmentRelease() {
  const { fleet: assets, loans, fetchData, currentUser, releases, projects: allProjects } = useData();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<LoanRequest | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('history');
  const [currentPage, setCurrentPage] = useState(1);
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

  const handleRelease = async () => {
    if (!selectedLoan) return;
    setIsLoading(true);

    try {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      
      // Calculate ERL Sequence
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
        items_released: JSON.stringify(releaseForm.items),
        status: 'Deployed',
        notes: releaseForm.notes
      };

      // 1. Insert Release History
      const { error: relError } = await api.from('equipment_release').insert([releaseData]);
      if (relError) throw relError;

      // 2. Update Loan Status
      await api.from('loan_requests').update({ status: 'Released' }).eq('id', selectedLoan.id);

      // 3. Process Each Item: Update Equipment & Insert Deployment Records
      for (const item of releaseForm.items) {
        if (item.equipment_id) {
          const asset = assets.find(a => a.id === item.equipment_id);
          
          // Update Equipment Status to 'No' using Hex ID
          await api.from('equipment').update({ available: 'No' }).eq('id', item.equipment_id);
          
          // Insert into deployment_records for Return module
          const depRecord = {
            unique_id: generateHexId(),
            create_date: now.toISOString().split('T')[0],
            create_by: currentUser?.name || 'Admin',
            last_updated: now.toISOString().split('T')[0],
            request_id: selectedLoan.request_id,
            year: currentYear,
            month: currentMonth,
            item: (item as any).type || 'Equipment', 
            product_id: item.equipment_id, // This is now the Hex UUID
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

  const approvedLoans = loans.filter(l => l.status === 'Approved');
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

  // Pagination Logic
  const totalItems = filteredHistory.length;
  const effectiveItemsPerPage = itemsPerPage === 'all' ? totalItems : itemsPerPage;
  const totalPages = Math.ceil(totalItems / (effectiveItemsPerPage || 1));
  const startIndex = (currentPage - 1) * (effectiveItemsPerPage as number);
  const paginatedHistory = itemsPerPage === 'all' 
    ? filteredHistory 
    : filteredHistory.slice(startIndex, startIndex + (effectiveItemsPerPage as number));

  // Reset page when searching
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const getItemsList = (items: any) => {
    try {
      if (Array.isArray(items)) return items;
      if (typeof items === 'string') return JSON.parse(items);
      return [];
    } catch (e) {
      return [];
    }
  };

  return (
    <div className="p-8 space-y-8 min-h-screen bg-slate-50/50">
      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h2 className="font-display font-bold text-3xl text-slate-800 tracking-tight">Equipment Release</h2>
          <p className="text-sm text-slate-500 mt-1">Manage physical deployment and track release history.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleDeleteAll}
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm font-bold hover:bg-red-100 transition-all shadow-sm"
          >
            <Trash2 className="w-4 h-4" /> Delete All
          </button>
          <label className="flex items-center justify-center gap-2 px-6 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all cursor-pointer shadow-sm">
            <Download className="w-4 h-4 text-[#FDB913]" /> Import Legacy
            <input type="file" className="hidden" accept=".csv,.txt" onChange={handleLegacyImport} />
          </label>
          <div className="relative w-full lg:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search release history..." 
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
        {activeTab === 'pending' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <AnimatePresence>
              {filteredLoans.map((loan) => (
                <motion.div 
                  key={loan.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-all group"
                >
                  <div className="p-6 border-b border-slate-100 flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Request ID</span>
                        <span className="text-xs font-mono font-bold text-[#e5a611] bg-[#FDB913]/10 px-2 py-0.5 rounded-md">
                          {loan.id}
                        </span>
                      </div>
                      <h3 className="font-bold text-slate-800 text-lg">{loan.shipname}</h3>
                    </div>
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                      <Package className="w-5 h-5" />
                    </div>
                  </div>
                  
                  <div className="p-6 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-slate-400" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vendor</p>
                        <p className="text-sm font-semibold text-slate-700">{loan.vendor}</p>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Requested Items</p>
                      {loan.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center text-sm">
                          <span className="text-slate-600">{item.type}</span>
                          <span className="font-bold text-slate-800">x{item.quantity}</span>
                        </div>
                      ))}
                    </div>

                    <button 
                      onClick={() => openReleaseModal(loan)}
                      className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#FDB913] text-slate-900 rounded-2xl text-sm font-bold hover:bg-[#e5a611] transition-all"
                    >
                      Process Release <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ) : (
          /* Release History Table */
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Release No</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vendor / Receiver</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Items Deployed</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedHistory.map((release) => (
                    <tr 
                      key={release.id} 
                      onClick={() => setSelectedHistory(release)}
                      className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                    >
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
                          {getItemsList(release.items_released).slice(0, 3).map((item: any, idx: number) => (
                            <span key={idx} className="px-2 py-1 bg-[#FDB913]/10 text-[#e5a611] rounded-md text-[10px] font-bold border border-[#FDB913]/20">
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
                      <td colSpan={5} className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center">
                            <History className="w-6 h-6 text-slate-200" />
                          </div>
                          <p className="text-slate-400 text-sm">No release history found.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Show</span>
                    <select 
                      value={itemsPerPage}
                      onChange={(e) => {
                        const val = e.target.value;
                        setItemsPerPage(val === 'all' ? 'all' : parseInt(val));
                        setCurrentPage(1);
                      }}
                      className="bg-white border border-slate-200 text-slate-700 text-xs rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-[#FDB913]/20"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value="all">All</option>
                    </select>
                  </div>
                  <p className="text-xs text-slate-500">
                    Showing <span className="font-bold text-slate-700">{startIndex + 1}</span> to <span className="font-bold text-slate-700">{Math.min(startIndex + (effectiveItemsPerPage as number), totalItems)}</span> of <span className="font-bold text-slate-700">{totalItems}</span> results
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="p-2 bg-white border border-slate-200 rounded-xl text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-all shadow-sm"
                  >
                    <ChevronRight className="w-4 h-4 rotate-180" />
                  </button>
                  
                  <div className="flex items-center gap-1">
                    {[...Array(Math.min(5, totalPages))].map((_, i) => {
                      let pageNum = currentPage;
                      if (currentPage <= 3) pageNum = i + 1;
                      else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                      else pageNum = currentPage - 2 + i;

                      if (pageNum <= 0 || pageNum > totalPages) return null;

                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                            currentPage === pageNum 
                              ? 'bg-[#FDB913] text-slate-900 shadow-md' 
                              : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>

                  <button 
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="p-2 bg-white border border-slate-200 rounded-xl text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-all shadow-sm"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Release Modal */}
      <AnimatePresence>
        {isModalOpen && selectedLoan && (
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
                    <h3 className="text-2xl font-display font-bold text-slate-800">Process Release</h3>
                    <p className="text-sm text-slate-500 mt-1">Assign physical equipment units to the request.</p>
                  </div>
                  <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-white rounded-xl transition-colors">
                    <Trash2 className="w-5 h-5 text-slate-400" />
                  </button>
                </div>
              </div>

              <div className="p-8 space-y-6 max-h-[60vh] overflow-y-auto">
                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 flex gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                  <p className="text-xs text-amber-700 leading-relaxed">
                    Please ensure each requested item is matched with a physical unit (Hull/Serial Number) before confirming the release.
                  </p>
                </div>

                <div className="space-y-4">
                  {selectedLoan.items.map((item, idx) => (
                    <div key={idx} className="p-5 bg-slate-50 rounded-3xl border border-slate-200 space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-700">{item.type}</span>
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Qty: {item.quantity}</span>
                      </div>
                      <select 
                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                        onChange={(e) => {
                          const assetId = e.target.value; // This is a.id (Hex UUID)
                          const asset = assets.find(a => a.id === assetId);
                          const newItems = [...releaseForm.items];
                          newItems[idx] = { 
                            ...newItems[idx], 
                            equipment_id: assetId,
                            alias: asset?.alias || asset?.name || ''
                          };
                          setReleaseForm({ ...releaseForm, items: newItems });
                        }}
                      >
                        <option value="">-- Select Physical Unit --</option>
                        {assets
                          .filter(a => a.type === item.type && a.available === 'Yes')
                          .map(a => (
                            <option key={a.id} value={a.id}>{a.alias || a.name}</option>
                          ))
                        }
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-8 py-4 bg-white border border-slate-200 text-slate-600 rounded-2xl text-sm font-bold hover:bg-slate-50 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleRelease}
                  disabled={isLoading || releaseForm.items.some(i => !i.equipment_id)}
                  className="flex-1 px-8 py-4 bg-[#FDB913] text-slate-900 rounded-2xl text-sm font-bold hover:bg-[#e5a611] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#FDB913]/20"
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
