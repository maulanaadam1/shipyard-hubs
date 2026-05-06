'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  Plus, 
  Trash2, 
  FileUp, 
  Download, 
  Map as MapIcon, 
  CheckCircle2, 
  X,
  Maximize2,
  Layout,
  AlertCircle
} from 'lucide-react';
import { api } from '@/lib/api-client';

interface VesselLayout {
  id: string;
  name: string;
  svg_content: string;
  viewbox: string;
  is_default: boolean;
  location_id?: string;
  created_at: string;
}

export default function MasterLayout() {
  const [layouts, setLayouts] = useState<VesselLayout[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [selectedLayout, setSelectedLayout] = useState<VesselLayout | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [svgContent, setSvgContent] = useState('');
  const [viewbox, setViewbox] = useState('0 0 1200 800');
  const [isDefault, setIsDefault] = useState(false);
  const [locationId, setLocationId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchLayouts();
    fetchLocations();
  }, []);

  const fetchLayouts = async () => {
    setIsLoading(true);
    const { data, error } = await api.from('vessel_layouts').select('*').order('created_at', { ascending: false });
    if (!error && data) {
      setLayouts(data);
    }
    setIsLoading(false);
  };

  const fetchLocations = async () => {
    const { data } = await api.from('master_locations').select('*');
    if (data) setLocations(data);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'image/svg+xml' && !file.name.endsWith('.svg')) {
      alert('Please upload an SVG file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setSvgContent(content);
      
      // Try to extract viewbox
      const viewboxMatch = content.match(/viewBox=["']([^"']+)["']/i);
      if (viewboxMatch) {
        setViewbox(viewboxMatch[1]);
      }
      
      if (!name) {
        setName(file.name.replace('.svg', ''));
      }
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !svgContent) return;

    setIsSubmitting(true);
    const payload = {
      id: crypto.randomUUID(),
      name,
      svg_content: svgContent,
      viewbox,
      is_default: isDefault ? 1 : 0,
      location_id: locationId || null
    };

    const { error } = await api.from('vessel_layouts').insert(payload);
    
    if (error) {
      alert('Error saving layout: ' + error.message);
    } else {
      // If setting as default, unset others (simplified frontend-side)
      if (isDefault) {
        const otherIds = layouts.filter(l => l.is_default).map(l => l.id);
        for (const id of otherIds) {
          await api.from('vessel_layouts').update({ is_default: 0 }).eq('id', id);
        }
      }
      
      setIsModalOpen(false);
      resetForm();
      fetchLayouts();
    }
    setIsSubmitting(false);
  };

  const resetForm = () => {
    setName('');
    setSvgContent('');
    setViewbox('0 0 1200 800');
    setIsDefault(false);
    setLocationId('');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this layout?')) return;
    
    const { error } = await api.from('vessel_layouts').delete().eq('id', id);
    if (error) {
      alert('Error deleting layout: ' + error.message);
    } else {
      fetchLayouts();
    }
  };

  const handleSetDefault = async (layout: VesselLayout) => {
    setIsLoading(true);
    // 1. Reset all to 0
    await api.from('vessel_layouts').update({ is_default: 0 });
    // 2. Set this one to 1
    await api.from('vessel_layouts').update({ is_default: 1 }).eq('id', layout.id);
    fetchLayouts();
  };

  const downloadSVG = (layout: VesselLayout) => {
    const blob = new Blob([layout.svg_content], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${layout.name}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredLayouts = layouts.filter(l => 
    l.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-8 space-y-8 min-h-screen bg-slate-50/50">
      {/* Header Section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h2 className="font-display font-bold text-3xl text-slate-800 tracking-tight">Master Layout</h2>
          <p className="text-sm text-slate-500 mt-1">Manage and upload SVG floor plans for Vessel Layout visualization.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-full lg:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search layouts..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 shadow-sm transition-all"
            />
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-6 py-2.5 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-all shadow-lg shadow-[#FDB913]/20 shrink-0"
          >
            <Plus className="w-4 h-4" /> Upload Layout
          </button>
        </div>
      </div>

      {/* Grid List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {isLoading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-[32px] border border-slate-200 h-64 animate-pulse" />
          ))
        ) : filteredLayouts.map((layout) => (
          <motion.div 
            key={layout.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-[32px] border border-slate-200 overflow-hidden shadow-sm hover:shadow-xl transition-all group flex flex-col"
          >
            {/* SVG Preview Container */}
            <div className="h-40 bg-slate-100 relative overflow-hidden flex items-center justify-center p-4">
               <div 
                  className="w-full h-full opacity-50 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none"
                  dangerouslySetInnerHTML={{ __html: layout.svg_content.replace(/<svg/, '<svg style="width:100%;height:100%"') }}
               />
               <div className="absolute inset-0 bg-gradient-to-t from-slate-900/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center p-4">
                  <button 
                    onClick={() => { setSelectedLayout(layout); setIsPreviewOpen(true); }}
                    className="flex items-center gap-2 px-4 py-2 bg-white/90 backdrop-blur-md rounded-full text-[10px] font-bold text-slate-700 shadow-lg hover:bg-white"
                  >
                    <Maximize2 className="w-3 h-3" /> Preview Full
                  </button>
               </div>
               {layout.is_default && (
                 <div className="absolute top-4 right-4 px-2 py-1 bg-teal-500 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest flex items-center gap-1 shadow-sm">
                   <CheckCircle2 className="w-3 h-3" /> Default
                 </div>
               )}
            </div>

            <div className="p-6 flex-1 flex flex-col">
              <h3 className="font-bold text-slate-800 mb-1 truncate">{layout.name}</h3>
              <p className="text-[10px] text-slate-400 font-mono mb-2">Viewbox: {layout.viewbox}</p>
              {layout.location_id && (
                <div className="flex items-center gap-1.5 text-slate-500 mb-4">
                  <MapPin className="w-3 h-3" />
                  <span className="text-[10px] font-medium">{locations.find(l => l.id === layout.location_id)?.name || 'Unknown Location'}</span>
                </div>
              )}
              {!layout.location_id && (
                <div className="h-4 mb-4" /> // Spacer
              )}
              
              <div className="mt-auto flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => downloadSVG(layout)}
                    title="Download SVG"
                    className="p-2.5 bg-slate-50 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => handleDelete(layout.id)}
                    title="Delete Layout"
                    className="p-2.5 bg-slate-50 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {!layout.is_default && (
                  <button 
                    onClick={() => handleSetDefault(layout)}
                    className="px-4 py-2 bg-slate-50 text-slate-600 rounded-xl text-[10px] font-bold hover:bg-slate-100 transition-all uppercase tracking-wider"
                  >
                    Set Default
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        ))}

        {!isLoading && filteredLayouts.length === 0 && (
          <div className="col-span-full py-20 text-center">
             <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
               <Layout className="w-8 h-8" />
             </div>
             <h3 className="font-bold text-slate-800">No layouts found</h3>
             <p className="text-sm text-slate-500 mt-1">Upload your first SVG layout to get started.</p>
          </div>
        )}
      </div>

      {/* Upload Modal */}
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
              className="relative w-full max-w-xl bg-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col border border-slate-200"
            >
              <form onSubmit={handleSubmit}>
                <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-[#FDB913]/10 rounded-2xl flex items-center justify-center text-[#e5a611]">
                      <FileUp className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-2xl text-slate-800 tracking-tight">Upload SVG Layout</h3>
                      <p className="text-xs text-slate-500">Add a new floor plan for vessel positioning.</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all">
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="p-10 space-y-8">
                  {/* File Dropzone */}
                  {!svgContent ? (
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-200 rounded-[32px] p-12 text-center hover:border-[#FDB913]/50 hover:bg-[#FDB913]/5 transition-all cursor-pointer group"
                    >
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileUpload} 
                        accept=".svg" 
                        className="hidden" 
                      />
                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                        <FileUp className="w-8 h-8 text-slate-300 group-hover:text-[#FDB913]" />
                      </div>
                      <h4 className="font-bold text-slate-700">Click to upload SVG</h4>
                      <p className="text-xs text-slate-400 mt-2">Maximum file size 5MB. Ensure the SVG contains valid viewBox.</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="p-4 bg-teal-50 border border-teal-100 rounded-2xl flex items-center gap-3">
                         <CheckCircle2 className="w-5 h-5 text-teal-500" />
                         <span className="text-sm font-bold text-teal-700">SVG Loaded successfully</span>
                         <button type="button" onClick={() => { setSvgContent(''); fileInputRef.current?.click(); }} className="ml-auto text-xs font-bold text-teal-600 hover:underline">Change File</button>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block px-1">Layout Name</label>
                          <input 
                            type="text" 
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Workshop Area West"
                            className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none focus:ring-4 focus:ring-[#FDB913]/10 focus:border-[#FDB913] transition-all"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block px-1">Bind to Location (Optional)</label>
                          <select 
                            value={locationId}
                            onChange={(e) => setLocationId(e.target.value)}
                            className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none focus:ring-4 focus:ring-[#FDB913]/10 focus:border-[#FDB913] transition-all appearance-none"
                          >
                            <option value="">No location binding (Global)</option>
                            {locations.map(loc => (
                              <option key={loc.id} value={loc.id}>{loc.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block px-1">ViewBox</label>
                            <input 
                              type="text" 
                              required
                              value={viewbox}
                              onChange={(e) => setViewbox(e.target.value)}
                              className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-mono outline-none focus:ring-4 focus:ring-[#FDB913]/10"
                            />
                          </div>
                          <div className="flex items-center gap-3 px-4 h-[58px] mt-6">
                            <input 
                              type="checkbox" 
                              id="is_default"
                              checked={isDefault}
                              onChange={(e) => setIsDefault(e.target.checked)}
                              className="w-5 h-5 rounded-lg border-slate-300 text-[#FDB913] focus:ring-[#FDB913]"
                            />
                            <label htmlFor="is_default" className="text-sm font-bold text-slate-700">Set as Default</label>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-8 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-8 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-500 hover:bg-slate-100 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={isSubmitting || !svgContent}
                    className="px-10 py-3 bg-[#FDB913] text-slate-900 rounded-2xl text-sm font-bold hover:bg-[#e5a611] disabled:opacity-50 transition-all shadow-lg shadow-[#FDB913]/20"
                  >
                    {isSubmitting ? 'Saving...' : 'Save Layout'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Full Preview Modal */}
      <AnimatePresence>
        {isPreviewOpen && selectedLayout && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-8">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPreviewOpen(false)}
              className="absolute inset-0 bg-slate-900/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full h-full bg-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                 <div className="flex items-center gap-3">
                    <MapIcon className="w-5 h-5 text-[#FDB913]" />
                    <h3 className="font-bold text-xl text-slate-800">{selectedLayout.name}</h3>
                 </div>
                 <button onClick={() => setIsPreviewOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all">
                    <X className="w-6 h-6" />
                 </button>
              </div>
              <div className="flex-1 bg-slate-100 flex items-center justify-center p-12 overflow-auto">
                 <div 
                    className="w-full h-full max-w-4xl"
                    dangerouslySetInnerHTML={{ __html: selectedLayout.svg_content.replace(/<svg/, `<svg style="width:100%;height:100%" viewBox="${selectedLayout.viewbox}"`) }}
                 />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
