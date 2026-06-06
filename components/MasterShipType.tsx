'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Trash2, 
  Edit2,
  Settings,
  X,
  Search,
  Ship,
  ChevronRight,
  ChevronLeft,
  Tags
} from 'lucide-react';
import { useData, DropdownConfig } from '@/context/DataContext';
import { api } from '@/lib/api-client';

export default function MasterShipType() {
  const { dropdownConfigs, fetchData, currentUser, canAccess } = useData();
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<DropdownConfig | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [formData, setFormData] = useState({
    label: '',
    value: '',
    category: 'ship_types',
    is_active: true
  });

  const filteredConfigs = dropdownConfigs
    .filter(c => c.category === 'ship_types')
    .filter(c => c.label.toLowerCase().includes(searchTerm.toLowerCase()));

  // Pagination Logic
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const totalPages = Math.ceil(filteredConfigs.length / itemsPerPage);
  const currentConfigs = filteredConfigs.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleAdd = () => {
    setEditingConfig(null);
    setFormData({
      label: '',
      value: '',
      category: 'ship_types',
      is_active: true
    });
    setIsModalOpen(true);
  };

  const handleEdit = (config: DropdownConfig) => {
    setEditingConfig(config);
    setFormData({
      label: config.label,
      value: config.value,
      category: config.category,
      is_active: config.is_active
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (editingConfig) {
        const { error } = await api.from('dropdown_configs')
          .update({
            label: formData.label,
            value: formData.value || formData.label,
            is_active: formData.is_active
          })
          .eq('id', editingConfig.id);
        if (error) throw error;
      } else {
        const { error } = await api.from('dropdown_configs').insert([{
          category: formData.category,
          label: formData.label,
          value: formData.value || formData.label,
          is_active: formData.is_active
        }]);
        if (error) throw error;
      }
      
      setIsModalOpen(false);
      setEditingConfig(null);
      await fetchData();
    } catch (error: any) {
      alert('Error saving config: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleStatus = async (config: DropdownConfig) => {
    try {
      const { error } = await api.from('dropdown_configs')
        .update({ is_active: !config.is_active })
        .eq('id', config.id);
      
      if (error) throw error;
      await fetchData();
    } catch (error: any) {
      alert('Error updating status: ' + error.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this configuration?')) return;
    
    try {
      const { error } = await api.from('dropdown_configs').delete().eq('id', id);
      if (error) throw error;
      await fetchData();
    } catch (error: any) {
      alert('Error deleting: ' + error.message);
    }
  };

  if (!canAccess('Master Kapal', 'view')) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <h2 className="text-xl font-bold text-slate-700">Access Denied</h2>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-2xl text-slate-800 tracking-tight">Master Ship Type</h2>
          <p className="text-sm text-slate-500 mt-1">Manage vessel classification types and categories.</p>
        </div>
        <div className="flex gap-3">
          {canAccess('Master Kapal', 'add') && (
            <button 
              onClick={handleAdd}
              className="flex items-center justify-center gap-2 px-6 py-2.5 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-all shadow-lg shadow-[#FDB913]/20"
            >
              <Plus className="w-4 h-4" /> Add Type
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search types..." 
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                <th className="px-6 py-4 border-b border-slate-100 w-16 text-center">No</th>
                <th className="px-6 py-4 border-b border-slate-100">Code</th>
                <th className="px-6 py-4 border-b border-slate-100">Ship Type Name</th>
                <th className="px-6 py-4 border-b border-slate-100">Status</th>
                <th className="px-6 py-4 border-b border-slate-100 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {currentConfigs.map((config, idx) => (
                <tr key={config.id} className="hover:bg-slate-50/30 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-slate-400 text-center">
                    {(currentPage - 1) * itemsPerPage + idx + 1}
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono text-sm font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-md">{config.value}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                        <Ship className="w-4 h-4" />
                      </div>
                      <span className="text-sm font-bold text-slate-700">{config.label}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <button 
                      onClick={() => toggleStatus(config)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border transition-all ${
                        config.is_active 
                          ? 'bg-green-50 text-green-700 border-green-100' 
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full ${config.is_active ? 'bg-green-500' : 'bg-slate-400'}`}></div>
                      {config.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {canAccess('Master Kapal', 'edit') && (
                        <button 
                          onClick={() => handleEdit(config)}
                          className="p-2 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                      {canAccess('Master Kapal', 'delete') && (
                        <button 
                          onClick={() => handleDelete(config.id)}
                          className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {currentConfigs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-400 text-sm italic">
                    No ship types found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Menampilkan <span className="font-bold text-slate-700">{currentConfigs.length}</span> dari <span className="font-bold text-slate-700">{filteredConfigs.length}</span> data
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
              <form onSubmit={handleSubmit}>
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#FDB913]/20 rounded-xl flex items-center justify-center text-[#FDB913]">
                      <Ship className="w-5 h-5" />
                    </div>
                    <h3 className="font-display font-bold text-xl text-slate-800">{editingConfig ? 'Edit Type' : 'Add New Type'}</h3>
                  </div>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full">
                    <X className="w-5 h-5 text-slate-500" />
                  </button>
                </div>

                <div className="p-8 space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Code</label>
                    <input 
                      required
                      type="text"
                      value={formData.value}
                      onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                      placeholder="e.g. MV, TB, LCT..."
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Ship Type Name</label>
                    <input 
                      required
                      type="text"
                      value={formData.label}
                      onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                      placeholder="e.g. Motor Vessel, Tugboat..."
                    />
                  </div>
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                  <button 
                    type="button" 
                    onClick={() => setIsModalOpen(false)}
                    className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={isLoading}
                    className="px-8 py-2.5 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-all shadow-lg shadow-[#FDB913]/20"
                  >
                    {isLoading ? 'Saving...' : editingConfig ? 'Save Changes' : 'Add Type'}
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
