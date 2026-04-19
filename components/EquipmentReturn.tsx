'use client';

import React, { useState } from 'react';
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
  FileText,
  RotateCcw,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

import { useData, LoanRequest, DeploymentRecord } from '@/context/DataContext';
import { supabase } from '@/lib/supabase';

export default function EquipmentReturn() {
  const { fleet: assets, setFleet: setAssets, loans, setLoans, deployments, setDeployments } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRequests, setExpandedRequests] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(10);
  
  // Return Modal State
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<DeploymentRecord | null>(null);
  const [returnStatus, setReturnStatus] = useState<'Available' | 'Damaged'>('Available');
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

  // Filter loans that have active deployments
  const activeLoans = loans.filter(loan => {
    const hasActiveDeployments = deployments.some(d => d.request_id === loan.request_id && d.return_status === 'Deployed');
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = 
      (loan.request_id.toLowerCase().includes(searchLower) ||
      loan.shipname.toLowerCase().includes(searchLower) ||
      loan.project_id.toLowerCase().includes(searchLower));
    
    return hasActiveDeployments && matchesSearch;
  });

  // Pagination Logic
  const totalItems = activeLoans.length;
  const effectiveItemsPerPage = itemsPerPage === 'all' ? totalItems : itemsPerPage;
  const totalPages = Math.ceil(totalItems / (effectiveItemsPerPage || 1));
  const startIndex = (currentPage - 1) * (effectiveItemsPerPage as number);
  const paginatedLoans = itemsPerPage === 'all' 
    ? activeLoans 
    : activeLoans.slice(startIndex, startIndex + (effectiveItemsPerPage as number));

  const openReturnModal = (record: DeploymentRecord) => {
    setSelectedRecord(record);
    setReturnStatus('Available');
    setReturnDate(new Date().toISOString().split('T')[0]);
    setReturnNotes('');
    setIsReturnModalOpen(true);
  };

  const handleConfirmReturn = async () => {
    if (!selectedRecord) return;

    const updatedRecord = {
      return_date: returnDate,
      return_status: returnStatus === 'Available' ? 'Returned' : 'Damaged',
      description: returnNotes || `Returned as ${returnStatus}`
    };

    const updatedAssetStatus = returnStatus === 'Available' ? 'Available' : 'Damaged';

    try {
      // 1. Update deployment record
      const { error: depError } = await supabase
        .from('deployment_records')
        .update(updatedRecord)
        .eq('unique_id', selectedRecord.unique_id);
      if (depError) throw depError;

      // 2. Update asset status
      const { error: assetError } = await supabase
        .from('equipment')
        .update({ available: updatedAssetStatus })
        .eq('no_asset', selectedRecord.product_id);
      if (assetError) throw assetError;

      // 3. Check if all items for this loan are now returned
      const { data: currentDeployments, error: fetchError } = await supabase
        .from('deployment_records')
        .select('return_status')
        .eq('request_id', selectedRecord.request_id);
      
      if (fetchError) throw fetchError;

      const allReturned = currentDeployments.every(d => d.return_status === 'Returned' || d.return_status === 'Damaged');
      
      if (allReturned) {
        const { error: loanError } = await supabase
          .from('loan_requests')
          .update({ status: 'Completed' })
          .eq('request_id', selectedRecord.request_id);
        if (loanError) throw loanError;
      }

      setIsReturnModalOpen(false);
      alert('Equipment return processed successfully!');
    } catch (error: any) {
      console.error('Error during return in Supabase:', error.message);
      alert('Error during return: ' + error.message);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-2xl text-slate-800 tracking-tight">Equipment Return</h2>
          <p className="text-sm text-slate-500 mt-1">Process returns for deployed equipment and update asset status.</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="relative flex-1 max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search by Request ID, Ship, or Project..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
            />
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-3 w-full lg:w-auto">
            <span className="text-[10px] sm:text-xs font-bold text-amber-700 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-100 whitespace-nowrap">
              {activeLoans.length} Active Loans
            </span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                  <th className="px-6 py-4 border-b border-slate-100 w-10"></th>
                  <th className="px-6 py-4 border-b border-slate-100">Request ID</th>
                  <th className="px-6 py-4 border-b border-slate-100">Ship & Project</th>
                  <th className="px-6 py-4 border-b border-slate-100">Deployed Date</th>
                  <th className="px-6 py-4 border-b border-slate-100">Active Assets</th>
                  <th className="px-6 py-4 border-b border-slate-100 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedLoans.map((loan) => {
                  const activeDeployments = deployments.filter(d => d.request_id === loan.request_id && d.return_status === 'Deployed');
                  const isExpanded = expandedRequests.has(loan.id);

                  return (
                    <React.Fragment key={loan.id}>
                      <tr className={`hover:bg-slate-50/50 transition-colors ${isExpanded ? 'bg-slate-50/30' : ''}`}>
                        <td className="px-6 py-4">
                          <button 
                            onClick={() => toggleExpand(loan.id)}
                            className={`p-1 rounded-lg transition-colors ${isExpanded ? 'bg-[#FDB913]/20 text-[#e5a611]' : 'hover:bg-slate-100 text-slate-400'}`}
                          >
                            <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          </button>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-xs font-mono font-bold text-[#FDB913] bg-[#FDB913]/10 px-2 py-1 rounded-md">
                            {loan.request_id}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <p className="text-sm font-bold text-slate-800">{loan.shipname}</p>
                            <p className="text-[10px] text-slate-500">{loan.project_id}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-[11px] text-slate-600">{loan.date_start}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded-full">
                            {activeDeployments.length} items
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button 
                            onClick={() => toggleExpand(loan.id)}
                            className="text-xs font-bold text-[#FDB913] hover:underline"
                          >
                            {isExpanded ? 'Hide Details' : 'View Assets'}
                          </button>
                        </td>
                      </tr>
                      
                      <AnimatePresence>
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} className="px-6 py-0 border-b border-slate-100 bg-slate-50/20">
                              <motion.div 
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                              >
                                <div className="py-4 pl-14 pr-6">
                                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                    <table className="w-full text-left border-collapse">
                                      <thead>
                                        <tr className="bg-slate-50/80 text-slate-400 uppercase text-[9px] font-bold tracking-widest">
                                          <th className="px-4 py-3 border-b border-slate-100">Asset ID</th>
                                          <th className="px-4 py-3 border-b border-slate-100">Item Name</th>
                                          <th className="px-4 py-3 border-b border-slate-100">Deployed Since</th>
                                          <th className="px-4 py-3 border-b border-slate-100 text-right">Action</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                        {activeDeployments.map((record) => (
                                          <tr key={record.unique_id} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-4 py-3">
                                              <span className="text-[11px] font-mono font-bold text-slate-700">{record.product_id}</span>
                                            </td>
                                            <td className="px-4 py-3">
                                              <span className="text-[11px] font-medium text-slate-600">{record.product_name || record.item}</span>
                                            </td>
                                            <td className="px-4 py-3">
                                              <span className="text-[11px] text-slate-500">{record.start_date}</span>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                              <button 
                                                onClick={() => openReturnModal(record)}
                                                className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 rounded-lg text-[10px] font-bold hover:bg-amber-100 transition-colors border border-amber-200"
                                              >
                                                <RotateCcw className="w-3 h-3" /> Process Return
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
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
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
                className="bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold px-2 py-1 outline-none focus:ring-2 focus:ring-[#FDB913]/30"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value="all">All</option>
              </select>
            </div>
            <p className="text-xs text-slate-500">
              Showing <span className="font-bold text-slate-700">{totalItems > 0 ? startIndex + 1 : 0}</span> to <span className="font-bold text-slate-700">{Math.min(startIndex + (effectiveItemsPerPage as number), totalItems)}</span> of <span className="font-bold text-slate-700">{totalItems}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button 
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => prev - 1)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold disabled:opacity-50"
            >
              Previous
            </button>
            <button 
              disabled={currentPage === totalPages || totalPages === 0}
              onClick={() => setCurrentPage(prev => prev + 1)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold disabled:opacity-50"
            >
              Next
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
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600">
                    <RotateCcw className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-xl text-slate-800">Return Equipment</h3>
                    <p className="text-xs text-slate-500">Processing return for {selectedRecord.product_id}</p>
                  </div>
                </div>
                <button onClick={() => setIsReturnModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <div className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Asset Name</p>
                    <p className="text-sm font-bold text-slate-800">{selectedRecord.product_name || selectedRecord.item}</p>
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
                        onClick={() => setReturnStatus('Available')}
                        className={`flex items-center justify-center gap-2 p-3 rounded-xl border font-bold text-xs transition-all ${
                          returnStatus === 'Available' 
                            ? 'bg-[#FDB913]/10 border-[#FDB913]/30 text-[#e5a611] ring-2 ring-[#FDB913]/10' 
                            : 'bg-white border-slate-200 text-slate-500 hover:border-[#FDB913]/30'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4" /> Available
                      </button>
                      <button 
                        onClick={() => setReturnStatus('Damaged')}
                        className={`flex items-center justify-center gap-2 p-3 rounded-xl border font-bold text-xs transition-all ${
                          returnStatus === 'Damaged' 
                            ? 'bg-red-50 border-red-200 text-red-700 ring-2 ring-red-500/10' 
                            : 'bg-white border-slate-200 text-slate-500 hover:border-red-200'
                        }`}
                      >
                        <AlertTriangle className="w-4 h-4" /> Damaged
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-2">Return Date</label>
                    <input 
                      type="date"
                      value={returnDate}
                      onChange={(e) => setReturnDate(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-2">Notes / Catatan</label>
                    <textarea 
                      value={returnNotes}
                      onChange={(e) => setReturnNotes(e.target.value)}
                      placeholder="Enter return details or damage report..."
                      rows={3}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all resize-none"
                    />
                  </div>
                </div>

                <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-100">
                  <AlertCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-blue-700 leading-relaxed">
                    Processing this return will update the asset status in the fleet and mark the deployment record as complete.
                  </p>
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
                  className="px-8 py-2.5 bg-amber-600 text-white rounded-xl text-sm font-bold hover:bg-amber-700 transition-colors shadow-lg shadow-amber-600/20"
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
