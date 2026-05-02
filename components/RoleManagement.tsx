'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Shield, 
  Plus, 
  Save, 
  X, 
  Check, 
  ChevronRight, 
  Lock,
  Layout,
  MousePointer2,
  Trash2,
  ShieldAlert,
  Info
} from 'lucide-react';
import { useData, RoleMaster, RolePermission } from '@/context/DataContext';
import { api } from '@/lib/api-client';

const RESOURCES = [
  { id: 'Dashboard', type: 'menu' },
  { id: 'Utility', type: 'menu' },
  { id: 'Job Order', type: 'menu' },
  { id: 'Request', type: 'menu' },
  { id: 'Release', type: 'menu' },
  { id: 'Return', type: 'menu' },
  { id: 'Maintenance', type: 'menu' },
  { id: 'Inventory', type: 'menu' },
  { id: 'Reports', type: 'menu' },
  { id: 'Master Equipment', type: 'menu' },
  { id: 'Master Vendor', type: 'menu' },
  { id: 'Master Company', type: 'menu' },
  { id: 'Master Kapal', type: 'menu' },
  { id: 'Master Workflow', type: 'menu' },
  { id: 'Master Configuration', type: 'menu' },
  { id: 'User Management', type: 'menu' },
  { id: 'Role Management', type: 'menu' },
];

const ACTIONS = ['view', 'add', 'edit', 'delete', 'approve', 'import', 'export'];

