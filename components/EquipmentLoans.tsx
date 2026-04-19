'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
import { supabase } from '@/lib/supabase';

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
  const { loans, setLoans, vendors, ships, projects } = useData();
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
  
  // Paging & Bulk States
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(10);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
      const { error } = await supabase.from('loan_requests').delete().in('id', Array.from(selectedIds));
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

  const handleAddItemType = () => {
    setRequestedItems([...requestedItems, { type: equipmentTypes[0], quantity: 1 }]);
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
    setRequestedItems([{ type: equipmentTypes[0], quantity: 1}]);
    setModalProjectId('');
    setModalShipName('');
    setIsModalOpen(true);
  };

  const openEditModal = (loan: LoanRequest) => {
    setSelectedLoan(loan);
    setRequestedItems(loan.items || []);
    setModalProjectId(loan.project_id || '');
    setModalShipName(loan.shipname || '');
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

      const newSteps = loan.approval_steps.map(step => {
        if (step.isCurrent) return { ...step, isCurrent: false, isCompleted: true, date: new Date().toLocaleString(), comment: approvalComment, user: 'Current User' };
        if (step.status === 'Approved') return { ...step, isCurrent: true };
        return step;
      });

      const { error } = await supabase
        .from('loan_requests')
        .update({ status: 'Approved', approval_steps: newSteps })
        .eq('id', loanToApprove);

      if (error) {
        console.error('Error approving loan in Supabase:', error.message);
        alert('Error approving: ' + error.message);
      } else {
        setIsApproveModalOpen(false);
        setLoanToApprove(null);
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
    
    const loanData = {
      request_id: selectedLoan?.request_id || `ERQ/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}/${String(loans.length + 1).padStart(3, '0')}/YWTS`,
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
        { status: 'Draft', label: 'Request Created', date: new Date().toLocaleString(), user: 'Admin', isCompleted: true, isCurrent: false },
        { status: 'Pending', label: 'Department Approval', isCompleted: false, isCurrent: true },
        { status: 'Approved', label: 'Final Approval', isCompleted: false, isCurrent: false }
      ]
    };

    let error;
    if (selectedLoan) {
      const { error: updateError } = await supabase
        .from('loan_requests')
        .update(loanData)
        .eq('id', selectedLoan.id);
      error = updateError;
    } else {
      const { error: insertError } = await supabase
        .from('loan_requests')
        .insert([loanData]);
      error = insertError;
    }

    if (error) {
      console.error('Error saving loan to Supabase:', error.message);
      alert('Error saving: ' + error.message);
    } else {
      setIsModalOpen(false);
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
                    <p className="text-[10px] text-slate-400 mt-1 font-medium">{loan.date_created}</p>
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
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {loan.status === 'Pending' && (
                        <button 
                          onClick={() => handleApprove(loan.id)}
                          className="p-2 text-slate-400 hover:text-[#FDB913] rounded-lg hover:bg-[#FDB913]/10 transition-colors"
                          title="Approve"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                      {loan.status === 'Draft' && (
                        <button 
                          onClick={() => openEditModal(loan)}
                          className="p-2 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                      <button className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="group-hover:hidden">
                      <MoreHorizontal className="w-4 h-4 text-slate-300 ml-auto" />
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
                  
                  // Extract years for all projects to find the latest available year dynamically
                  const projectYears = projects.map(p => {
                    if (p.year && Number(p.year) > 2000) return Number(p.year);
                    if (p.create_date) return new Date(p.create_date).getFullYear();
                    if (p.idproject && p.idproject.length >= 5) {
                      const match = p.idproject.match(/\d{2}/);
                      if (match) return 2000 + parseInt(match[0]);
                    }
                    return 0;
                  }).filter(y => !isNaN(y) && y > 2000);
                  
                  const maxYear = projectYears.length > 0 ? Math.max(...projectYears) : new Date().getFullYear();
                  
                  // Filter projects from the max year and the previous year (Last 2 Years)
                  const activeProjects = projects.filter((p, index) => {
                    let pYear = 0;
                    if (p.year && Number(p.year) > 2000) {
                      pYear = Number(p.year);
                    } else if (p.create_date) {
                      pYear = new Date(p.create_date).getFullYear();
                    } else if (p.idproject && p.idproject.length >= 5) {
                      const match = p.idproject.match(/\d{2}/);
                      if (match) pYear = 2000 + parseInt(match[0]);
                    }
                    
                    // Show from Max Year and Previous Year or generic fallback
                    return pYear >= maxYear - 1 || (!pYear && index < 50); // Fallback to include unparseable projects if we have to
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
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ship Name</label>
                    <input 
                      name="shipname"
                      value={modalShipName}
                      onChange={(e) => setModalShipName(e.target.value)}
                      list="ships-list"
                      required
                      disabled={!isEditable}
                      placeholder="Type or select ship name"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] disabled:opacity-60"
                    />
                    <datalist id="ships-list">
                      {ships.map(ship => (
                        <option key={ship.id} value={ship.shipname}>{ship.shipname}</option>
                      ))}
                    </datalist>
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
                      {vendors.map(vendor => (
                        <option key={vendor.id} value={vendor.vendor}>{vendor.vendor}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Start Date</label>
                    <input 
                      type="date"
                      name="date_start"
                      defaultValue={selectedLoan?.date_start}
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
                      defaultValue={selectedLoan?.date_finish}
                      required
                      disabled={!isEditable}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] disabled:opacity-60"
                    />
                  </div>
                </div>

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
                {selectedLoan.status === 'Pending' && (
                  <button 
                    onClick={() => {
                      setIsProgressModalOpen(false);
                      handleApprove(selectedLoan.id);
                    }}
                    className="px-6 py-2 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-colors shadow-lg shadow-[#FDB913]/20"
                  >
                    Approve Now
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
