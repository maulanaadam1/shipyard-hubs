'use client';

import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  MoreVertical, 
  Edit2, 
  Trash2, 
  X, 
  Check,
  Briefcase,
  Calendar,
  User as UserIcon,
  ChevronLeft,
  ChevronRight,
  FileText,
  Filter,
  Upload,
  FileSpreadsheet
} from 'lucide-react';
import { useData, Project } from '@/context/DataContext';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '@/lib/supabase';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export default function ProjectManagement() {
  const { projects, setProjects } = useData();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  // Pagination & Selection States
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(10);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [formData, setFormData] = useState({
    idproject: '',
    shipname: '',
    cust_company: '',
    year: new Date().getFullYear(),
    status: 'Active',
    project_lead: '',
    est_start: '',
    est_finish: ''
  });

  const handleOpenModal = (project: Project | null = null) => {
    if (project) {
      setEditingProject(project);
      setFormData({ 
        idproject: project.idproject, 
        shipname: project.shipname || '', 
        cust_company: project.cust_company || '', 
        year: project.year || new Date().getFullYear(), 
        status: project.status || 'Active',
        project_lead: project.project_lead || '',
        est_start: project.est_start || '',
        est_finish: project.est_finish || ''
      });
    } else {
      setEditingProject(null);
      setFormData({ 
        idproject: '', 
        shipname: '', 
        cust_company: '', 
        year: new Date().getFullYear(), 
        status: 'Active',
        project_lead: '',
        est_start: '',
        est_finish: ''
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      if (editingProject) {
        const { error } = await supabase
          .from('projects')
          .update(formData)
          .eq('id', editingProject.id);
        
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('projects')
          .insert([formData]);
        
        if (error) throw error;
        setShowSuccessModal(true);
      }
      setIsModalOpen(false);
    } catch (error: any) {
      console.error('Error saving project:', error.message);
      alert('Error: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;
    
    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    } catch (error: any) {
      console.error('Error deleting project:', error.message);
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
          return foundKey ? row[foundKey] : null;
        };

        const parseNum = (val: any) => {
          if (val === null || val === undefined || val === '') return null;
          const num = parseFloat(val.toString().replace(/,/g, ''));
          return isNaN(num) ? null : num;
        };

        return {
          id: getValue(['id']) || crypto.randomUUID(),
          id_siaga: parseNum(getValue(['id_siaga', 'idsiaga'])),
          create_date: getValue(['create_date', 'createdate', 'created_at']),
          updated_at: getValue(['updated_at', 'updatedat']),
          idproject: getValue(['idproject', 'projectid', 'project_id', 'id_project']),
          shipname: getValue(['shipname', 'vessel', 'kapal', 'nama_kapal']),
          cust_company: getValue(['cust_company', 'customer', 'company', 'perusahaan', 'custcompany']),
          approval_status: getValue(['approval_status', 'approvalstatus']),
          m_employee_id: getValue(['m_employee_id', 'employeeid']),
          est_start: getValue(['est_start', 'start_date', 'eststart']),
          est_finish: getValue(['est_finish', 'finish_date', 'estfinish']),
          est_docking_date: getValue(['est_docking_date', 'estdockingdate']),
          est_undocking_date: getValue(['est_undocking_date', 'estundockingdate']),
          est_trial_date: getValue(['est_trial_date', 'esttrialdate']),
          est_arrival_date: getValue(['est_arrival_date', 'estarrivaldate']),
          est_departure_date: getValue(['est_departure_date', 'estdeparturedate']),
          docking: getValue(['docking']),
          undocking: getValue(['undocking']),
          act_arrival_date: getValue(['act_arrival_date', 'actarrivaldate']),
          actual_start: getValue(['actual_start', 'actualstart']),
          actual_finish: getValue(['actual_finish', 'actualfinish']),
          act_trial_date: getValue(['act_trial_date', 'acttrialdate']),
          act_departure_date: getValue(['act_departure_date', 'actdeparturedate']),
          no: parseNum(getValue(['no'])),
          year: parseNum(getValue(['year', 'tahun'])) || new Date().getFullYear(),
          company: getValue(['company']),
          docking_id: getValue(['docking_id', 'dockingid']),
          docking_type: getValue(['docking_type', 'dockingtype']),
          number_project: getValue(['number_project', 'numberproject', 'number project']),
          type: getValue(['type']),
          width: parseNum(getValue(['width', 'lebar'])),
          length: parseNum(getValue(['length', 'panjang'])),
          location: getValue(['location', 'lokasi']),
          x_coordinate: parseNum(getValue(['x_coordinate', 'xcoordinate'])),
          y_coordinate: parseNum(getValue(['y_coordinate', 'ycoordinate'])),
          status_dock: getValue(['status_dock', 'statusdock']),
          ship_visibility: getValue(['ship_visibility', 'shipvisibility']),
          ship_condition: getValue(['ship_condition', 'shipcondition']),
          status: getValue(['status']) || 'Active',
          status_comercial: getValue(['status_comercial', 'statuscomercial']),
          duration_dock: parseNum(getValue(['duration_dock', 'durationdock'])),
          duration_project: parseNum(getValue(['duration_project', 'durationproject'])),
          project_lead: getValue(['project_lead', 'lead', 'pm', 'projectmanager']),
          price_contract: parseNum(getValue(['price_contract', 'pricecontract'])),
          cost_actual: parseNum(getValue(['cost_actual', 'costactual'])),
          gross_profit: parseNum(getValue(['gross_profit', 'grossprofit'])),
          safetyman: getValue(['safetyman']),
          project_team: getValue(['project_team', 'projectteam']),
          vendor_team: getValue(['vendor_team', 'vendorteam']),
          manpower_all: parseNum(getValue(['manpower_all', 'manpowerall'])),
          manpower_in: parseNum(getValue(['manpower_in', 'manpowerin'])),
          manpower_ven: parseNum(getValue(['manpower_ven', 'manpowerven'])),
          update_pdf: getValue(['update_pdf', 'updatepdf']),
          print: getValue(['print'])
        };
      }).filter(p => p.idproject); // Ensure idproject exists

      const { error } = await supabase
        .from('projects')
        .upsert(formattedData, { onConflict: 'idproject' });

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

  const filteredProjects = projects.filter(p => 
    p.idproject.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.shipname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.cust_company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.project_lead?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination Logic
  const totalItems = filteredProjects.length;
  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(totalItems / (itemsPerPage as number));
  const paginatedProjects = itemsPerPage === 'all' 
    ? filteredProjects 
    : filteredProjects.slice((currentPage - 1) * (itemsPerPage as number), currentPage * (itemsPerPage as number));

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedProjects.length && paginatedProjects.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedProjects.map(p => p.id)));
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
    if (confirm(`Are you sure you want to delete ${selectedIds.size} projects?`)) {
      const { error } = await supabase.from('projects').delete().in('id', Array.from(selectedIds));
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
          <h1 className="font-display font-bold text-2xl text-slate-800 tracking-tight">Job Order</h1>
          <p className="text-slate-500 text-sm mt-1">Manage project IDs and vessel assignments.</p>
        </div>
        <div className="flex gap-3">
          <label 
            htmlFor="project-import"
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all cursor-pointer shadow-sm"
          >
            <FileSpreadsheet className="w-4 h-4 text-green-600" />
            {importing ? 'Importing...' : 'Import CSV/Excel'}
            <input 
              id="project-import"
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
            Add New Project
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
                placeholder="Search by ID, vessel, or customer..."
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
                  className="flex items-center gap-3"
                >
                  <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg">
                    {selectedIds.size} selected
                  </span>
                  <button 
                    onClick={handleBulkDelete}
                    className="flex items-center gap-2 px-4 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Selected
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
              <span>Show:</span>
              <select 
                value={itemsPerPage}
                onChange={(e) => { setItemsPerPage(e.target.value === 'all' ? 'all' : parseInt(e.target.value)); setCurrentPage(1); }}
                className="bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-[#FDB913]"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value="all">All</option>
              </select>
            </div>
            <div className="h-4 w-px bg-slate-200 mx-1"></div>
            <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-400">
              <Filter className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-4 w-10">
                  <input 
                    type="checkbox"
                    checked={selectedIds.size === paginatedProjects.length && paginatedProjects.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-[#FDB913] focus:ring-[#FDB913]"
                  />
                </th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">ID</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Project ID</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vessel / Ship Name</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Customer</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Year</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Lead</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {paginatedProjects.map((project) => (
                <motion.tr 
                  layout
                  key={project.id}
                  className={`hover:bg-slate-50/80 transition-colors ${selectedIds.has(project.id) ? 'bg-[#FDB913]/10/30' : ''}`}
                >
                  <td className="px-6 py-4">
                    <input 
                      type="checkbox"
                      checked={selectedIds.has(project.id)}
                      onChange={() => toggleSelect(project.id)}
                      className="rounded border-slate-300 text-[#FDB913] focus:ring-[#FDB913]"
                    />
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs font-mono font-bold text-slate-400">#{project.id_siaga || '-'}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-[#FDB913]/10 rounded-lg flex items-center justify-center shrink-0">
                        <Briefcase className="w-4 h-4 text-[#FDB913]" />
                      </div>
                      <span className="text-sm font-bold text-slate-700">{project.idproject}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-slate-600 font-medium">{project.shipname}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-slate-500">{project.cust_company}</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-sm font-mono text-slate-500">{project.year}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      project.status === 'Active' ? 'bg-green-50 text-green-600' : 
                      project.status === 'Completed' ? 'bg-blue-50 text-blue-600' : 
                      'bg-slate-100 text-slate-500'
                    }`}>
                      {project.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <UserIcon className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-sm text-slate-500">{project.project_lead || '-'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => handleOpenModal(project)}
                        className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-slate-400 hover:text-[#FDB913]"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(project.id)}
                        className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
              {paginatedProjects.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center">
                        <Search className="w-6 h-6 text-slate-300" />
                      </div>
                      <p className="text-slate-400 text-sm font-medium">No projects found matching your criteria.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {itemsPerPage !== 'all' && totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/30">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Showing {(currentPage - 1) * (itemsPerPage as number) + 1} to {Math.min(currentPage * (itemsPerPage as number), totalItems)} of {totalItems} projects
            </p>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="p-2 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-30 transition-all shadow-sm"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                      currentPage === page 
                        ? 'bg-[#FDB913] text-slate-900 shadow-lg shadow-[#FDB913]/20' 
                        : 'hover:bg-white text-slate-500 border border-transparent hover:border-slate-200'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
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
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="font-display font-bold text-xl text-slate-800">
                  {editingProject ? 'Edit Project' : 'Add New Project'}
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Project ID</label>
                    <input 
                      required
                      type="text"
                      value={formData.idproject}
                      onChange={(e) => setFormData({ ...formData, idproject: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                      placeholder="e.g. DRP19DBG001/YWTS"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vessel Name</label>
                    <input 
                      required
                      type="text"
                      value={formData.shipname}
                      onChange={(e) => setFormData({ ...formData, shipname: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                      placeholder="e.g. MDI-8"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Customer Company</label>
                    <input 
                      required
                      type="text"
                      value={formData.cust_company}
                      onChange={(e) => setFormData({ ...formData, cust_company: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                      placeholder="e.g. PT. McConnell Dowell Indonesia"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Year</label>
                    <input 
                      required
                      type="number"
                      value={formData.year}
                      onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) || new Date().getFullYear() })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
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
                      <option value="Completed">Completed</option>
                      <option value="On Going">On Going</option>
                      <option value="Pending">Pending</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Project Lead</label>
                    <input 
                      type="text"
                      value={formData.project_lead}
                      onChange={(e) => setFormData({ ...formData, project_lead: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                      placeholder="e.g. JOJOK SETYAWAN"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Est. Start Date</label>
                    <input 
                      type="date"
                      value={formData.est_start}
                      onChange={(e) => setFormData({ ...formData, est_start: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Est. Finish Date</label>
                    <input 
                      type="date"
                      value={formData.est_finish}
                      onChange={(e) => setFormData({ ...formData, est_finish: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
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
                    {isLoading ? 'Saving...' : editingProject ? 'Update Project' : 'Create Project'}
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
              <h3 className="font-display font-bold text-2xl text-slate-900 mb-2">Project Added!</h3>
              <p className="text-slate-500 mb-8">
                The new project has been successfully added to the master database.
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
