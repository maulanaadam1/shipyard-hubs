'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, Trash2, GripVertical, ShieldCheck, Save, RefreshCw, Info, X, Users
} from 'lucide-react';
import { useData, ApprovalWorkflow } from '@/context/DataContext';
import { api } from '@/lib/api-client';

export default function ApprovalWorkflowManagement() {
  const { workflows, fetchData, currentUser, users, dropdownConfigs } = useData();
  const [selectedModule, setSelectedModule] = useState('Equipment Loan');
  const [isLoading, setIsLoading] = useState(false);
  const [editingSteps, setEditingSteps] = useState<Partial<ApprovalWorkflow>[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  React.useEffect(() => {
    if (hasChanges) return; // Don't reset while user has unsaved changes
    const moduleSteps = workflows.filter(w => w.module === selectedModule);
    setEditingSteps(moduleSteps);
  }, [selectedModule, workflows, hasChanges]);

  const addStep = () => {
    const newStep: Partial<ApprovalWorkflow> = {
      id: Math.random().toString(16).substring(2, 10),
      module: selectedModule,
      step_order: editingSteps.length + 1,
      label: 'New Approval Step',
      role: 'Manager'
    };
    setEditingSteps([...editingSteps, newStep]);
    setHasChanges(true);
  };

  const removeStep = (id: string) => {
    setEditingSteps(editingSteps.filter(s => s.id !== id).map((s, i) => ({ ...s, step_order: i + 1 })));
    setHasChanges(true);
  };

  const updateStep = (id: string, field: string, value: any) => {
    setEditingSteps(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
    setHasChanges(true);
  };

  const getSelectedUserIds = (step: Partial<ApprovalWorkflow>): string[] => {
    try {
      if ((step as any).user_ids) return JSON.parse((step as any).user_ids);
      if (step.user_id) return [step.user_id];
    } catch {}
    return [];
  };

  const toggleUser = (stepId: string, userId: string) => {
    const step = editingSteps.find(s => s.id === stepId);
    if (!step) return;
    const current = getSelectedUserIds(step);
    const updated = current.includes(userId)
      ? current.filter(id => id !== userId)
      : [...current, userId];
    updateStep(stepId, 'user_ids', JSON.stringify(updated));
    updateStep(stepId, 'user_id', updated[0] || '');
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      await api.from('approval_workflow').delete().eq('module', selectedModule);
      const { error } = await api.from('approval_workflow').insert(
        editingSteps.map((s, idx) => ({
          id: s.id,
          module: s.module,
          step_order: idx + 1,
          label: s.label,
          role: s.role || 'Manager',
          jabatan: s.jabatan || '',
          user_id: s.user_id || '',
          user_ids: (s as any).user_ids || JSON.stringify(s.user_id ? [s.user_id] : [])
        }))
      );
      if (error) throw error;
      alert('Workflow saved successfully!');
      setHasChanges(false);
      await fetchData();
    } catch (error: any) {
      alert('Error saving workflow: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (currentUser?.role !== 'Admin') {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mb-4">
          <ShieldCheck className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-700 mb-2">Access Denied</h2>
        <p className="text-slate-400 text-sm">Only Administrators can manage approval workflows.</p>
      </div>
    );
  }

  const dropdownJabatans = dropdownConfigs
    .filter(c => c.category === 'jabatan' || c.category === 'department')
    .map(c => c.label);
  const userJabatans = users.map(u => u.jabatan).filter(Boolean) as string[];
  const uniqueJabatans = Array.from(new Set([...dropdownJabatans, ...userJabatans]));

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-2xl text-slate-800 tracking-tight">Approval Workflow Management</h2>
          <p className="text-sm text-slate-500 mt-1">Configure approval sequences. Each step can have multiple approvers.</p>
        </div>
        <div className="flex gap-3">
          {hasChanges && (
            <button onClick={handleSave} disabled={isLoading}
              className="flex items-center gap-2 px-6 py-2.5 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-all shadow-lg shadow-[#FDB913]/20">
              <Save className="w-4 h-4" />
              {isLoading ? 'Saving...' : 'Save Workflow'}
            </button>
          )}
          <button onClick={() => fetchData()}
            className="p-2.5 bg-white border border-slate-200 text-slate-500 rounded-xl hover:bg-slate-50 transition-colors shadow-sm">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Module Selector */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Select Module</h3>
            <div className="space-y-2">
              {['Equipment Loan', 'Job Order', 'Inventory'].map(m => (
                <button key={m} onClick={() => setSelectedModule(m)}
                  className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                    selectedModule === m
                      ? 'bg-[#FDB913]/10 text-[#e5a611] border border-[#FDB913]/20 shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50 border border-transparent'
                  }`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100 flex gap-3">
            <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700 leading-relaxed">
              Filter by <strong>Jabatan</strong> untuk mempersempit daftar, lalu centang nama approver yang diinginkan. Setiap langkah bisa memiliki <strong>lebih dari satu approver</strong>.
            </p>
          </div>
        </div>

        {/* Workflow Steps */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <h3 className="font-bold text-slate-800">Workflow: {selectedModule}</h3>
              <button onClick={addStep}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all shadow-sm">
                <Plus className="w-3.5 h-3.5 text-[#FDB913]" /> Add Step
              </button>
            </div>

            <div className="p-6 space-y-4">
              {editingSteps.length === 0 ? (
                <div className="py-20 text-center space-y-4">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                    <ShieldCheck className="w-8 h-8 text-slate-200" />
                  </div>
                  <div>
                    <h4 className="text-slate-800 font-bold">No Approval Steps Defined</h4>
                    <p className="text-sm text-slate-500">This module currently has no approval sequence.</p>
                  </div>
                  <button onClick={addStep}
                    className="px-6 py-2 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-all">
                    Set Initial Workflow
                  </button>
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {editingSteps.map((step, index) => {
                    const selectedIds = getSelectedUserIds(step);
                    const filteredUsers = step.jabatan
                      ? users.filter(u => u.jabatan?.trim().toLowerCase() === step.jabatan?.trim().toLowerCase())
                      : users;

                    return (
                      <motion.div key={step.id} layout
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                        className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">

                        {/* Step Header Row */}
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-[#FDB913] rounded-xl flex items-center justify-center text-slate-900 font-bold text-sm shrink-0">
                            {index + 1}
                          </div>
                          <input type="text" value={step.label}
                            onChange={e => updateStep(step.id!, 'label', e.target.value)}
                            className="flex-1 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                            placeholder="e.g. Department Head Approval" />
                          <button onClick={() => removeStep(step.id!)}
                            className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <div className="p-2 text-slate-300 cursor-grab">
                            <GripVertical className="w-4 h-4" />
                          </div>
                        </div>

                        {/* Jabatan + Multi-User Select */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Jabatan filter */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block px-1">
                              Filter Jabatan (opsional)
                            </label>
                            <select value={step.jabatan || ''}
                              onChange={e => {
                                updateStep(step.id!, 'jabatan', e.target.value);
                                updateStep(step.id!, 'user_ids', JSON.stringify([]));
                                updateStep(step.id!, 'user_id', '');
                              }}
                              className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30">
                              <option value="">-- Semua User --</option>
                              {uniqueJabatans.map(j => <option key={j} value={j}>{j}</option>)}
                            </select>
                          </div>

                          {/* Multi-select user list */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1 px-1">
                              <Users className="w-3 h-3" /> Pilih Approver(s)
                              <span className="ml-auto bg-[#FDB913]/20 text-[#e5a611] px-2 py-0.5 rounded-full font-bold">
                                {selectedIds.length} dipilih
                              </span>
                            </label>
                            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden max-h-44 overflow-y-auto">
                              {filteredUsers.length === 0 ? (
                                <p className="text-xs text-slate-400 p-4 text-center">Tidak ada user untuk jabatan ini.</p>
                              ) : (
                                filteredUsers.map(u => (
                                  <label key={u.id}
                                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors border-b border-slate-50 last:border-0 ${
                                      selectedIds.includes(u.id)
                                        ? 'bg-[#FDB913]/8 text-[#e5a611]'
                                        : 'hover:bg-slate-50 text-slate-700'
                                    }`}>
                                    <input type="checkbox" checked={selectedIds.includes(u.id)}
                                      onChange={() => toggleUser(step.id!, u.id)}
                                      className="accent-[#FDB913] w-4 h-4 shrink-0" />
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold truncate">{u.name}</p>
                                      {u.jabatan && <p className="text-[10px] text-slate-400 truncate">{u.jabatan}</p>}
                                    </div>
                                  </label>
                                ))
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Selected Chips */}
                        {selectedIds.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {selectedIds.map(uid => {
                              const u = users.find(u => u.id === uid);
                              if (!u) return null;
                              return (
                                <span key={uid}
                                  className="flex items-center gap-1.5 px-3 py-1 bg-[#FDB913]/15 text-[#c9930a] rounded-full text-xs font-bold border border-[#FDB913]/30">
                                  {u.name}
                                  <button onClick={() => toggleUser(step.id!, uid)}
                                    className="hover:text-red-500 transition-colors ml-0.5">
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>

            {editingSteps.length > 0 && (
              <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                  <span>Sequence is ready. Click "Save Workflow" to apply changes.</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
