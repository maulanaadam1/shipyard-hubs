'use client';

import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  X, 
  Check,
  Anchor,
  Filter,
  Ship as ShipIcon,
  Maximize2,
  Layers,
  Building2,
  Upload,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  FileSpreadsheet
} from 'lucide-react';
import { useData, Ship } from '@/context/DataContext';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '@/lib/supabase';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export default function ShipManagement() {
  const { ships, setShips, companies } = useData();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [editingShip, setEditingShip] = useState<Ship | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  // Pagination & Selection States
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(10);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [formData, setFormData] = useState({
    type: '',
    shipname: '',
    company: '',
    loa: 0,
    breadth: 0,
    depth: 0,
    draft: 0,
    gt: 0,
    buid: ''
  });

  const handleOpenModal = (ship: Ship | null = null) => {
    if (ship) {
      setEditingShip(ship);
      setFormData({ 
        type: ship.type || '', 
        shipname: ship.shipname,
        company: ship.company || '',
        loa: ship.loa || 0,
        breadth: ship.breadth || 0,
        depth: ship.depth || 0,
        draft: ship.draft || 0,
        gt: ship.gt || 0,
        buid: ship.buid || ''
      });
    } else {
      setEditingShip(null);
      setFormData({ 
        type: '', 
        shipname: '',
        company: '',
        loa: 0,
        breadth: 0,
        depth: 0,
        draft: 0,
        gt: 0,
        buid: ''
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      if (editingShip) {
        const { error } = await supabase
          .from('ships')
          .update(formData)
          .eq('id', editingShip.id);
        
        if (error) throw error;
      } else {
        const newId = Math.random().toString(16).substring(2, 10);
        const { error } = await supabase
          .from('ships')
          .insert([{ id: newId, ...formData }]);
        
        if (error) throw error;
        setShowSuccessModal(true);
      }
      setIsModalOpen(false);
    } catch (error: any) {
      console.error('Error saving ship:', error.message);
      alert('Error: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this ship?')) return;
    
    try {
      const { error } = await supabase
        .from('ships')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    } catch (error: any) {
      console.error('Error deleting ship:', error.message);
      alert('Error: ' + error.message);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    const fileName = file.name.toLowerCase();

    try {
      let rawData: any[] = [];

      if (fileName.endsWith('.csv')) {
        await new Promise((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
              rawData = results.data;
              resolve(null);
            },
            error: (err) => reject(err)
          });
        });
      } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        rawData = XLSX.utils.sheet_to_json(worksheet);
      } else {
        throw new Error('Unsupported file format. Please use CSV or Excel.');
      }

      if (rawData.length === 0) {
        throw new Error('The file is empty.');
      }

      const formattedData = rawData.map(row => {
        const getValue = (keys: string[]) => {
          const foundKey = Object.keys(row).find(k => 
            keys.some(key => k.toLowerCase().replace(/[\s_]/g, '') === key.toLowerCase().replace(/[\s_]/g, ''))
          );
          return foundKey ? row[foundKey] : '';
        };

        return {
          id: getValue(['id']) || Math.random().toString(16).substring(2, 10),
          type: getValue(['type', 'shiptype', 'kategori']),
          shipname: getValue(['shipname', 'name', 'nama', 'kapal']),
          company: getValue(['company', 'owner', 'perusahaan', 'pemilik']),
          loa: parseFloat(getValue(['loa', 'length']) || '0') || 0,
          breadth: parseFloat(getValue(['breadth', 'lebar']) || '0') || 0,
          depth: parseFloat(getValue(['depth', 'dalam']) || '0') || 0,
          draft: parseFloat(getValue(['draft']) || '0') || 0,
          gt: parseFloat(getValue(['gt', 'gross']) || '0') || 0,
          buid: getValue(['buid', 'idkapal'])
        };
      });

      const { error } = await supabase
        .from('ships')
        .upsert(formattedData, { onConflict: 'id' });

      if (error) throw error;
      
      setShowSuccessModal(true);
    } catch (error: any) {
      console.error('Import error:', error);
      alert('Import failed: ' + (error.message || 'Unknown error'));
    } finally {
      setImporting(false);
      if (e.target) e.target.value = '';
    }
  };

  const filteredShips = ships.filter(s => 
    s.shipname.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.company?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination Logic
  const totalItems = filteredShips.length;
  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(totalItems / (itemsPerPage as number));
  const paginatedShips = itemsPerPage === 'all' 
    ? filteredShips 
    : filteredShips.slice((currentPage - 1) * (itemsPerPage as number), currentPage * (itemsPerPage as number));

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedShips.length && paginatedShips.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedShips.map(s => s.id)));
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
    if (confirm(`Are you sure you want to delete ${selectedIds.size} ships?`)) {
      const { error } = await supabase.from('ships').delete().in('id', Array.from(selectedIds));
      if (error) {
        alert('Error deleting: ' + error.message);
      } else {
        setSelectedIds(new Set());
      }
    }
  };

  return (
    <div className="p-8 space-y-6">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-slate-800 tracking-tight">Master Kapal</h1>
          <p className="text-slate-500 text-sm mt-1">Manage ship fleet and technical specifications.</p>
        </div>
        <div className="flex gap-3">
          <label 
            htmlFor="ship-import"
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all cursor-pointer shadow-sm"
          >
            <FileSpreadsheet className="w-4 h-4 text-green-600" />
            {importing ? 'Importing...' : 'Import CSV/Excel'}
            <input 
              id="ship-import"
              type="file" 
              accept=".csv, .xlsx, .xls, text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" 
              className="hidden" 
              onChange={handleImportFile} 
              disabled={importing}
            />
          </label>
          <button 
            onClick={() => handleOpenModal()}
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-all shadow-lg shadow-[#FDB913]/20"
          >
            <Plus className="w-4 h-4" />
            Add New Ship
          </button>
        </div>
      </div>

      {/* Stats & Search */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-50/50">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text"
                placeholder="Search by ship name, type, or owner..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
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
                onChange={(e) => { setItemsPerPage(e.target.value === 'all' ? 'all' : parseInt(e.target.value)); setCurrentPage(1); }}
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
                    checked={selectedIds.size === paginatedShips.length && paginatedShips.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-[#FDB913] focus:ring-[#FDB913]"
                  />
                </th>
                <th className="px-6 py-4 border-b border-slate-100 w-12 text-center">No</th>
                <th className="px-6 py-4 border-b border-slate-100">Ship Name</th>
                <th className="px-6 py-4 border-b border-slate-100">Type</th>
                <th className="px-6 py-4 border-b border-slate-100">Owner</th>
                <th className="px-6 py-4 border-b border-slate-100 text-center">GT</th>
                <th className="px-6 py-4 border-b border-slate-100 text-center">LOA</th>
                <th className="px-6 py-4 border-b border-slate-100 text-center">Draft</th>
                <th className="px-6 py-4 border-b border-slate-100 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedShips.map((ship, idx) => (
                <motion.tr 
                  key={ship.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={`hover:bg-slate-50/80 transition-colors group ${selectedIds.has(ship.id) ? 'bg-[#FDB913]/10/30' : ''}`}
                >
                  <td className="px-6 py-4">
                    <input 
                      type="checkbox" 
                      checked={selectedIds.has(ship.id)}
                      onChange={() => toggleSelect(ship.id)}
                      className="rounded border-slate-300 text-[#FDB913] focus:ring-[#FDB913]"
                    />
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-xs font-bold text-slate-400">
                      {itemsPerPage === 'all' ? idx + 1 : (currentPage - 1) * (itemsPerPage as number) + idx + 1}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-slate-800">{ship.shipname}</span>
                  </td>
                  <td className="px-6 py-4">
                    {ship.type ? (
                      <span className="px-2 py-0.5 bg-[#FDB913]/10 text-[#FDB913] rounded text-[10px] font-bold uppercase tracking-wider">
                        {ship.type}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-slate-600">
                      <Building2 className="w-3 h-3 text-slate-400" />
                      <span className="text-xs font-medium">{ship.company || '-'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-xs font-bold text-slate-600">{ship.gt || 0}</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-xs font-bold text-slate-600">{ship.loa || 0}</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-xs font-bold text-slate-600">{ship.draft || 0}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => handleOpenModal(ship)}
                        className="p-2 text-slate-400 hover:text-[#FDB913] rounded-lg hover:bg-[#FDB913]/10 transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(ship.id)}
                        className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="group-hover:hidden">
                      <MoreVertical className="w-4 h-4 text-slate-300 ml-auto" />
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>

          {paginatedShips.length === 0 && (
            <div className="p-20 text-center">
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-slate-800 font-bold">No ships found</h3>
              <p className="text-sm text-slate-500">Try adjusting your search or filters</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Showing <span className="font-bold text-slate-700">{paginatedShips.length}</span> of <span className="font-bold text-slate-700">{totalItems}</span> ships
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

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setIsModalOpen(false)}
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div>
                  <h2 className="font-display font-bold text-2xl text-slate-900">
                    {editingShip ? 'Edit Ship' : 'Add New Ship'}
                  </h2>
                  <p className="text-slate-500 text-sm">Fill in the technical specifications.</p>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 hover:bg-white rounded-xl transition-colors shadow-sm"
                >
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Ship Name</label>
                    <input 
                      required
                      type="text"
                      value={formData.shipname}
                      onChange={(e) => setFormData({ ...formData, shipname: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                      placeholder="e.g. MT SINAR AGRA"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Ship Type</label>
                    <input 
                      type="text"
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                      placeholder="e.g. MT, TB, BG"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Owner / Company</label>
                    <select 
                      value={formData.company}
                      onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                    >
                      <option value="">Select Company</option>
                      {companies.map(c => (
                        <option key={c.id} value={c.company_name}>{c.company_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Gross Tonnage (GT)</label>
                    <input 
                      type="number"
                      value={formData.gt}
                      onChange={(e) => setFormData({ ...formData, gt: parseFloat(e.target.value) || 0 })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 bg-slate-50 rounded-3xl border border-slate-100">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">LOA</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={formData.loa}
                      onChange={(e) => setFormData({ ...formData, loa: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Breadth</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={formData.breadth}
                      onChange={(e) => setFormData({ ...formData, breadth: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Depth</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={formData.depth}
                      onChange={(e) => setFormData({ ...formData, depth: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Draft</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={formData.draft}
                      onChange={(e) => setFormData({ ...formData, draft: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                    />
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-3.5 border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-50 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={isLoading}
                    className="flex-1 py-3.5 bg-[#FDB913] text-slate-900 rounded-2xl font-bold hover:bg-[#e5a611] transition-all shadow-lg shadow-[#FDB913]/20 disabled:opacity-50"
                  >
                    {isLoading ? 'Saving...' : editingShip ? 'Update Ship' : 'Create Ship'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Success Modal */}
      <AnimatePresence>
        {showSuccessModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-8 text-center"
            >
              <div className="w-20 h-20 bg-[#FDB913]/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <Check className="w-10 h-10 text-[#FDB913]" />
              </div>
              <h3 className="font-display font-bold text-2xl text-slate-900 mb-2">Ship Added!</h3>
              <p className="text-slate-500 mb-8">
                The new ship has been successfully added to the master database.
              </p>
              <button 
                onClick={() => setShowSuccessModal(false)}
                className="w-full py-4 bg-[#FDB913] text-slate-900 rounded-2xl font-bold hover:bg-[#e5a611] transition-all shadow-lg shadow-[#FDB913]/20"
              >
                Great, thanks!
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
