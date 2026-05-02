'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Trash2, 
  Save, 
  RefreshCw,
  Settings,
  Check,
  X,
  Search,
  Tag,
  Layers,
  ChevronRight
} from 'lucide-react';
import { useData, DropdownConfig } from '@/context/DataContext';
import { api } from '@/lib/api-client';

const CATEGORIES = [
  { id: 'roles', label: 'User Roles', icon: 'Shield' },
  { id: 'positions', label: 'Jabatan / Positions', icon: 'Briefcase' },
  { id: 'departments', label: 'Departments', icon: 'Building2' },
  { id: 'company_types', label: 'Company Types', icon: 'Building' },
  { id: 'ship_types', label: 'Ship Types', icon: 'Ship' },
  { id: 'equipment_types', label: 'Equipment Types', icon: 'Tool' },
];

export default function DropdownConfiguration() {
  const { dropdownConfigs, fetchData, currentUser } = useData();
  const [selectedCategory, setSelectedCategory] = useState(CATEGORIES[0].id);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [formData, setFormData] = useState({
    label: '',
    value: '',
    category: CATEGORIES[0].id,
    is_active: true
  });

  const filteredConfigs = dropdownConfigs
    .filter(c => c.category === selectedCategory)
    .filter(c => c.label.toLowerCase().includes(searchTerm.toLowerCase()));

  const handleAdd = () => {
    setFormData({
      label: '',
      value: '',
      category: selectedCategory,
      is_active: true
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { error } = await api.from('dropdown_configs').insert([{
        category: formData.category,
        label: formData.label,
        value: formData.value || formData.label,
        is_active: formData.is_active
      }]);

      if (error) throw error;
      
      setIsModalOpen(false);
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

  if (currentUser?.role !== 'Admin') {
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
          <h2 className="font-display font-bold text-2xl text-slate-800 tracking-tight">Master Configuration</h2>
          <p className="text-sm text-slate-500 mt-1">Manage all dropdown options and system classifications in one place.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={handleAdd}
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-all shadow-lg shadow-[#FDB913]/20"
          >
            <Plus className="w-4 h-4" /> Add Option
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Categories Sidebar */}
        <div className="lg:col-span-1 space-y-2">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-4">Categories</h3>
            <div className="space-y-1">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                    selectedCategory === cat.id 
                      ? 'bg-[#FDB913]/10 text-[#e5a611] border border-[#FDB913]/20' 
                      : 'text-slate-600 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Layers className={`w-4 h-4 ${selectedCategory === cat.id ? 'text-[#FDB913]' : 'text-slate-400'}`} />
                    {cat.label}
                  </div>
                  <ChevronRight className={`w-4 h-4 ${selectedCategory === cat.id ? 'opacity-100' : 'opacity-0'}`} />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <div className="relative max-w-xs w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Search options..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                    <th className="px-6 py-4 border-b border-slate-100">Label</th>
                    <th className="px-6 py-4 border-b border-slate-100">Value</th>
                    <th className="px-6 py-4 border-b border-slate-100">Status</th>
                    <th className="px-6 py-4 border-b border-slate-100 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredConfigs.map((config) => (
                    <tr key={config.id} className="hover:bg-slate-50/30 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-slate-700">{config.label}</td>
                      <td className="px-6 py-4 text-sm text-slate-500 font-mono">{config.value}</td>
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
                        <button 
                          onClick={() => handleDelete(config.id)}
                          className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredConfigs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-slate-400 text-sm italic">
                        No options found in this category.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Add Modal */}
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
                      <Settings className="w-5 h-5" />
                    </div>
                    <h3 className="font-display font-bold text-xl text-slate-800">Add New Option</h3>
                  </div>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full">
                    <X className="w-5 h-5 text-slate-500" />
                  </button>
                </div>

                <div className="p-8 space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Category</label>
                    <select 
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                    >
                      {CATEGORIES.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Label (Display Name)</label>
                    <input 
                      required
                      type="text"
                      value={formData.label}
                      onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                      placeholder="e.g. Operations Manager"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Value (Storage Code)</label>
                    <input 
                      type="text"
                      value={formData.value}
                      onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                      placeholder="Leave empty to use Label"
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
                    {isLoading ? 'Saving...' : 'Add Option'}
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