export default function RoleManagement() {
  const { rolesMaster, rolePermissions, fetchData, currentUser } = useData();
  const [selectedRole, setSelectedRole] = useState<RoleMaster | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [localPermissions, setLocalPermissions] = useState<RolePermission[]>([]);

  const [formData, setFormData] = useState({
    name: '',
    description: ''
  });

  useEffect(() => {
    if (selectedRole) {
      setLocalPermissions(rolePermissions.filter(p => p.role_id === selectedRole.id));
    } else {
      setLocalPermissions([]);
    }
  }, [selectedRole, rolePermissions]);

  const handleAddRole = () => {
    setFormData({ name: '', description: '' });
    setIsModalOpen(true);
  };

  const handleSubmitRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const roleID = Math.random().toString(36).substring(2, 11);
      const { error } = await api.from('roles_master').insert([{
        id: roleID,
        name: formData.name,
        description: formData.description
      }]);

      if (error) throw error;

      // Seed default permissions for new role (all false)
      const initialPerms = [];
      for (const res of RESOURCES) {
        for (const act of ACTIONS) {
          initialPerms.push({
            role_id: roleID,
            resource: res.id,
            action: act,
            is_allowed: false
          });
        }
      }
      await api.from('role_permissions').insert(initialPerms);

      setIsModalOpen(false);
      await fetchData();
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const togglePermission = (resource: string, action: string) => {
    setLocalPermissions(prev => {
      const existing = prev.find(p => p.resource === resource && p.action === action);
      if (existing) {
        return prev.map(p => 
          (p.resource === resource && p.action === action) 
            ? { ...p, is_allowed: !p.is_allowed } 
            : p
        );
      } else {
        // Should not happen if seeded, but for safety:
        return [...prev, { id: '', role_id: selectedRole!.id, resource, action, is_allowed: true }];
      }
    });
  };

  const savePermissions = async () => {
    if (!selectedRole) return;
    setIsLoading(true);
    try {
      // Delete old and insert new (or upsert if your API supports it)
      // For simplicity in this generic handler, we delete and re-insert
      await api.from('role_permissions').delete().eq('role_id', selectedRole.id);
      
      const { error } = await api.from('role_permissions').insert(
        localPermissions.map(p => ({
          role_id: p.role_id,
          resource: p.resource,
          action: p.action,
          is_allowed: p.is_allowed
        }))
      );

      if (error) throw error;
      alert('Permissions saved successfully!');
      await fetchData();
    } catch (err: any) {
      alert('Error saving permissions: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (currentUser?.role !== 'Admin') {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-slate-700">Access Denied</h2>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-2xl text-slate-800 tracking-tight">Role & RBAC Management</h2>
          <p className="text-sm text-slate-500 mt-1">Define user roles and granular permissions for every menu and button.</p>
        </div>
        <button 
          onClick={handleAddRole}
          className="flex items-center justify-center gap-2 px-6 py-2.5 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-all shadow-lg shadow-[#FDB913]/20"
        >
          <Plus className="w-4 h-4" /> Create New Role
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Roles List */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-4">Available Roles</h3>
            <div className="space-y-1">
              {rolesMaster.map(role => (
                <button
                  key={role.id}
                  onClick={() => setSelectedRole(role)}
                  className={`w-full flex flex-col items-start px-4 py-3 rounded-xl transition-all border ${
                    selectedRole?.id === role.id 
                      ? 'bg-[#FDB913]/10 text-[#e5a611] border-[#FDB913]/20' 
                      : 'text-slate-600 hover:bg-slate-50 border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm font-bold">{role.name}</span>
                    <ChevronRight className={`w-4 h-4 ${selectedRole?.id === role.id ? 'opacity-100' : 'opacity-0'}`} />
                  </div>
                  <span className="text-[10px] text-slate-400 text-left mt-0.5 line-clamp-1">{role.description}</span>
                </button>
              ))}
            </div>
          </div>
          
          {selectedRole && (
             <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
               <div className="flex gap-2 text-blue-600 mb-2">
                 <Info className="w-4 h-4 shrink-0 mt-0.5" />
                 <span className="text-xs font-bold uppercase tracking-wider">Note</span>
               </div>
               <p className="text-[10px] text-blue-700 leading-relaxed">
                 Configure permissions for <strong>{selectedRole.name}</strong>. Remember to save changes before switching roles.
               </p>
             </div>
          )}
        </div>

        {/* Permissions Grid */}
        <div className="lg:col-span-3">
          {selectedRole ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#FDB913]/20 rounded-xl flex items-center justify-center text-[#FDB913]">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-lg text-slate-800">Permissions: {selectedRole.name}</h3>
                    <p className="text-[10px] text-slate-400 font-medium">Manage resource access and action rights</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      if (!selectedRole) return;
                      const allPerms: RolePermission[] = [];
                      RESOURCES.forEach(res => {
                        ACTIONS.forEach(act => {
                          allPerms.push({
                            id: '', // Will be handled on save
                            role_id: selectedRole.id,
                            resource: res.id,
                            action: act,
                            is_allowed: true
                          });
                        });
                      });
                      setLocalPermissions(allPerms);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-[#FDB913]/10 text-[#e5a611] rounded-xl text-xs font-bold hover:bg-[#FDB913]/20 transition-all"
                  >
                    Check All
                  </button>
                  <button 
                    onClick={savePermissions}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-5 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {isLoading ? 'Saving...' : 'Save Permissions'}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 uppercase text-[9px] font-bold tracking-wider">
                      <th className="px-6 py-4 border-b border-slate-100">Resource / Module</th>
                      {ACTIONS.map(act => (
                        <th key={act} className="px-4 py-4 border-b border-slate-100 text-center">{act}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {RESOURCES.map(res => (
                      <tr key={res.id} className="hover:bg-slate-50/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            {res.type === 'menu' ? <Layout className="w-4 h-4 text-slate-400" /> : <MousePointer2 className="w-4 h-4 text-slate-400" />}
                            <span className="text-sm font-medium text-slate-700">{res.id}</span>
                          </div>
                        </td>
                        {ACTIONS.map(act => {
                          const perm = localPermissions.find(p => p.resource === res.id && p.action === act);
                          return (
                            <td key={act} className="px-4 py-4 text-center">
                              <button
                                onClick={() => togglePermission(res.id, act)}
                                className={`w-6 h-6 rounded-md flex items-center justify-center transition-all mx-auto ${
                                  perm?.is_allowed 
                                    ? 'bg-green-100 text-green-600' 
                                    : 'bg-slate-100 text-slate-300 hover:bg-slate-200'
                                }`}
                              >
                                {perm?.is_allowed ? <Check className="w-4 h-4" /> : <Lock className="w-3 h-3" />}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl h-[400px] flex flex-col items-center justify-center text-center p-8">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-4">
                <Shield className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-slate-800 font-bold">No Role Selected</h3>
              <p className="text-sm text-slate-400 mt-2 max-w-xs">Select a role from the sidebar to view and manage its permissions.</p>
            </div>
          )}
        </div>
      </div>

      {/* Add Role Modal */}
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
              <form onSubmit={handleSubmitRole}>
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#FDB913]/20 rounded-xl flex items-center justify-center text-[#FDB913]">
                      <Shield className="w-5 h-5" />
                    </div>
                    <h3 className="font-display font-bold text-xl text-slate-800">Create New Role</h3>
                  </div>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full">
                    <X className="w-5 h-5 text-slate-500" />
                  </button>
                </div>

                <div className="p-8 space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Role Name</label>
                    <input 
                      required
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30"
                      placeholder="e.g. Operations Manager"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Description</label>
                    <textarea 
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 min-h-[100px] resize-none"
                      placeholder="What can this role do?"
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
                    {isLoading ? 'Creating...' : 'Create Role'}
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
