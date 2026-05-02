'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useSearchParams } from 'react-router-dom';
import { 
  Search, 
  Filter, 
  Plus, 
  X, 
  Eye, 
  Clock, 
  Calendar, 
  Ship, 
  FileText,
  CheckCircle2,
  AlertCircle,
  MoreHorizontal,
  Edit2,
  Check,
  Trash2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

import { useData, LoanRequest, RequestedItem } from '@/context/DataContext';
import { api } from '@/lib/api-client';

const statusColors: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-600 border-slate-200',
  Pending: 'bg-amber-100 text-amber-700 border-amber-200',
  Approved: 'bg-[#FDB913]/20 text-[#e5a611] border-[#FDB913]/30',
  Rejected: 'bg-red-100 text-red-700 border-red-200',
  Active: 'bg-blue-100 text-blue-700 border-blue-200',
  Completed: 'bg-slate-100 text-slate-700 border-slate-200',
  Deployed: 'bg-indigo-100 text-indigo-700 border-indigo-200',
};

const equipmentTypes = ['SMAW', 'FCAW', 'Blower', 'Angle Grinder', 'Forklift (3T)', 'Forklift (10T)', 'Gantry Crane'];

export default function EquipmentLoans() {
  const { loans, setLoans, vendors, ships, projects, workflows, currentUser, users, createNotification, notifications, markNotificationRead } = useData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);
  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
  const [loanToApprove, setLoanToApprove] = useState<string | null>(null);
  const [approvalComment, setApprovalComment] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLoan, setSelectedLoan] = useState<LoanRequest | null>(null);
  const [requestedItems, setRequestedItems] = useState<RequestedItem[]>([]);
  const [modalProjectId, setModalProjectId] = useState('');
  const [modalShipName, setModalShipName] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateFinish, setDateFinish] = useState('');
  
  // Paging & Bulk States
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(10);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Auto-open approval modal when navigated from notification (?approve=requestId)
  // Use a ref to prevent re-triggering on every polling cycle
  const handledApproveParam = React.useRef<string | null>(null);
  useEffect(() => {
    const approveRequestId = searchParams.get('approve');
    if (!approveRequestId || handledApproveParam.current === approveRequestId) return;
    if (loans.length === 0) return; // Wait for loans to load

    const target = loans.find(l => l.request_id === decodeURIComponent(approveRequestId));
    if (target) {
      handledApproveParam.current = approveRequestId;
      setSelectedLoan(target);
      setIsProgressModalOpen(true);
      // Clear the URL param to keep URL clean
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, loans]);

  const filteredLoans = loans.filter(loan => {
    const searchStr = searchTerm.toLowerCase();
    return (
      loan.request_id.toLowerCase().includes(searchStr) ||
      loan.shipname.toLowerCase().includes(searchStr) ||
      loan.project_id.toLowerCase().includes(searchStr) ||
      loan.work_order.toLowerCase().includes(searchStr) ||
      loan.vendor.toLowerCase().includes(searchStr) ||
      loan.status.toLowerCase().includes(searchStr) ||
      loan.items.some(item => item.type.toLowerCase().includes(searchStr))
    );
  });

  // Keep selectedLoan in sync with polling data without closing the modal
  useEffect(() => {
    if (selectedLoan && isProgressModalOpen) {
      const updated = loans.find(l => l.id === selectedLoan.id);
      if (updated) setSelectedLoan(updated);
    }
  }, [loans]);

  // Pagination Logic
  const totalItems = filteredLoans.length;
  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(totalItems / (itemsPerPage as number));
  const paginatedLoans = itemsPerPage === 'all' 
    ? filteredLoans 
    : filteredLoans.slice((currentPage - 1) * (itemsPerPage as number), currentPage * (itemsPerPage as number));

  // Reset page when search or items per page changes
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const handleItemsPerPageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setItemsPerPage(e.target.value === 'all' ? 'all' : parseInt(e.target.value));
    setCurrentPage(1);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedLoans.length && paginatedLoans.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedLoans.map(l => l.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`Are you sure you want to delete ${selectedIds.size} requests?`)) {
      const { error } = await api.from('loan_requests').delete().in('id', Array.from(selectedIds));
      if (error) {
        console.error('Error deleting loans from Supabase:', error.message);
        alert('Error deleting: ' + error.message);
      } else {
        setSelectedIds(new Set());
      }
    }
  };

  const handleBulkExport = () => {
    const dataToExport = loans.filter(l => selectedIds.has(l.id));
    console.log('Exporting:', dataToExport);
    alert(`Exporting ${dataToExport.length} items to Excel...`);
  };

  const generateHexId = () => {
    return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  };

  const handleAddItemType = () => {
    setRequestedItems([...requestedItems, { id: generateHexId(), type: equipmentTypes[0], quantity: 1 }]);
  };

  const handleRemoveItemType = (index: number) => {
    setRequestedItems(requestedItems.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof RequestedItem, value: string | number) => {
    const newItems = [...requestedItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setRequestedItems(newItems);
  };

  const openAddModal = () => {
    setSelectedLoan(null);
    setRequestedItems([{ id: generateHexId(), type: equipmentTypes[0], quantity: 1}]);
    setModalProjectId('');
    setModalShipName('');
    setDateStart('');
    setDateFinish('');
    setIsModalOpen(true);
  };

  const openEditModal = (loan: LoanRequest) => {
    setSelectedLoan(loan);
    setRequestedItems(loan.items || []);
    setModalProjectId(loan.project_id || '');
    setModalShipName(loan.shipname || '');
    setDateStart(loan.date_start || '');
    setDateFinish(loan.date_finish || '');
    setIsModalOpen(true);
  };

  const handleApprove = (id: string) => {
    setLoanToApprove(id);
    setApprovalComment('');
    setIsApproveModalOpen(true);
  };

  const confirmApprove = async () => {
    if (loanToApprove) {
      const loan = loans.find(l => l.id === loanToApprove);
      if (!loan) return;

      let isAllCompleted = true;
      const newSteps = loan.approval_steps.map((step, idx) => {
        if (step.isCurrent) {
          return { 
            ...step, 
            isCurrent: false, 
            isCompleted: true, 
            date: new Date().toLocaleString(), 
            comment: approvalComment, 
            user: currentUser?.name || 'Authorized User',
            status: 'Approved'
          };
        }
        return step;
      });

      // Find the next step to make current
      const currentIdx = loan.approval_steps.findIndex(s => s.isCurrent);
      if (currentIdx !== -1 && currentIdx < newSteps.length - 1) {
        newSteps[currentIdx + 1].isCurrent = true;
        newSteps[currentIdx + 1].status = 'Pending';
        isAllCompleted = false;
      }

      const finalStatus = isAllCompleted ? 'Approved' : 'Pending';

      const { error } = await api.from('loan_requests')
        .update({ 
          status: finalStatus, 
          approval_steps: newSteps 
        })
        .eq('id', loanToApprove);

      if (error) {
        console.error('Error approving loan in Supabase:', error.message);
        alert('Error approving: ' + error.message);
      } else {
        setIsApproveModalOpen(false);
        setLoanToApprove(null);

        // Auto-mark related approval notifications as read (clears badge count)
        const relatedNotifs = notifications.filter(n =>
          !n.is_read &&
          n.type === 'approval' &&
          n.message?.includes(loan.request_id)
        );
        for (const notif of relatedNotifs) {
          markNotificationRead(notif.id);
        }

        // Notify next approver if there is one
        const nextStep = newSteps.find(s => s.isCurrent);
        if (nextStep) {
          notifyApprover(loan.request_id, nextStep);
        }
      }
    }
  };

  const notifyApprover = async (requestId: string, step: any) => {
    console.group(`[notifyApprover] ${requestId} → Step "${step.label}" (order: ${step.step_order})`);
    console.log('Step data:', { jabatan: step.jabatan, user_id: step.user_id, user_ids: step.user_ids, step_order: step.step_order });

    let targetUserIds: string[] = [];

    // Priority 1: Parse user_ids JSON array (specific multi-approver)
    try {
      const parsed = JSON.parse(step.user_ids || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) {
        targetUserIds = parsed;
        console.log('✅ Source: user_ids array →', targetUserIds.map(id => users.find(u => u.id === id)?.name));
      }
    } catch { /* ignore parse error */ }

    // Priority 2: Single user_id
    if (targetUserIds.length === 0 && step.user_id) {
      targetUserIds = [step.user_id];
      console.log('✅ Source: single user_id →', users.find(u => u.id === step.user_id)?.name);
    }

    // Priority 3: Jabatan from step data (find all users with matching jabatan)
    if (targetUserIds.length === 0 && step.jabatan) {
      const searchJabatan = step.jabatan.trim().toLowerCase();
      const matched = users.filter(u => u.jabatan?.trim().toLowerCase() === searchJabatan);
      targetUserIds = matched.map(u => u.id);
      console.log(`✅ Source: jabatan "${step.jabatan}" → ${matched.map(u => u.name).join(', ') || 'none found'}`);
    }

    // Priority 4 (FINAL FALLBACK): Look up live workflow by step_order
    // Only used if step has NO jabatan/user info (e.g. old loan data)
    if (targetUserIds.length === 0) {
      console.warn('⚠️ Step missing routing info — using workflow fallback by step_order:', step.step_order);
      const matchedWorkflow = workflows.find(w =>
        w.module === 'Equipment Loan' && w.step_order === step.step_order
      );
      if (matchedWorkflow) {
        // Try user_ids from workflow
        try {
          const wIds = JSON.parse((matchedWorkflow as any).user_ids || '[]');
          if (Array.isArray(wIds) && wIds.length > 0) {
            targetUserIds = wIds;
            console.log('✅ Fallback: workflow user_ids →', targetUserIds.map(id => users.find(u => u.id === id)?.name));
          }
        } catch {}

        // Try jabatan from workflow
        if (targetUserIds.length === 0 && matchedWorkflow.jabatan) {
          const jab = matchedWorkflow.jabatan.trim().toLowerCase();
          const matched = users.filter(u => u.jabatan?.trim().toLowerCase() === jab);
          targetUserIds = matched.map(u => u.id);
          console.log(`✅ Fallback: workflow jabatan "${matchedWorkflow.jabatan}" → ${matched.map(u => u.name).join(', ') || 'none found'}`);
        }
      }
    }

    if (targetUserIds.length === 0) {
      console.error('❌ No target users found. Check workflow configuration.');
      console.log('Users:', users.map(u => ({ name: u.name, jabatan: u.jabatan })));
      console.log('Workflows:', workflows.map(w => ({ label: w.label, step_order: w.step_order, jabatan: w.jabatan, user_ids: (w as any).user_ids })));
    }
    console.groupEnd();

    // Send notification to each target user
    for (const uid of targetUserIds) {
      const name = users.find(u => u.id === uid)?.name || uid;
      console.log(`📨 Sending notification to: ${name}`);
      await createNotification(
        uid,
        'Approval Required',
        `Loan request ${requestId} requires your approval for step: ${step.label}`,
        'approval',
        '/request'
      );
    }
  };

  const handleDeleteLoan = async (id: string, requestId: string) => {
    if (confirm(`Are you sure you want to delete loan request ${requestId}?`)) {
      const { error } = await api.from('loan_requests').delete().eq('id', id);
      if (error) {
        console.error('Error deleting loan:', error.message);
        alert('Error: ' + error.message);
      } else {
        // Refresh handled by DataContext
      }
    }
  };

  const openProgressModal = (loan: LoanRequest) => {
    setSelectedLoan(loan);
    setIsProgressModalOpen(true);
  };

  const handleRequestLoan = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const monthLoansCount = loans.filter(l => {
      const d = new Date(l.date_created || l.date_start);
      return d.getFullYear() === currentYear && (d.getMonth() + 1) === currentMonth;
    }).length;

    const loanData = {
      request_id: selectedLoan?.request_id || `ERQ/${currentYear}/${String(currentMonth).padStart(2, '0')}/${String(monthLoansCount + 1).padStart(3, '0')}/YWTS`,
      project_id: formData.get('project_id') as string,
      shipname: formData.get('shipname') as string,
      vendor: formData.get('vendor') as string,
      work_order: formData.get('work_order') as string,
      date_start: formData.get('date_start') as string,
      date_finish: formData.get('date_finish') as string,
      duration: Number(formData.get('duration')) || 1,
      lampiran: '',
      change: '',
      status: (formData.get('submit_status') as any) || selectedLoan?.status || 'Pending',
      items: requestedItems,
      approval_steps: selectedLoan?.approval_steps || [
        { status: 'Draft', label: 'Request Created', date: new Date().toLocaleString(), user: currentUser?.name || 'Admin', isCompleted: true, isCurrent: false },
        ...workflows
          .filter(w => w.module === 'Equipment Loan')
          .sort((a, b) => a.step_order - b.step_order)
          .map((w, idx) => ({
            status: idx === 0 ? 'Pending' : 'Awaiting',
            label: w.label,
            jabatan: w.jabatan,
            user_id: w.user_id || '',
            user_ids: (w as any).user_ids || '[]',
            step_order: w.step_order,
            isCompleted: false,
            isCurrent: idx === 0
          }))
      ]
    };

    let error;
    if (selectedLoan) {
      const { error: updateError } = await api.from('loan_requests')
        .update(loanData)
        .eq('id', selectedLoan.id);
      error = updateError;
    } else {
      const newId = generateHexId();
      const { error: insertError } = await api.from('loan_requests')
        .insert([{ ...loanData, id: newId }]);
      error = insertError;
    }

    if (error) {
      console.error('Error saving loan to Supabase:', error.message);
      alert('Error saving: ' + error.message);
    } else {
      setIsModalOpen(false);
      
      // Notify the first approver if it's a new request and status is Pending
      if (!selectedLoan && loanData.status === 'Pending') {
        const firstStep = loanData.approval_steps.find(s => s.isCurrent);
        if (firstStep) {
          notifyApprover(loanData.request_id, firstStep);
        }
      }
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-2xl text-slate-800 tracking-tight">Equipment Loans</h2>
          <p className="text-sm text-slate-500 mt-1">Manage equipment requests and project-based tool allocation.</p>
        </div>
        <button 
          onClick={openAddModal}
          className="flex items-center justify-center gap-2 px-6 py-2.5 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-colors shadow-lg shadow-[#FDB913]/20 w-full lg:w-auto"
        >
          <Plus className="w-4 h-4" />
          Request Loan
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-50/50">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search by Request ID, Ship, or Project..." 
                value={searchTerm}
                onChange={handleSearchChange}
                className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
              />
            </div>
            
            <AnimatePresence>
              {selectedIds.size > 0 && (
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 px-3 py-1.5 bg-[#FDB913]/10 border border-[#FDB913]/20 rounded-xl"
                >
                  <span className="text-xs font-bold text-[#e5a611] mr-2">{selectedIds.size} Selected</span>
                  <button 
                    onClick={handleBulkExport}
                    className="p-1.5 text-[#FDB913] hover:bg-[#FDB913]/20 rounded-lg transition-colors"
                    title="Export Selected"
                  >
                    <FileText className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={handleBulkDelete}
                    className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                    title="Delete Selected"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          <div className="flex items-center justify-between sm:justify-end gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Show</span>
              <select 
                value={itemsPerPage}
                onChange={handleItemsPerPageChange}
                className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-600 outline-none focus:ring-2 focus:ring-[#FDB913]/30"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value="all">All</option>
              </select>
            </div>
            <button className="p-2 bg-white border border-slate-200 rounded-lg text-slate-500 hover:text-[#FDB913] hover:border-[#FDB913]/30 transition-colors">
              <Filter className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                <th className="px-6 py-4 border-b border-slate-100 w-10">
                  <input 
                    type="checkbox" 
                    checked={selectedIds.size === paginatedLoans.length && paginatedLoans.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-[#FDB913] focus:ring-[#FDB913]"
                  />
                </th>
                <th className="px-6 py-4 border-b border-slate-100 w-12 text-center">No</th>
                <th className="px-6 py-4 border-b border-slate-100">Request ID</th>
                <th className="px-6 py-4 border-b border-slate-100">Project & Ship</th>
                <th className="px-6 py-4 border-b border-slate-100">Work Order</th>
                <th className="px-6 py-4 border-b border-slate-100">Schedule</th>
                <th className="px-6 py-4 border-b border-slate-100">Items</th>
                <th className="px-6 py-4 border-b border-slate-100">Status</th>
                <th className="px-6 py-4 border-b border-slate-100 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedLoans.map((loan, idx) => (
                <motion.tr 
                  key={loan.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={`hover:bg-slate-50/80 transition-colors group ${selectedIds.has(loan.id) ? 'bg-[#FDB913]/10/30' : ''}`}
                >
                  <td className="px-6 py-4">
                    <input 
                      type="checkbox" 
                      checked={selectedIds.has(loan.id)}
                      onChange={() => toggleSelect(loan.id)}
                      className="rounded border-slate-300 text-[#FDB913] focus:ring-[#FDB913]"
                    />
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-xs font-bold text-slate-400">
                      {itemsPerPage === 'all' ? idx + 1 : (currentPage - 1) * (itemsPerPage as number) + idx + 1}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <button 
                      onClick={() => openEditModal(loan)}
                      className="text-left group/id"
                    >
                      <span className="text-xs font-mono font-bold text-[#FDB913] bg-[#FDB913]/10 px-2 py-1 rounded-md group-hover/id:bg-[#FDB913]/20 transition-colors">
                        {loan.request_id}
                      </span>
                    </button>
                    <p className="text-[10px] text-slate-400 mt-1 font-medium">{loan.date_created?.split('T')[0]}</p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400">
                        <Ship className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-800">{loan.shipname}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{loan.project_id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs text-slate-600 font-medium">{loan.work_order}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <Calendar className="w-3 h-3 text-[#FDB913]" />
                        <span>{loan.date_start}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-400">
                        <Clock className="w-3 h-3" />
                        <span>{loan.date_finish}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1 max-w-[150px]">
                      {loan.items?.map((item, i) => (
                        <span key={i} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                          {item.quantity}x {item.type}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <button 
                      onClick={() => openProgressModal(loan)}
                      className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider border transition-all hover:scale-105 active:scale-95 ${statusColors[loan.status]}`}
                    >
                      {loan.status}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {(() => {
                        const currentStep = loan.approval_steps.find(s => s.isCurrent);
                        const stepUserIds: string[] = (() => { try { return currentStep?.user_ids ? JSON.parse(currentStep.user_ids) : []; } catch { return []; } })();
                        const canApprove = currentStep && (
                          (currentUser?.role === 'Admin') ||
                          (stepUserIds.length > 0 && stepUserIds.includes(currentUser?.id || '')) ||
                          (stepUserIds.length === 0 && currentStep.user_id && currentStep.user_id === currentUser?.id) ||
                          (stepUserIds.length === 0 && !currentStep.user_id && currentStep.jabatan && currentStep.jabatan?.trim().toLowerCase() === currentUser?.jabatan?.trim().toLowerCase())
                        );
                        
                        return loan.status === 'Pending' && canApprove && (
                          <button 
                            onClick={() => handleApprove(loan.id)}
                            className="p-2 text-slate-400 hover:text-[#FDB913] rounded-lg hover:bg-[#FDB913]/10 transition-colors"
                            title="Approve"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        );
                      })()}
                      {loan.status === 'Draft' && (
                        <button 
                          onClick={() => openEditModal(loan)}
                          className="p-2 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                      <button 
                        onClick={() => handleDeleteLoan(loan.id, loan.request_id)}
                        className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          
          {paginatedLoans.length === 0 && (
            <div className="p-20 text-center">
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-slate-800 font-bold">No results found</h3>
              <p className="text-sm text-slate-500">Try adjusting your search or filters</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Showing <span className="font-bold text-slate-700">{paginatedLoans.length}</span> of <span className="font-bold text-slate-700">{totalItems}</span> requests
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
                {currentPage} <span className="text-slate-400 font-medium mx-1">/</span> {totalPages}
              </span>
            </div>
            <button 
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 border border-slate-200 rounded-lg text-slate-400 hover:text-[#FDB913] hover:border-[#FDB913]/30 disabled:opacity-50 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Request Loan Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#FDB913]/20 rounded-xl flex items-center justify-center text-[#FDB913]">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-xl text-slate-800">
                      {selectedLoan ? 'Edit Loan Request' : 'New Loan Request'}
                    </h3>
                    <p className="text-xs text-slate-500">Submit a request for equipment allocation</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <form onSubmit={handleRequestLoan} className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                {/* Check if editable: New request OR Draft status */}
                {(() => {
                  const isEditable = !selectedLoan || selectedLoan.status === 'Draft';
                  
                  const currentYear = new Date().getFullYear();
                  
                  // Filter projects based on create_date in the last 2 years
                  // BUT always include the currently selected project if it exists (for legacy support)
                  const activeProjects = projects.filter(p => {
                    const isSelected = p.id === modalProjectId || p.idproject === modalProjectId;
                    if (isSelected) return true;

                    if (!p.create_date) return false;
                    const createYear = new Date(p.create_date).getFullYear();
                    return createYear >= currentYear - 1 && createYear <= currentYear;
                  }).sort((a, b) => {
                    const dateA = new Date(a.create_date || 0).getTime();
                    const dateB = new Date(b.create_date || 0).getTime();
                    return dateB - dateA; // Descending (Newest first)
                  });

                  return (
                    <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Project ID</label>
                    <select 
                      name="project_id"
                      value={modalProjectId}
                      required
                      disabled={!isEditable}
                      onChange={(e) => {
                        const selectedId = e.target.value;
                        setModalProjectId(selectedId);
                        const project = projects.find(p => p.idproject === selectedId);
                        if (project && project.shipname) {
                          setModalShipName(project.shipname);
                        } else {
                          setModalShipName('');
                        }
                      }}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] disabled:opacity-60"
                    >
                      <option value="">Select Project</option>
                      {activeProjects.map(p => (
                        <option key={p.id} value={p.idproject}>
                          {p.idproject} {p.shipname ? `- ${p.shipname}` : ''}
                        </option>
                      ))}
                      {modalProjectId && !activeProjects.find(p => p.idproject === modalProjectId || p.id === modalProjectId) && (
                        <option value={modalProjectId}>
                          {modalProjectId} (Legacy Reference)
                        </option>
                      )}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ship Name</label>
                    <input 
                      name="shipname"
                      value={modalShipName}
                      readOnly
                      required
                      placeholder="Auto-filled from Project ID"
                      className="w-full px-4 py-2.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-xl text-sm outline-none cursor-not-allowed"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Work Order</label>
                    <input 
                      name="work_order"
                      defaultValue={selectedLoan?.work_order}
                      placeholder="e.g. WO1909014/YWTS"
                      required
                      disabled={!isEditable}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] disabled:opacity-60"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Vendor (Optional)</label>
                    <select 
                      name="vendor"
                      defaultValue={selectedLoan?.vendor}
                      disabled={!isEditable}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] disabled:opacity-60"
                    >
                      <option value="">Select Vendor</option>
                      {vendors.filter(v => v.status !== 'Inactive').map(vendor => (
                        <option key={vendor.id} value={vendor.vendor}>{vendor.vendor}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Start Date</label>
                    <input 
                      type="date"
                      name="date_start"
                      value={dateStart}
                      onChange={(e) => setDateStart(e.target.value)}
                      required
                      disabled={!isEditable}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] disabled:opacity-60"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Finish Date</label>
                    <input 
                      type="date"
                      name="date_finish"
                      value={dateFinish}
                      onChange={(e) => setDateFinish(e.target.value)}
                      required
                      disabled={!isEditable}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] disabled:opacity-60"
                    />
                  </div>
                </div>

                {/* Automatic Duration */}
                {(() => {
                  const days = (dateStart && dateFinish) 
                    ? Math.max(1, Math.ceil((new Date(dateFinish).getTime() - new Date(dateStart).getTime()) / (1000 * 60 * 60 * 24)) + 1)
                    : 1;
                  return (
                    <div className="p-4 bg-slate-900 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-[#FDB913]">
                          <Clock className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Calculated Duration</p>
                          <p className="text-xl font-display font-bold text-white">{days} Days</p>
                        </div>
                      </div>
                      <input type="hidden" name="duration" value={days} />
                    </div>
                  );
                })()}

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-slate-800">Requested Equipment</h4>
                    {isEditable && (
                      <button 
                        type="button" 
                        onClick={handleAddItemType}
                        className="text-xs font-bold text-[#FDB913] hover:text-[#e5a611] flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> Add Item Type
                      </button>
                    )}
                  </div>
                  
                  <div className="space-y-3">
                    {requestedItems.length === 0 ? (
                      <div className="p-8 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
                        <Plus className="w-8 h-8 mb-2 opacity-20" />
                        <p className="text-xs font-medium">No equipment types added yet.</p>
                        {isEditable && (
                          <button 
                            type="button" 
                            onClick={handleAddItemType}
                            className="mt-3 text-xs font-bold text-[#FDB913] hover:underline"
                          >
                            Click here to add your first item
                          </button>
                        )}
                      </div>
                    ) : (
                      requestedItems.map((item, index) => (
                        <div key={index} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-end gap-4">
                          <div className="flex-1 space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Equipment Type</label>
                            <select 
                              value={item.type}
                              onChange={(e) => handleItemChange(index, 'type', e.target.value)}
                              disabled={!isEditable}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none disabled:opacity-60"
                            >
                              {equipmentTypes.map(type => (
                                <option key={type} value={type}>{type}</option>
                              ))}
                            </select>
                          </div>
                          <div className="w-24 space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Quantity</label>
                            <input 
                              type="number" 
                              min="1"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(index, 'quantity', parseInt(e.target.value))}
                              disabled={!isEditable}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none disabled:opacity-60" 
                            />
                          </div>
                          {isEditable && (
                            <button 
                              type="button"
                              onClick={() => handleRemoveItemType(index)}
                              className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  
                  <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-100">
                    <AlertCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-700 leading-relaxed">
                      <strong>Note:</strong> You are requesting equipment by type. Specific asset allocation (serial numbers) will be handled by the Maintenance Manager after approval.
                    </p>
                  </div>
                </div>

                <div className="pt-6 border-t border-slate-100 flex justify-end gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    {isEditable ? 'Cancel' : 'Close'}
                  </button>
                  {isEditable && (
                    <>
                  <button 
                    type="button"
                    onClick={(e) => {
                      // Trigger form submit with Draft status
                      const form = (e.target as HTMLButtonElement).form;
                      if (form) {
                        const event = new Event('submit', { cancelable: true, bubbles: true });
                        // We need a way to tell the submit handler it's a draft
                        // Let's just manually call a handler or use a hidden input
                        const statusInput = document.createElement('input');
                        statusInput.type = 'hidden';
                        statusInput.name = 'submit_status';
                        statusInput.value = 'Draft';
                        form.appendChild(statusInput);
                        form.dispatchEvent(event);
                        form.removeChild(statusInput);
                      }
                    }}
                    className="px-6 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-200 transition-colors"
                  >
                    Save as Draft
                  </button>
                  <button 
                    type="submit"
                    className="px-8 py-2.5 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-colors shadow-lg shadow-[#FDB913]/20"
                  >
                    {selectedLoan ? 'Update Request' : 'Submit Request'}
                  </button>
                    </>
                  )}
                </div>
                </>
                  );
                })()}
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Approval Confirmation Modal */}
      <AnimatePresence>
        {isApproveModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsApproveModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-8"
            >
              <div className="w-16 h-16 bg-[#FDB913]/20 text-[#FDB913] rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8" />
              </div>
              <h3 className="font-display font-bold text-xl text-slate-800 mb-2 text-center">Confirm Approval</h3>
              <p className="text-sm text-slate-500 mb-6 text-center">
                Are you sure you want to approve this equipment loan request?
              </p>
              
              <div className="space-y-2 mb-8">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Approval Comment</label>
                <textarea 
                  value={approvalComment}
                  onChange={(e) => setApprovalComment(e.target.value)}
                  placeholder="Enter your approval notes here..."
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] min-h-[100px] resize-none"
                />
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setIsApproveModalOpen(false)}
                  className="flex-1 px-6 py-3 bg-slate-100 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmApprove}
                  className="flex-1 px-6 py-3 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-colors shadow-lg shadow-[#FDB913]/20"
                >
                  Approve Request
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Approval Progress Modal */}
      <AnimatePresence>
        {isProgressModalOpen && selectedLoan && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsProgressModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-lg text-slate-800">Approval Progress</h3>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">{selectedLoan.request_id}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsProgressModalOpen(false)}
                  className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <div className="p-8">
                <div className="relative space-y-8">
                  {/* Trackline */}
                  <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-slate-100" />
                  
                  {selectedLoan.approval_steps.map((step, index) => (
                    <div key={index} className="relative flex gap-6">
                      <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all duration-500 ${
                        step.isCompleted 
                          ? 'bg-[#FDB913] text-slate-900 shadow-lg shadow-teal-500/30' 
                          : step.isCurrent 
                            ? 'bg-white border-2 border-[#FDB913] text-[#FDB913] animate-pulse' 
                            : 'bg-white border-2 border-slate-100 text-slate-300'
                      }`}>
                        {step.isCompleted ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <div className={`w-2 h-2 rounded-full ${step.isCurrent ? 'bg-[#FDB913]' : 'bg-slate-200'}`} />
                        )}
                      </div>
                      
                      <div className="flex-1 pt-0.5">
                        <div className="flex items-center justify-between mb-1">
                          <h4 className={`text-sm font-bold ${step.isCompleted || step.isCurrent ? 'text-slate-800' : 'text-slate-400'}`}>
                            {step.label}
                          </h4>
                          {step.date && (
                            <span className="text-[10px] text-slate-400 font-medium">{step.date}</span>
                          )}
                        </div>
                        
                        {(step.user || step.comment) && (
                          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 mt-2">
                            {step.user && (
                              <p className="text-[10px] font-bold text-slate-500 mb-1">Action by: {step.user}</p>
                            )}
                            {step.comment && (
                              <p className="text-xs text-slate-600 italic">&quot;{step.comment}&quot;</p>
                            )}
                          </div>
                        )}
                        
                        {!step.isCompleted && !step.isCurrent && (
                          <p className="text-[10px] text-slate-400 italic mt-1">Waiting for previous step...</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                <button 
                  onClick={() => setIsProgressModalOpen(false)}
                  className="px-6 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Close
                </button>
                {(() => {
                  const currentStep = selectedLoan.approval_steps.find(s => s.isCurrent);
                  const stepUserIds2: string[] = (() => { try { return currentStep?.user_ids ? JSON.parse(currentStep.user_ids) : []; } catch { return []; } })();
                  const canApprove = currentStep && (
                    (currentUser?.role === 'Admin') ||
                    (stepUserIds2.length > 0 && stepUserIds2.includes(currentUser?.id || '')) ||
                    (stepUserIds2.length === 0 && currentStep.user_id && currentStep.user_id === currentUser?.id) ||
                    (stepUserIds2.length === 0 && !currentStep.user_id && currentStep.jabatan && currentStep.jabatan?.trim().toLowerCase() === currentUser?.jabatan?.trim().toLowerCase())
                  );
                  
                  return selectedLoan.status === 'Pending' && canApprove && (
                    <button 
                      onClick={() => {
                        setIsProgressModalOpen(false);
                        handleApprove(selectedLoan.id);
                      }}
                      className="px-6 py-2 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-colors shadow-lg shadow-[#FDB913]/20"
                    >
                      Approve Now
                    </button>
                  );
                })()}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
