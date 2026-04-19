'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  Plus, 
  X, 
  Check, 
  Trash2, 
  Ship, 
  Package, 
  Calendar, 
  Clock, 
  AlertCircle,
  ChevronRight,
  MoreHorizontal,
  FileText
} from 'lucide-react';

import { useData, LoanRequest, DeploymentRecord, Equipment as EquipmentAsset } from '@/context/DataContext';
import { supabase } from '@/lib/supabase';

export default function EquipmentDeployment() {
  const { fleet: assets, setFleet: setAssets, loans, setLoans, deployments, setDeployments } = useData();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<LoanRequest | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRequests, setExpandedRequests] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(10);

  const toggleExpand = (requestId: string) => {
    const newSet = new Set(expandedRequests);
    if (newSet.has(requestId)) {
      newSet.delete(requestId);
    } else {
      newSet.add(requestId);
    }
    setExpandedRequests(newSet);
  };
  
  // State for current deployment being built in modal
  const [allocatedAssets, setAllocatedAssets] = useState<{ 
    type: string, 
    assetId: string, 
    releaseDate: string,
    vendor_list: string,
    duration_hour: number
  }[]>([]);

  const filteredLoans = loans.filter(loan => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = 
      loan.status === 'Approved' && (
        loan.request_id.toLowerCase().includes(searchLower) ||
        loan.shipname.toLowerCase().includes(searchLower) ||
        loan.project_id.toLowerCase().includes(searchLower) ||
        loan.date_start.toLowerCase().includes(searchLower) ||
        loan.date_finish.toLowerCase().includes(searchLower) ||
        loan.items.some(item => item.type.toLowerCase().includes(searchLower))
      );
    return matchesSearch;
  });

  // Pagination Logic
  const totalItems = filteredLoans.length;
  const effectiveItemsPerPage = itemsPerPage === 'all' ? totalItems : itemsPerPage;
  const totalPages = Math.ceil(totalItems / (effectiveItemsPerPage || 1));
  const startIndex = (currentPage - 1) * (effectiveItemsPerPage as number);
  const paginatedLoans = itemsPerPage === 'all' 
    ? filteredLoans 
    : filteredLoans.slice(startIndex, startIndex + (effectiveItemsPerPage as number));

  const openDeploymentModal = (loan: LoanRequest) => {
    setSelectedLoan(loan);
    setAllocatedAssets([]);
    setIsModalOpen(true);
  };

  const handleAddAllocation = () => {
    if (!selectedLoan) return;

    // Find the first item type that still has "saldo" (remaining to be deployed)
    const counts: Record<string, number> = {};
    allocatedAssets.forEach(a => {
      counts[a.type] = (counts[a.type] || 0) + 1;
    });

    const nextItem = selectedLoan.items.find(item => {
      const alreadyDeployed = item.deployedQuantity || 0;
      const currentlyAllocated = counts[item.type] || 0;
      return (alreadyDeployed + currentlyAllocated) < item.quantity;
    });

    if (nextItem) {
      setAllocatedAssets([...allocatedAssets, { 
        type: nextItem.type, 
        assetId: '', 
        releaseDate: new Date().toISOString().split('T')[0],
        vendor_list: '',
        duration_hour: 0
      }]);
    } else {
      alert('All requested items have been allocated in this session.');
    }
  };

  const handleRemoveAllocation = (index: number) => {
    setAllocatedAssets(allocatedAssets.filter((_, i) => i !== index));
  };

  const handleAllocationChange = (index: number, field: 'type' | 'assetId' | 'releaseDate' | 'vendor_list' | 'duration_hour', value: any) => {
    const newAllocations = [...allocatedAssets];
    if (field === 'type') {
      newAllocations[index] = { ...newAllocations[index], type: value, assetId: '' };
    } else if (field === 'assetId') {
      newAllocations[index] = { ...newAllocations[index], assetId: value };
    } else if (field === 'releaseDate') {
      newAllocations[index] = { ...newAllocations[index], releaseDate: value };
    } else if (field === 'vendor_list') {
      newAllocations[index] = { ...newAllocations[index], vendor_list: value };
    } else if (field === 'duration_hour') {
      newAllocations[index] = { ...newAllocations[index], duration_hour: parseFloat(value) || 0 };
    }
    setAllocatedAssets(newAllocations);
  };

  const handleConfirmDeployment = async () => {
    if (!selectedLoan) return;

    // Validation: Check if all allocations are filled
    if (allocatedAssets.some(a => !a.assetId || !a.releaseDate)) {
      alert('Please select an asset and release date for all rows.');
      return;
    }

    const newDeployments: any[] = [];
    const assetUpdates: { id: string, status: string }[] = [];

    allocatedAssets.forEach(allocation => {
      const asset = assets.find(a => a.id === allocation.assetId);
      if (asset) {
        // Create deployment record
        const record = {
          create_by: 'Admin',
          last_updated: new Date().toLocaleString(),
          request_id: selectedLoan.request_id,
          year: new Date().getFullYear(),
          month: new Date().getMonth() + 1,
          item: allocation.type,
          product_id: asset.no_asset,
          product_name: asset.name,
          code_project: selectedLoan.project_id,
          project_name: selectedLoan.project_id,
          shipname: selectedLoan.shipname,
          vendor_list: allocation.vendor_list,
          vendor: selectedLoan.vendor,
          start_date: allocation.releaseDate,
          finish_date: selectedLoan.date_finish,
          duration: selectedLoan.duration,
          duration_hour: allocation.duration_hour,
          return_date: '',
          return_status: 'Deployed',
          description: `Released on ${allocation.releaseDate}`
        };
        newDeployments.push(record);
        assetUpdates.push({ id: asset.id, status: 'Deployed' });
      }
    });

    // Update loan items deployed quantity
    const newItems = selectedLoan.items.map(item => {
      const newlyAllocated = allocatedAssets.filter(a => a.type === item.type).length;
      return {
        ...item,
        deployedQuantity: (item.deployedQuantity || 0) + newlyAllocated
      };
    });
    
    // Check if fully deployed
    const isFullyDeployed = newItems.every(item => item.deployedQuantity === item.quantity);
    const updatedLoanStatus = isFullyDeployed ? 'Deployed' : selectedLoan.status;

    // Perform all updates in Supabase
    try {
      // 1. Insert deployments
      const { error: depError } = await supabase.from('deployment_records').insert(newDeployments);
      if (depError) throw depError;

      // 2. Update assets status
      for (const update of assetUpdates) {
        const { error: assetError } = await supabase
          .from('equipment')
          .update({ available: update.status })
          .eq('id', update.id);
        if (assetError) throw assetError;
      }

      // 3. Update loan request
      const { error: loanError } = await supabase
        .from('loan_requests')
        .update({ items: newItems, status: updatedLoanStatus })
        .eq('id', selectedLoan.id);
      if (loanError) throw loanError;

      setIsModalOpen(false);
      alert('Deployment confirmed successfully!');
    } catch (error: any) {
      console.error('Error during deployment in Supabase:', error.message);
      alert('Error during deployment: ' + error.message);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-2xl text-slate-800 tracking-tight">Equipment Deployment</h2>
          <p className="text-sm text-slate-500 mt-1">Follow up on approved loan requests and allocate specific assets.</p>
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
            <span className="text-[10px] sm:text-xs font-bold text-[#e5a611] bg-[#FDB913]/10 px-3 py-1.5 rounded-full border border-[#FDB913]/20 whitespace-nowrap">
              {filteredLoans.length} Pending
            </span>
            <button className="text-xs font-bold text-[#FDB913] hover:underline flex items-center gap-1 whitespace-nowrap">
              <FileText className="w-3 h-3" /> Export History
            </button>
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
                  <th className="px-6 py-4 border-b border-slate-100">Schedule</th>
                  <th className="px-6 py-4 border-b border-slate-100">Items Status</th>
                  <th className="px-6 py-4 border-b border-slate-100 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedLoans.map((loan) => {
                  const loanDeployments = deployments.filter(d => d.request_id === loan.request_id);
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
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400">
                              <Ship className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-800">{loan.shipname}</p>
                              <p className="text-[10px] text-slate-500">{loan.project_id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                              <Calendar className="w-3 h-3 text-[#FDB913]" />
                              <span>{loan.date_start}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                              <Clock className="w-3 h-3" />
                              <span>{loan.date_finish}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1.5">
                            {loan.items?.map((item, i) => {
                              const deployed = item.deployedQuantity || 0;
                              const isComplete = deployed === item.quantity;
                              return (
                                <span key={i} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                  isComplete ? 'bg-[#FDB913]/10 text-[#e5a611] border-[#FDB913]/20' : 'bg-slate-100 text-slate-600 border-slate-200'
                                }`}>
                                  {deployed}/{item.quantity} {item.type}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button 
                            onClick={() => openDeploymentModal(loan)}
                            className="inline-flex items-center gap-2 px-4 py-1.5 bg-[#FDB913] text-slate-900 rounded-xl text-xs font-bold hover:bg-[#e5a611] transition-colors shadow-sm"
                          >
                            <Plus className="w-3 h-3" /> Deploy
                          </button>
                        </td>
                      </tr>
                      
                      {/* Nested Deployment Records */}
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
                                          <th className="px-4 py-3 border-b border-slate-100">Item Type</th>
                                          <th className="px-4 py-3 border-b border-slate-100">Usage Status</th>
                                          <th className="px-4 py-3 border-b border-slate-100">Release Date</th>
                                          <th className="px-4 py-3 border-b border-slate-100 text-right">Actions</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                        {loanDeployments.map((record) => {
                                          const today = new Date();
                                          today.setHours(0, 0, 0, 0);
                                          const finishDate = new Date(record.finish_date);
                                          finishDate.setHours(0, 0, 0, 0);
                                          
                                          const diffTime = finishDate.getTime() - today.getTime();
                                          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                          
                                          let statusLabel = '';
                                          let statusColor = '';
                                          
                                          if (diffDays < 0) {
                                            statusLabel = 'Expired';
                                            statusColor = 'bg-red-100 text-red-700 border-red-200';
                                          } else if (diffDays <= 2) {
                                            statusLabel = `${diffDays} Left - Need Action`;
                                            statusColor = 'bg-amber-100 text-amber-700 border-amber-200 animate-pulse';
                                          } else {
                                            statusLabel = `${diffDays} Days Left`;
                                            statusColor = 'bg-[#FDB913]/20 text-[#e5a611] border-[#FDB913]/30';
                                          }

                                          return (
                                            <tr key={record.unique_id} className="hover:bg-slate-50/50 transition-colors">
                                              <td className="px-4 py-3">
                                                <span className="text-[11px] font-mono font-bold text-slate-700">{record.product_id}</span>
                                              </td>
                                              <td className="px-4 py-3">
                                                <span className="text-[11px] font-medium text-slate-600">{record.item}</span>
                                              </td>
                                              <td className="px-4 py-3">
                                                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border ${statusColor}`}>
                                                  {statusLabel}
                                                </span>
                                              </td>
                                              <td className="px-4 py-3">
                                                <span className="text-[11px] text-slate-500">{record.start_date}</span>
                                              </td>
                                              <td className="px-4 py-3 text-right">
                                                <button className="p-1 text-slate-400 hover:text-red-600 transition-colors">
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                        {loanDeployments.length === 0 && (
                                          <tr>
                                            <td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-[11px]">
                                              No assets deployed for this request yet.
                                            </td>
                                          </tr>
                                        )}
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
                {filteredLoans.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-20 text-center">
                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Search className="w-8 h-8 text-slate-300" />
                      </div>
                      <h3 className="text-slate-800 font-bold">No approved requests found</h3>
                      <p className="text-sm text-slate-500">Try adjusting your search or filters</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination Controls */}
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
              <span className="text-xs text-slate-500">entries</span>
            </div>
            <p className="text-xs text-slate-500">
              Showing <span className="font-bold text-slate-700">{totalItems > 0 ? startIndex + 1 : 0}</span> to <span className="font-bold text-slate-700">{Math.min(startIndex + (effectiveItemsPerPage as number), totalItems)}</span> of <span className="font-bold text-slate-700">{totalItems}</span> entries
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <div className="flex items-center gap-1">
              {[...Array(totalPages)].map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentPage(i + 1)}
                  className={`w-8 h-8 rounded-xl text-xs font-bold transition-all ${
                    currentPage === i + 1 
                      ? 'bg-[#FDB913] text-slate-900 shadow-md shadow-[#FDB913]/20' 
                      : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button 
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Deployment Modal */}
      <AnimatePresence>
        {isModalOpen && selectedLoan && (
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
              className="relative w-full max-w-4xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#FDB913]/20 rounded-xl flex items-center justify-center text-[#FDB913]">
                    <Package className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-xl text-slate-800">Deploy Equipment</h3>
                    <p className="text-xs text-slate-500">Allocating assets for {selectedLoan.request_id}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar relative">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start p-8">
                  {/* Summary Info */}
                  <div className="md:col-span-1 space-y-6 sticky top-0 pt-8 z-20 bg-white">
                    <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-4">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Request Summary</h4>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <Ship className="w-4 h-4 text-slate-400" />
                          <span className="text-sm font-bold text-slate-700">{selectedLoan.shipname}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <Calendar className="w-4 h-4 text-slate-400" />
                          <span className="text-xs text-slate-600">{selectedLoan.date_start} - {selectedLoan.date_finish}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Required Items</h4>
                      {selectedLoan.items.map((item, i) => {
                        const alreadyDeployed = item.deployedQuantity || 0;
                        const newlyAllocated = allocatedAssets.filter(a => a.type === item.type).length;
                        const totalAllocated = alreadyDeployed + newlyAllocated;
                        const isComplete = totalAllocated === item.quantity;
                        
                        return (
                          <div key={i} className={`p-4 rounded-2xl border transition-colors ${isComplete ? 'bg-[#FDB913]/10 border-[#FDB913]/20' : 'bg-white border-slate-100'}`}>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-sm font-bold text-slate-800">{item.type}</span>
                              <span className={`text-xs font-bold ${isComplete ? 'text-[#FDB913]' : 'text-slate-400'}`}>
                                {totalAllocated} / {item.quantity}
                              </span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, (totalAllocated / item.quantity) * 100)}%` }}
                                className={`h-full ${isComplete ? 'bg-[#FDB913]' : totalAllocated > item.quantity ? 'bg-red-500' : 'bg-teal-400'}`}
                              />
                            </div>
                            {alreadyDeployed > 0 && (
                              <p className="text-[9px] text-slate-400 mt-1">
                                {alreadyDeployed} already deployed
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Asset Allocation Rows */}
                  <div className="md:col-span-2 space-y-6">
                    <div className="sticky top-0 bg-white pt-8 pb-4 z-20 flex items-center justify-between border-b border-slate-100 mb-4">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Asset Allocation</h4>
                      <button 
                        type="button" 
                        onClick={handleAddAllocation}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[#FDB913]/10 text-[#FDB913] rounded-lg text-xs font-bold hover:bg-[#FDB913]/20 transition-colors"
                      >
                        <Plus className="w-3 h-3" /> Add Asset
                      </button>
                    </div>
                    
                    <div className="space-y-3">
                      {allocatedAssets.length === 0 ? (
                        <div className="p-12 border-2 border-dashed border-slate-100 rounded-3xl flex flex-col items-center justify-center text-slate-400">
                          <Package className="w-10 h-10 mb-3 opacity-20" />
                          <p className="text-sm font-medium">No assets allocated yet.</p>
                          <button 
                            type="button" 
                            onClick={handleAddAllocation}
                            className="mt-4 px-6 py-2 bg-[#FDB913]/10 text-[#FDB913] rounded-xl text-xs font-bold hover:bg-[#FDB913]/20 transition-colors"
                          >
                            Add First Asset
                          </button>
                        </div>
                      ) : (
                        allocatedAssets.map((allocation, index) => {
                          const availableAssets = assets.filter(a => 
                            a.type === allocation.type && 
                            (a.available === 'Available' || allocation.assetId === a.id) &&
                            !allocatedAssets.some((other, otherIdx) => otherIdx !== index && other.assetId === a.id)
                          );

                          return (
                            <motion.div 
                              key={index}
                              initial={{ opacity: 0, x: 20 }}
                              animate={{ opacity: 1, x: 0 }}
                              className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex flex-wrap items-end gap-4"
                            >
                              <div className="flex-1 min-w-[120px] space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Item Type</label>
                                <select 
                                  value={allocation.type}
                                  onChange={(e) => handleAllocationChange(index, 'type', e.target.value)}
                                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                                >
                                  {selectedLoan.items.map(item => (
                                    <option key={item.type} value={item.type}>{item.type}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex-[1.5] min-w-[180px] space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Specific Asset</label>
                                <select 
                                  value={allocation.assetId}
                                  onChange={(e) => handleAllocationChange(index, 'assetId', e.target.value)}
                                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                                >
                                  <option value="">Select Asset...</option>
                                  {availableAssets.map(asset => (
                                    <option key={asset.id} value={asset.id}>{asset.no_asset} - {asset.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex-1 min-w-[140px] space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Release Date</label>
                                <input 
                                  type="date"
                                  value={allocation.releaseDate}
                                  onChange={(e) => handleAllocationChange(index, 'releaseDate', e.target.value)}
                                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                                />
                              </div>
                              <div className="flex-1 min-w-[140px] space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Vendor List</label>
                                <input 
                                  type="text"
                                  value={allocation.vendor_list}
                                  onChange={(e) => handleAllocationChange(index, 'vendor_list', e.target.value)}
                                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                                  placeholder="Vendor name..."
                                />
                              </div>
                              <div className="w-24 space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Duration (H)</label>
                                <input 
                                  type="number"
                                  value={allocation.duration_hour}
                                  onChange={(e) => handleAllocationChange(index, 'duration_hour', e.target.value)}
                                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                                  placeholder="Hours"
                                />
                              </div>
                              <button 
                                type="button"
                                onClick={() => handleRemoveAllocation(index)}
                                className="p-2 text-slate-400 hover:text-red-500 transition-colors mb-1"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </motion.div>
                          );
                        })
                      )}
                    </div>

                    <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-100">
                      <AlertCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-blue-700 leading-relaxed">
                        <strong>Note:</strong> Select the specific asset number for each requested item type. Ensure the total allocated quantity matches the request.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleConfirmDeployment}
                  disabled={allocatedAssets.length === 0 || allocatedAssets.some(a => !a.assetId)}
                  className="px-8 py-2.5 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-colors shadow-lg shadow-[#FDB913]/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm & Deploy
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
