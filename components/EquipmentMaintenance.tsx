'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  Wrench, 
  X, 
  AlertCircle,
  CheckCircle2,
  Clock,
  Hammer,
  History,
  ArrowRight
} from 'lucide-react';

import { useData, Equipment } from '@/context/DataContext';
import { supabase } from '@/lib/supabase';

export default function EquipmentMaintenance() {
  const { fleet: assets, setFleet: setAssets } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(10);
  
  // Maintenance Modal State
  const [isRepairModalOpen, setIsRepairModalOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Equipment | null>(null);
  const [repairNotes, setRepairNotes] = useState('');
  const [repairCost, setRepairCost] = useState('');

  // Filter assets that are Damaged or in Maintenance
  const maintenanceAssets = assets.filter(asset => {
    const isMaintenance = asset.available === 'Damaged' || asset.available === 'Maintenance';
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = 
      asset.no_asset.toLowerCase().includes(searchLower) ||
      asset.name.toLowerCase().includes(searchLower) ||
      asset.type.toLowerCase().includes(searchLower) ||
      asset.brand.toLowerCase().includes(searchLower);
    
    return isMaintenance && matchesSearch;
  });

  // Pagination Logic
  const totalItems = maintenanceAssets.length;
  const effectiveItemsPerPage = itemsPerPage === 'all' ? totalItems : itemsPerPage;
  const totalPages = Math.ceil(totalItems / (effectiveItemsPerPage || 1));
  const startIndex = (currentPage - 1) * (effectiveItemsPerPage as number);
  const paginatedAssets = itemsPerPage === 'all' 
    ? maintenanceAssets 
    : maintenanceAssets.slice(startIndex, startIndex + (effectiveItemsPerPage as number));

  const openRepairModal = (asset: Equipment) => {
    setSelectedAsset(asset);
    setRepairNotes('');
    setRepairCost('');
    setIsRepairModalOpen(true);
  };

  const handleCompleteRepair = async () => {
    if (!selectedAsset) return;

    const { error } = await supabase
      .from('equipment')
      .update({ available: 'Available' })
      .eq('id', selectedAsset.id);

    if (error) {
      console.error('Error completing repair in Supabase:', error.message);
      alert('Error completing repair: ' + error.message);
    } else {
      setIsRepairModalOpen(false);
      alert(`Asset ${selectedAsset.no_asset} has been repaired and is now Available.`);
    }
  };

  const handleStartMaintenance = async (asset: Equipment) => {
    const { error } = await supabase
      .from('equipment')
      .update({ available: 'Maintenance' })
      .eq('id', asset.id);

    if (error) {
      console.error('Error starting maintenance in Supabase:', error.message);
      alert('Error starting maintenance: ' + error.message);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-2xl text-slate-800 tracking-tight">Maintenance & Repairs</h2>
          <p className="text-sm text-slate-500 mt-1">Manage damaged equipment and track maintenance schedules.</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="relative flex-1 max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search by Asset ID, Name, or Category..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
            />
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-3 w-full lg:w-auto">
            <span className="text-[10px] sm:text-xs font-bold text-red-700 bg-red-50 px-3 py-1.5 rounded-full border border-red-100 whitespace-nowrap">
              {maintenanceAssets.length} Items Needing Attention
            </span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                  <th className="px-6 py-4 border-b border-slate-100">Asset ID</th>
                  <th className="px-6 py-4 border-b border-slate-100">Equipment Name</th>
                  <th className="px-6 py-4 border-b border-slate-100">Type</th>
                  <th className="px-6 py-4 border-b border-slate-100">Current Status</th>
                  <th className="px-6 py-4 border-b border-slate-100 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedAssets.map((asset) => (
                  <tr key={asset.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded-md">
                        {asset.no_asset}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm font-bold text-slate-800">{asset.name}</p>
                        <p className="text-[10px] text-slate-500">{asset.brand} - {asset.capacity}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs text-slate-600">{asset.type}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border ${
                        asset.available === 'Damaged' 
                          ? 'bg-red-100 text-red-700 border-red-200' 
                          : 'bg-amber-100 text-amber-700 border-amber-200'
                      }`}>
                        {asset.available}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {asset.available === 'Damaged' ? (
                          <button 
                            onClick={() => handleStartMaintenance(asset)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-[10px] font-bold hover:bg-amber-100 transition-colors border border-amber-200"
                          >
                            <Hammer className="w-3.5 h-3.5" /> Start Repair
                          </button>
                        ) : (
                          <button 
                            onClick={() => openRepairModal(asset)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FDB913]/10 text-[#e5a611] rounded-lg text-[10px] font-bold hover:bg-[#FDB913]/20 transition-colors border border-[#FDB913]/30"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Complete Repair
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {maintenanceAssets.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-20 text-center">
                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle2 className="w-8 h-8 text-[#FDB913]" />
                      </div>
                      <h3 className="text-slate-800 font-bold">All equipment is healthy</h3>
                      <p className="text-sm text-slate-500">No assets currently requiring maintenance.</p>
                    </td>
                  </tr>
                )}
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

      {/* Repair Completion Modal */}
      <AnimatePresence>
        {isRepairModalOpen && selectedAsset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsRepairModalOpen(false)}
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
                  <div className="w-10 h-10 bg-[#FDB913]/20 rounded-xl flex items-center justify-center text-[#FDB913]">
                    <Wrench className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-xl text-slate-800">Complete Repair</h3>
                    <p className="text-xs text-slate-500">Finalizing maintenance for {selectedAsset.no_asset}</p>
                  </div>
                </div>
                <button onClick={() => setIsRepairModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <div className="p-8 space-y-6">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white rounded-xl border border-slate-200 flex items-center justify-center">
                      <Hammer className="w-6 h-6 text-slate-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{selectedAsset.name}</p>
                      <p className="text-xs text-slate-500">{selectedAsset.brand} - {selectedAsset.capacity}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-2">Repair Notes</label>
                    <textarea 
                      value={repairNotes}
                      onChange={(e) => setRepairNotes(e.target.value)}
                      placeholder="Describe what was fixed..."
                      rows={3}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-2">Repair Cost (Optional)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">IDR</span>
                      <input 
                        type="number"
                        value={repairCost}
                        onChange={(e) => setRepairCost(e.target.value)}
                        placeholder="0"
                        className="w-full pl-12 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-4 bg-[#FDB913]/10 rounded-2xl border border-[#FDB913]/20">
                  <AlertCircle className="w-5 h-5 text-[#FDB913] shrink-0 mt-0.5" />
                  <p className="text-[11px] text-[#e5a611] leading-relaxed">
                    By completing this repair, the asset status will be set back to <strong>Available</strong> and it will appear in the fleet for future deployments.
                  </p>
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                <button 
                  onClick={() => setIsRepairModalOpen(false)}
                  className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleCompleteRepair}
                  className="px-8 py-2.5 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-colors shadow-lg shadow-[#FDB913]/20"
                >
                  Confirm & Available
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
