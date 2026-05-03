'use client';

import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  MoreVertical, 
  Edit2, 
  Trash2, 
  X, 
  MapPin,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { useData, LocationMaster } from '@/context/DataContext';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '@/lib/api-client';

export default function MasterLocation() {
  const { locations, setLocations } = useData();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<LocationMaster | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [formData, setFormData] = useState({
    name: '',
    size: '',
    description: '',
    status: 'Active'
  });

  const handleOpenModal = (location: LocationMaster | null = null) => {
    if (location) {
      setEditingLocation(location);
      setFormData({ 
        name: location.name,
        size: location.size || '',
        description: location.description || '',
        status: location.status || 'Active'
      });
    } else {
      setEditingLocation(null);
      setFormData({ 
        name: '',
        size: '',
        description: '',
        status: 'Active'
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      if (editingLocation) {
        const { error } = await api.from('master_locations')
          .update(formData)
          .eq('id', editingLocation.id);
        
        if (error) throw error;

        setLocations(prev => prev.map(loc => 
          loc.id === editingLocation.id 
            ? { ...loc, ...formData } 
            : loc
        ));
      } else {
        const newLocationData = {
          id: crypto.randomUUID(),
          ...formData
        };

        const { error } = await api.from('master_locations')
          .insert([newLocationData]);
        
        if (error) throw error;

        setLocations(prev => [newLocationData as LocationMaster, ...prev]);
      }

      setIsModalOpen(false);
    } catch (error) {
      console.error('Error saving location:', error);
      alert('Failed to save location data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this location?')) {
      try {
        const { error } = await api.from('master_locations').delete().eq('id', id);
        if (error) throw error;
        setLocations(prev => prev.filter(loc => loc.id !== id));
      } catch (error) {
        console.error('Error deleting location:', error);
        alert('Failed to delete location.');
      }
    }
  };

  // Filter & Pagination Logic
  const filteredLocations = locations?.filter(loc => 
    loc.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    loc.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    loc.size?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const totalPages = Math.ceil(filteredLocations.length / itemsPerPage);
  const currentLocations = filteredLocations.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-800">Master Location</h1>
          <p className="text-sm text-slate-500 mt-1">Manage all docking and shipyard locations</p>
        </div>
        <button 
          onClick={() => handleOpenModal()}
          className="bg-[#FDB913] hover:bg-[#e5a812] text-slate-900 px-6 py-2.5 rounded-xl font-bold transition-all flex items-center gap-2 shadow-sm hover:shadow"
        >
          <Plus className="w-4 h-4 border-2 border-slate-900 rounded-full" />
          Add Location
        </button>
      </div>

      {/* Main Content */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-4 justify-between bg-slate-50/50">
          <div className="relative max-w-md w-full">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search locations..."
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
                <th className="p-4 font-bold">Location Name</th>
                <th className="p-4 font-bold">Size / Dimensions</th>
                <th className="p-4 font-bold">Description</th>
                <th className="p-4 font-bold">Status</th>
                <th className="p-4 font-bold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm text-slate-700 divide-y divide-slate-100">
              {currentLocations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center">
                      <MapPin className="w-12 h-12 text-slate-200 mb-3" />
                      <p className="font-medium">No locations found</p>
                      <p className="text-xs mt-1">Add a new location to get started</p>
                    </div>
                  </td>
                </tr>
              ) : (
                currentLocations.map((loc) => (
                  <tr key={loc.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
                          <MapPin className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-bold text-slate-800">{loc.name}</p>
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5">{loc.id.substring(0, 8)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 font-medium text-slate-600">
                      {loc.size || '-'}
                    </td>
                    <td className="p-4 text-slate-500 max-w-xs truncate" title={loc.description}>
                      {loc.description || '-'}
                    </td>
                    <td className="p-4">
                      <span className={'px-3 py-1 text-xs font-bold rounded-full ' + (
                        loc.status === 'Active' 
                          ? 'bg-emerald-100 text-emerald-700' 
                          : 'bg-slate-100 text-slate-600'
                      )}>
                        {loc.status}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => handleOpenModal(loc)}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(loc.id)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
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
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredLocations.length)} of {filteredLocations.length} entries
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
                <h3 className="font-display font-bold text-xl text-slate-800">
                  {editingLocation ? 'Edit Location' : 'Add New Location'}
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Location Name</label>
                  <input 
                    required
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                    placeholder="e.g. Graving Dock A"
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Size / Dimensions</label>
                  <input 
                    type="text"
                    value={formData.size}
                    onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                    placeholder="e.g. 150m x 40m"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Description</label>
                  <textarea 
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all min-h-[80px]"
                    placeholder="Optional details..."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</label>
                  <select 
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
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
                    {isLoading ? 'Saving...' : 'Save Location'}
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
