'use client';

import React, { useState } from 'react';
import { 
  Search, 
  Settings,
  ChevronLeft,
  ChevronRight,
  Wrench
} from 'lucide-react';
import { useData } from '@/context/DataContext';

export default function MasterService() {
  const { services } = useData();
  const [searchTerm, setSearchTerm] = useState('');

  // Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Filter & Pagination Logic
  const filteredServices = (services || []).filter(s => 
    s.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.code?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredServices.length / itemsPerPage);
  const currentServices = filteredServices.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-800">Master Services</h1>
          <p className="text-sm text-slate-500 mt-1">Data master tipe layanan docking yang disinkronisasi dari API</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-4 justify-between bg-slate-50/50">
          <div className="relative max-w-md w-full">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Cari layanan (berdasarkan nama atau kode)..."
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
              <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase font-bold tracking-wider border-b border-slate-200">
                <th className="px-6 py-4 w-12 text-center">No</th>
                <th className="px-6 py-4">Kode</th>
                <th className="px-6 py-4">Nama Layanan (Docking Type)</th>
                <th className="px-6 py-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="text-sm text-slate-700 divide-y divide-slate-100">
              {currentServices.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center">
                      <Settings className="w-12 h-12 text-slate-200 mb-3" />
                      <p className="font-medium">Tidak ada data services</p>
                      <p className="text-xs mt-1">Pastikan Anda telah melakukan API Sync untuk Services</p>
                    </div>
                  </td>
                </tr>
              ) : (
                currentServices.map((service, idx) => (
                  <tr key={service.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-6 py-4 text-center">
                      <span className="text-xs font-bold text-slate-400">
                        {(currentPage - 1) * itemsPerPage + idx + 1}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Wrench className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-mono font-bold text-slate-600">{service.code}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-800">
                      {service.name}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={'px-3 py-1 text-[10px] font-bold rounded-full uppercase border transition-all ' + (
                        service.status === 'Active' 
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      )}>
                        {service.status || 'Active'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Menampilkan <span className="font-bold text-slate-700">{currentServices.length}</span> dari <span className="font-bold text-slate-700">{filteredServices.length}</span> data
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
    </div>
  );
}
