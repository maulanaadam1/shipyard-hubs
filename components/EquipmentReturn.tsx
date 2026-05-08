'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  X, 
  Ship, 
  Package, 
  Calendar, 
  Clock, 
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  RotateCcw,
  Check,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

import { useData, LoanRequest, DeploymentRecord } from '@/context/DataContext';
import { api } from '@/lib/api-client';

export default function EquipmentReturn() {
  const { fleet: assets, setFleet: setAssets, loans, setLoans, deployments, setDeployments, fetchData, currentUser } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRequests, setExpandedRequests] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(10);
  
  // Return Modal State
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<DeploymentRecord | null>(null);
  const [returnStatus, setReturnStatus] = useState<'Yes' | 'Damaged'>('Yes');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [returnNotes, setReturnNotes] = useState('');

  const toggleExpand = (requestId: string) => {
    const newSet = new Set(expandedRequests);
    if (newSet.has(requestId)) {
      newSet.delete(requestId);
    } else {
      newSet.add(requestId);
    }
    setExpandedRequests(newSet);
  };

  // 1. Logic for Pending Return (Grouped by Loan Request)
  const pendingLoans = loans.filter(loan => {
    const hasActiveDeployments = (deployments || []).some(d => d.request_id === loan.request_id && d.return_status === 'Deployed');
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = 
      (loan.request_id.toLowerCase().includes(searchLower) ||
      loan.shipname.toLowerCase().includes(searchLower) ||
      loan.project_id.toLowerCase().includes(searchLower));
    
    if (!hasActiveDeployments || !matchesSearch) return false;

    // Identity-based PIC Filtering (Name or Username)
    const myEquipmentTypes = assets
      .filter(a => a.pic === currentUser?.name || (a.pic && a.pic === (currentUser as any)?.username))
      .map(a => a.type);
    const uniqueMyTypes = Array.from(new Set(myEquipmentTypes));

    if (uniqueMyTypes.length > 0) {
      return loan.items.some(item => uniqueMyTypes.includes(item.type));
    }

    return true;
  });

  // 2. Logic for Return History (Individual Records)
  const historyRecords = (deployments || []).filter(d => {
    const isReturned = d.return_status === 'Returned' || d.return_status === 'Damaged';
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = 
      (d.request_id.toLowerCase().includes(searchLower) ||
      d.product_id.toLowerCase().includes(searchLower) ||
      (d.product_name || '').toLowerCase().includes(searchLower) ||
      (d.shipname || '').toLowerCase().includes(searchLower));
    
    if (!isReturned || !matchesSearch) return false;

    // Identity-based PIC Filtering (Name or Username)
    const myEquipmentTypes = assets
      .filter(a => a.pic === currentUser?.name || (a.pic && a.pic === (currentUser as any)?.username))
      .map(a => a.type);
    const uniqueMyTypes = Array.from(new Set(myEquipmentTypes));

    if (uniqueMyTypes.length > 0) {
      return uniqueMyTypes.includes(d.item);
    }

    return true;
  }).sort((a, b) => new Date(b.return_date).getTime() - new Date(a.return_date).getTime());

  // Pagination Logic (Mainly for History)
  const activeList = activeTab === 'pending' ? pendingLoans : historyRecords;
  const totalItems = activeList.length;
  const effectiveItemsPerPage = itemsPerPage === 'all' ? totalItems : itemsPerPage;
  const totalPages = Math.ceil(totalItems / (effectiveItemsPerPage || 1));
  const startIndex = (currentPage - 1) * (effectiveItemsPerPage as number);
  const paginatedList = itemsPerPage === 'all' 
    ? activeList 
    : activeList.slice(startIndex, startIndex + (effectiveItemsPerPage as number));

  // Reset page when switching tabs or searching
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchTerm]);

  const openReturnModal = (record: DeploymentRecord) => {
    setSelectedRecord(record);
    setReturnStatus('Yes');
    setReturnDate(new Date().toISOString().split('T')[0]);
    setReturnNotes('');
    setIsReturnModalOpen(true);
  };

  const handleConfirmReturn = async () => {
    if (!selectedRecord) return;

    const updatedRecord = {
      return_date: returnDate,
      return_status: returnStatus === 'Yes' ? 'Returned' : 'Damaged',
      description: returnNotes || `Returned as ${returnStatus}`
    };

    const updatedAssetStatus = returnStatus === 'Yes' ? 'Yes' : 'Damaged';

    try {
      // 1. Update deployment record
      const { error: depError } = await api.from('deployment_records')
        .update(updatedRecord)
        .eq('unique_id', selectedRecord.unique_id);
      if (depError) throw depError;

      // 2. Update asset status
      const { error: assetError } = await api.from('equipment')
        .update({ available: updatedAssetStatus })
        .eq('id', selectedRecord.product_id);
      if (assetError) throw assetError;

      // 3. Check if all items for this loan are now returned
      const { data: currentDeployments, error: fetchError } = await api.from('deployment_records')
        .select('return_status')
        .eq('request_id', selectedRecord.request_id);
      
      if (fetchError) throw fetchError;

      const allReturned = currentDeployments.every((d: any) => d.return_status === 'Returned' || d.return_status === 'Damaged');
      
      if (allReturned) {
        const { error: loanError } = await api.from('loan_requests')
          .update({ status: 'Completed' })
          .eq('request_id', selectedRecord.request_id);
        if (loanError) throw loanError;
      }

      setIsReturnModalOpen(false);
      await fetchData();
      alert('Equipment return processed successfully!');
    } catch (error: any) {
      console.error('Error during return in Supabase:', error.message);
      alert('Error during return: ' + error.message);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h2 className="font-display font-bold text-3xl text-slate-800 tracking-tight">Equipment Return</h2>
          <p className="text-sm text-slate-500 mt-1">Track and process returns for deployed assets.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-full lg:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search returns..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 shadow-sm transition-all"
            />
          </div>
        </div>
      </div>

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
            Pending Return ({pendingLoans.length})
          </div>
          {activeTab === 'pending' && <motion.div layoutId="activeTabReturn" className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#FDB913]" />}
        </button>
        <button 
          onClick={() => setActiveTab('history')}
          className={`px-8 py-4 text-sm font-bold transition-all relative ${
            activeTab === 'history' ? 'text-[#e5a611]' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4" />
            Return History ({historyRecords.length})
          </div>
          {activeTab === 'history' && <motion.div layoutId="activeTabReturn" className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#FDB913]" />}
        </button>
      </div>

      <div className="space-y-6">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          {activeTab === 'pending' ? (
            /* Pending Return Table (Grouped by Loan) */
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="px-6 py-4 w-12 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">No</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ship / Project</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vendor</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Units at Site</th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedList.map((loan: any, idx) => {
                      const loanDeployments = (deployments || []).filter(d => d.request_id === loan.request_id && d.return_status === 'Deployed');
                      const isExpanded = expandedRequests.has(loan.request_id);

                      return (
                        <React.Fragment key={loan.id}>
                          <tr 
                            onClick={() => toggleExpand(loan.request_id)}
                            className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                          >
                            <td className="px-6 py-4 text-center">
                              <span className="text-xs font-bold text-slate-400">{startIndex + idx + 1}</span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-slate-800">{loan.shipname}</span>
                                <span className="text-[10px] text-slate-400 font-mono">{loan.request_id}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-sm font-semibold text-slate-700">{loan.vendor}</span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="px-3 py-1 bg-[#FDB913]/10 text-[#e5a611] rounded-full text-xs font-bold border border-[#FDB913]/20">
                                {loanDeployments.length} Units
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex justify-center">
                                <div className={`p-2 rounded-xl transition-all ${isExpanded ? 'bg-[#FDB913]/10 text-[#e5a611] rotate-90' : 'bg-slate-50 text-slate-300'}`}>
                                  <ChevronRight className="w-4 h-4" />
                                </div>
                              </div>
                            </td>
                          </tr>
                          
                          <AnimatePresence>
                            {isExpanded && (
                              <tr>
                                <td colSpan={5} className="p-0 bg-slate-50/30">
                                  <motion.div 
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="p-6">
                                      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                                        <table className="w-full text-left">
                                          <thead>
                                            <tr className="bg-slate-50/80 border-b border-slate-100">
                                              <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Asset Name / Alias</th>
                                              <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Asset ID</th>
                                              <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Deployed Date</th>
                                              <th className="px-6 py-3 text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest">Action</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100">
                                            {loanDeployments.map((record) => (
                                              <tr key={record.unique_id} className="hover:bg-slate-50/50 transition-colors">
                                                <td className="px-6 py-4">
                                                  <span className="text-sm font-bold text-slate-700">{record.product_name}</span>
                                                </td>
                                                <td className="px-6 py-4">
                                                  <span className="text-xs font-mono text-slate-400">{record.product_id}</span>
                                                </td>
                                                <td className="px-6 py-4 text-sm text-slate-500">
                                                  {record.start_date}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                  <button 
                                                    onClick={() => openReturnModal(record)}
                                                    className="px-4 py-2 bg-[#FDB913] text-slate-900 rounded-xl text-xs font-bold hover:bg-[#e5a611] transition-all shadow-sm"
                                                  >
                                                    Process Return
                                                  </button>
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </motion.div>
                                </td>
                              </tr>
                            )}
                          </AnimatePresence>
                        </React.Fragment>
                      );
                    })}
                    {paginatedList.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-20 text-center">
                          <p className="text-slate-400 text-sm">No pending return requests found.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            /* Return History Table */
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-6 py-4 w-12 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">No</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Asset / Alias</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Request ID</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Return Date</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Status</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ship & Project</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedList.map((record: any, idx) => (
                    <tr key={record.unique_id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 text-center">
                        <span className="text-xs font-bold text-slate-400">{startIndex + idx + 1}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-slate-800">{record.product_name}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{record.product_id}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-tight">
                        {record.request_id}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-slate-600">
                          <Calendar className="w-3.5 h-3.5" />
                          <span className="text-sm font-medium">{record.return_date}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                          record.return_status === 'Returned' 
                            ? 'bg-teal-50 text-teal-600 border-teal-100' 
                            : 'bg-red-50 text-red-600 border-red-100'
                        }`}>
                          {record.return_status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-700">{record.shipname}</span>
                          <span className="text-[10px] text-slate-400">{record.code_project}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {paginatedList.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-20 text-center">
                        <p className="text-slate-400 text-sm">No return history records found.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Global Standardized Pagination Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Showing <span className="font-bold text-slate-700">{paginatedList.length}</span> of <span className="font-bold text-slate-700">{totalItems}</span> entries
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
      </div>

      {/* Return Modal */}
      <AnimatePresence>
        {isReturnModalOpen && selectedRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsReturnModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-slate-200"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#FDB913]/10 rounded-xl flex items-center justify-center text-[#e5a611]">
                    <RotateCcw className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-xl text-slate-800">Return Equipment</h3>
                    <p className="text-xs text-slate-500">Processing return for {selectedRecord.product_id}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsReturnModalOpen(false)} 
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all flex items-center gap-2 text-xs font-bold"
                >
                  <X className="w-5 h-5" /> Exit
                </button>
              </div>

              <div className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Asset Name</p>
                    <p className="text-sm font-bold text-slate-800">{selectedRecord.product_name}</p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Request ID</p>
                    <p className="text-sm font-bold text-slate-800">{selectedRecord.request_id}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-2">Return Status</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        type="button"
                        onClick={() => setReturnStatus('Yes')}
                        className={`flex items-center justify-center gap-2 p-3 rounded-xl border font-bold text-xs transition-all ${
                          returnStatus === 'Yes' 
                            ? 'bg-teal-50 border-teal-500 text-teal-700 shadow-sm' 
                            : 'bg-white border-slate-200 text-slate-500 hover:border-teal-500/30'
                        }`}
                      >
                        <Check className="w-4 h-4" /> Good / Available
                      </button>
                      <button 
                        type="button"
                        onClick={() => setReturnStatus('Damaged')}
                        className={`flex items-center justify-center gap-2 p-3 rounded-xl border font-bold text-xs transition-all ${
                          returnStatus === 'Damaged' 
                            ? 'bg-red-50 border-red-500 text-red-700 shadow-sm' 
                            : 'bg-white border-slate-200 text-slate-500 hover:border-red-500/30'
                        }`}
                      >
                        <AlertCircle className="w-4 h-4" /> Damaged / Issue
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-2">Return Date</label>
                    <input 
                      type="date"
                      value={returnDate}
                      onChange={(e) => setReturnDate(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-2">Notes</label>
                    <textarea 
                      value={returnNotes}
                      onChange={(e) => setReturnNotes(e.target.value)}
                      placeholder="Add any specific details about the return..."
                      rows={3}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 resize-none"
                    />
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                <button 
                  onClick={() => setIsReturnModalOpen(false)}
                  className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleConfirmReturn}
                  className="px-8 py-2.5 bg-amber-600 text-white rounded-xl text-sm font-bold hover:bg-amber-700 transition-colors shadow-lg"
                >
                  Confirm Return
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
