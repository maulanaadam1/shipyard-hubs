'use client';

import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X, 
  Settings,
  ChevronLeft,
  ChevronRight,
  Palette
} from 'lucide-react';
import { useData, DockStatusMaster } from '@/context/DataContext';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '@/lib/api-client';

export default function MasterDockStatus() {
  const { dockStatuses, setDockStatuses, fetchData, canAccess } = useData();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStatus, setEditingStatus] = useState<DockStatusMaster | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [formData, setFormData] = useState({
    name: '',
    color: '#3498db',
    is_active: true
  });

  const handleOpenModal = (status: DockStatusMaster | null = null) => {
    if (status) {
      setEditingStatus(status);
      setFormData({ 
        name: status.name,
        color: status.color || '#3498db',
        is_active: status.is_active
      });
    } else {
      setEditingStatus(null);
      setFormData({ 
        name: '',
        color: '#3498db',
        is_active: true
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      if (editingStatus) {
        const { error } = await api.from('master_status_dock')
          .update(formData)
          .eq('id', editingStatus.id);
        
        if (error) throw error;

        setDockStatuses(prev => prev.map(s => 
          s.id === editingStatus.id 
            ? { ...s, ...formData } 
            : s
        ));
      } else {
        const newStatusData = {
          id: crypto.randomUUID(),
          ...formData
        };

        const { error } = await api.from('master_status_dock')
          .insert([newStatusData]);
        
        if (error) throw error;

        setDockStatuses(prev => [newStatusData as DockStatusMaster, ...prev]);
      }
      
      await fetchData();
      setIsModalOpen(false);
    } catch (error) {
      console.error('Error saving status:', error);
      alert('Failed to save status data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this status?')) {
      try {
        const { error } = await api.from('master_status_dock').delete().eq('id', id);
        if (error) throw error;
        await fetchData();
        setDockStatuses(prev => prev.filter(s => s.id !== id));
      } catch (error) {
        console.error('Error deleting status:', error);
        alert('Failed to delete status.');
      }
    }
  };

  // Filter & Pagination Logic
  const filteredStatuses = (dockStatuses || []).filter(s => 
    s.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredStatuses.length / itemsPerPage);
  const currentStatuses = filteredStatuses.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-800">Master Dock Status</h1>
          <p className="text-sm text-slate-500 mt-1">Setup vessel statuses and their identifying colors</p>
        </div>
        {canAccess('Master Dock Status', 'add') && (
          <button 
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 bg-[#FDB913] text-slate-900 px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-[#e5a611] transition-all shadow-lg shadow-[#FDB913]/20"
          >
            <Plus className="w-4 h-4" />
            Add Status
          </button>
        )}
      </div>

      {/* Main Content */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-4 justify-between bg-slate-50/50">
          <div className="relative max-w-md w-full">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search statuses..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                <th className="p-4 font-bold">Status Name</th>
                <th className="p-4 font-bold text-center">Color Code</th>
                <th className="p-4 font-bold text-center">Preview</th>
                <th className="p-4 font-bold text-center">Status</th>
                <th className="p-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm text-slate-700 divide-y divide-slate-100">
              {currentStatuses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center">
                      <Settings className="w-12 h-12 text-slate-200 mb-3" />
                      <p className="font-medium">No statuses found</p>
                      <p className="text-xs mt-1">Setup status labels and colors to get started</p>
                    </div>
                  </td>
                </tr>
              ) : (
                currentStatuses.map((status) => (
                  <tr key={status.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="p-4 font-bold text-slate-800">
                      {status.name}
                    </td>
                    <td className="p-4 text-center">
                      <code className="text-[10px] font-mono bg-slate-100 px-2 py-1 rounded text-slate-500 uppercase tracking-wider">
                        {status.color}
                      </code>
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex justify-center">
                        <div 
                          className="w-8 h-4 rounded-full shadow-sm"
                          style={{ backgroundColor: status.color }}
                        />
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      <span className={'px-3 py-1 text-xs font-bold rounded-full ' + (
                        status.is_active 
                          ? 'bg-emerald-100 text-emerald-700' 
                          : 'bg-slate-100 text-slate-600'
                      )}>
                        {status.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                      {canAccess('Master Dock Status', 'edit') && (
                        <button 
                          onClick={() => handleOpenModal(status)}
                          className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-slate-400 hover:text-[#FDB913]"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                      {canAccess('Master Dock Status', 'delete') && (
                        <button 
                          onClick={() => handleDelete(status.id)}
                          className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-slate-400 hover:text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/30">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredStatuses.length)} of {filteredStatuses.length} entries
            </p>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="p-2 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-30 transition-all shadow-sm"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="p-2 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-30 transition-all shadow-sm"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
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
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#FDB913]/20 rounded-xl flex items-center justify-center text-[#FDB913]">
                    <Settings className="w-5 h-5" />
                  </div>
                  <h3 className="font-display font-bold text-xl text-slate-800">
                    {editingStatus ? 'Edit Status' : 'Add New Status'}
                  </h3>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status Name</label>
                  <input 
                    required
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                    placeholder="e.g. On Dock, Completed..."
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status Color</label>
                  <div className="flex gap-3">
                    <input 
                      type="color"
                      value={formData.color}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      className="w-12 h-12 rounded-xl border-none p-0 cursor-pointer overflow-hidden shadow-sm"
                    />
                    <input 
                      type="text"
                      value={formData.color}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all uppercase"
                      placeholder="#000000"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 italic">This color will be used for vessel shapes in layout view.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</label>
                  <select 
                    value={formData.is_active ? 'true' : 'false'}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.value === 'true' })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                  >
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={isLoading}
                    className="flex-1 py-3 bg-[#FDB913] text-slate-900 rounded-xl font-bold hover:bg-[#e5a812] transition-all disabled:opacity-50 shadow-sm"
                  >
                    {isLoading ? 'Saving...' : 'Save Status'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
