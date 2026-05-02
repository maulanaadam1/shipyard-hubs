'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  UserPlus, 
  Shield, 
  Mail, 
  Trash2, 
  Edit2, 
  X, 
  Check,
  Search,
  MoreVertical,
  Plus
} from 'lucide-react';
import { useData, User } from '@/context/DataContext';
import { api } from '@/lib/api-client';

export default function UserManagement() {
  const { users, setUsers, currentUser, dropdownConfigs, rolesMaster } = useData();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);

  const ALL_RESOURCES = [
    'Dashboard', 'Utility', 'Job Order', 'Request', 'Release', 'Return', 
    'Maintenance', 'Inventory', 'Reports', 'Master Equipment', 
    'Master Vendor', 'Master Company', 'Master Kapal', 'Master Workflow', 
    'Master Configuration', 'User Management', 'Role Management'
  ];
  const ALL_ACTIONS = ['view', 'add', 'edit', 'delete', 'approve', 'import', 'export'];
  
  const SUGGESTED_PERMISSIONS = ALL_RESOURCES.flatMap(res => 
    ALL_ACTIONS.map(act => `${res}:${act}`)
  );

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    username: '',
    password: '',
    jabatan: '',
    city: '',
    branch: '',
    department: '',
    whatsapp: '',
    roles: '',
    extra_roles: '',
    role: 'Staff' as 'Admin' | 'Manager' | 'Staff'
  });

  const filteredUsers = users.filter(user => 
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const openModal = (user: User | null = null) => {
    if (user) {
      setEditingUser(user);
      setFormData({ 
        name: user.name, 
        email: user.email, 
        username: user.username || '',
        password: '', 
        role: user.role,
        jabatan: user.jabatan || '',
        city: user.city || '',
        branch: user.branch || '',
        department: user.department || '',
        whatsapp: user.whatsapp || '',
        roles: user.roles || '',
        extra_roles: user.extra_roles || ''
      });
    } else {
      setEditingUser(null);
      setFormData({ 
        name: '', 
        email: '', 
        username: '',
        password: '', 
        role: 'Staff',
        jabatan: '',
        city: '',
        branch: '',
        department: '',
        whatsapp: '',
        roles: '',
        extra_roles: ''
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    let errorMsg = '';
    if (editingUser) {
      const defaultAdminUsername = import.meta.env.VITE_DEFAULT_ADMIN_USERNAME || 'superadmin';
      if ((editingUser.email === import.meta.env.VITE_DEFAULT_ADMIN_EMAIL || editingUser.email === `${defaultAdminUsername}@shipyard.local` || editingUser.name === 'Super Admin') && formData.role !== 'Admin') {
        alert("You cannot change the role of the default administrator.");
        return;
      }
      const { error: updateError } = await api.from('profiles')
        .update({
          name: formData.name,
          email: formData.email,
          username: formData.username,
          role: formData.role,
          jabatan: formData.jabatan,
          city: formData.city,
          branch: formData.branch,
          department: formData.department,
          whatsapp: formData.whatsapp,
          roles: formData.roles,
          extra_roles: formData.extra_roles,
          ...(formData.password ? { password: formData.password } : {})
        })
        .eq('id', editingUser.id);
      if (updateError) errorMsg = updateError.message;
    } else {
      const { error: insertError } = await api.from('profiles').insert([formData]);
      if (insertError) errorMsg = insertError.message;
      else {
        setIsModalOpen(false);
        setShowSuccessModal(true);
      }
    }

    if (errorMsg) {
      console.error('Error saving user:', errorMsg);
      alert('Error: ' + errorMsg);
    } else {
      setIsModalOpen(false);
    }
  };

  const handleDelete = async (id: string, email: string, name: string) => {
    if (id === currentUser?.id) {
      alert("You cannot delete your own account.");
      return;
    }
    const defaultAdminUsername = import.meta.env.VITE_DEFAULT_ADMIN_USERNAME || 'superadmin';
    if (email === import.meta.env.VITE_DEFAULT_ADMIN_EMAIL || email === `${defaultAdminUsername}@shipyard.local` || name === 'Super Admin') {
      alert("You cannot delete the default administrator account.");
      return;
    }
    if (confirm('Are you sure you want to delete this user profile?')) {
      const { error } = await api.from('profiles').delete().eq('id', id);
      if (error) {
        console.error('Error deleting profile from Supabase:', error.message);
        alert('Error deleting: ' + error.message);
      }
    }
  };

  if (currentUser?.role !== 'Admin') {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
            <Shield className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-800">Access Denied</h2>
          <p className="text-slate-500 max-w-xs mx-auto">
            Only administrators have permission to manage users and roles.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-2xl text-slate-800 tracking-tight">User Management</h2>
          <p className="text-sm text-slate-500 mt-1">Manage platform users, roles, and access permissions.</p>
        </div>
        <button 
          onClick={() => openModal()}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-colors shadow-lg shadow-[#FDB913]/20 w-full lg:w-auto"
        >
          <UserPlus className="w-4 h-4" /> Add New User
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <div className="relative max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search users..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                <th className="px-6 py-4 border-b border-slate-100">User</th>
                <th className="px-6 py-4 border-b border-slate-100">Department & Position</th>
                <th className="px-6 py-4 border-b border-slate-100">City & Branch</th>
                <th className="px-6 py-4 border-b border-slate-100">WhatsApp</th>
                <th className="px-6 py-4 border-b border-slate-100">Role</th>
                <th className="px-6 py-4 border-b border-slate-100 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#FDB913]/20 rounded-full flex items-center justify-center text-[#e5a611] font-bold text-sm">
                        {user.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-800">{user.name}</p>
                        <div className="flex flex-col">
                          <p className="text-xs text-slate-500">{user.email}</p>
                          {user.username && <p className="text-[10px] text-indigo-500 font-mono">@{user.username}</p>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-slate-700">{user.department || '-'}</p>
                    <p className="text-xs text-slate-500">{user.jabatan || '-'}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-slate-700">{user.city || '-'}</p>
                    <p className="text-xs text-slate-500">{user.branch || '-'}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-slate-600 font-medium">{user.whatsapp || '-'}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {user.roles?.split(',').filter(Boolean).map((roleName, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-purple-50 text-purple-700 border-purple-100">
                          <Shield className="w-3 h-3" /> {roleName}
                        </span>
                      ))}
                      {!user.roles && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-slate-50 text-slate-400 border-slate-100">
                          No Role
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => openModal(user)}
                        className="p-2 text-slate-400 hover:text-[#FDB913] hover:bg-[#FDB913]/10 rounded-lg transition-all"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(user.id, user.email, user.name)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Modal */}
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
              className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <form onSubmit={handleSubmit}>
                <div className="sticky top-0 z-20 p-6 border-b border-slate-100 flex items-center justify-between bg-white/80 backdrop-blur-md">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#FDB913]/20 rounded-xl flex items-center justify-center text-[#FDB913]">
                      <Users className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-display font-bold text-xl text-slate-800">
                        {editingUser ? 'Edit User Profile' : 'Create New User'}
                      </h3>
                      <p className="text-xs text-slate-500">Configure access levels and permissions</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>

                <div className="p-8 space-y-8">
                  {/* Basic Info Group */}
                  <div className="space-y-4">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Basic Information</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase">Full Name</label>
                        <input 
                          required
                          type="text"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                          placeholder="e.g. John Doe"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase">Email Address</label>
                        <input 
                          required
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                          placeholder="john@example.com"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase">Username</label>
                        <input 
                          required
                          type="text"
                          value={formData.username}
                          onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/\s+/g, '') })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                          placeholder="e.g. jdoe"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase">
                          {editingUser ? 'New Password' : 'Initial Password'}
                        </label>
                        <input 
                          required={!editingUser}
                          type="password"
                          value={formData.password}
                          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                          placeholder={editingUser ? "Leave blank to keep current" : "Set user password"}
                          minLength={6}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Organization Group */}
                  <div className="space-y-4">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Organization & Contact</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase">Department</label>
                        <select 
                          required
                          value={formData.department}
                          onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                        >
                          <option value="">Select Department</option>
                          {dropdownConfigs
                            .filter(c => c.category === 'departments' && c.is_active)
                            .map(c => (
                              <option key={c.id} value={c.value}>{c.label}</option>
                            ))
                          }
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase">Position (Jabatan)</label>
                        <select 
                          value={formData.jabatan}
                          onChange={(e) => setFormData({ ...formData, jabatan: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                        >
                          <option value="">Select Position</option>
                          {dropdownConfigs
                            .filter(c => c.category === 'positions' && c.is_active)
                            .map(c => (
                              <option key={c.id} value={c.value}>{c.label}</option>
                            ))
                          }
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase">Branch Location</label>
                        <input 
                          type="text"
                          value={formData.branch}
                          onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                          placeholder="e.g. Batam"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase">WhatsApp / Phone</label>
                        <input 
                          type="text"
                          value={formData.whatsapp}
                          onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                          placeholder="e.g. 0812345678"
                        />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">City</label>
                        <input 
                          type="text"
                          value={formData.city}
                          onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                          placeholder="e.g. Jakarta"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Access Group */}
                  <div className="space-y-4">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Roles & Permissions</h4>
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Assigned Roles</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200">
                          {rolesMaster.map((role) => {
                            const isSelected = formData.roles.split(',').includes(role.name);
                            return (
                              <label key={role.id} className="flex items-center gap-3 cursor-pointer group">
                                <div className="relative flex items-center">
                                  <input 
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      let currentRoles = formData.roles.split(',').filter(Boolean);
                                      if (e.target.checked) {
                                        currentRoles.push(role.name);
                                      } else {
                                        currentRoles = currentRoles.filter(r => r !== role.name);
                                      }
                                      setFormData({ ...formData, roles: currentRoles.join(',') });
                                    }}
                                    className="w-5 h-5 rounded-lg border-slate-300 text-[#FDB913] focus:ring-[#FDB913]/30"
                                  />
                                </div>
                                <span className={`text-xs font-bold transition-colors ${isSelected ? 'text-slate-800' : 'text-slate-400 group-hover:text-slate-600'}`}>
                                  {role.name}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2 relative">
                        <label className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
                          <span>Specific Permissions Override</span>
                          <span className="text-[10px] text-slate-400 normal-case font-medium italic">Extra access beyond roles</span>
                        </label>
                        <div className="relative flex flex-wrap gap-2 p-3 bg-slate-50 border border-slate-200 rounded-2xl min-h-[100px] focus-within:ring-2 focus-within:ring-[#FDB913]/30 focus-within:border-[#FDB913] transition-all">
                          {formData.extra_roles.split(',').filter(Boolean).map((tag, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-[#FDB913] text-slate-900 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm">
                              {tag}
                              <button 
                                type="button"
                                onClick={() => {
                                  const newTags = formData.extra_roles.split(',').filter(t => t !== tag).join(',');
                                  setFormData({ ...formData, extra_roles: newTags });
                                }}
                                className="hover:text-red-600 transition-colors"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                          <input 
                            type="text"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onFocus={() => setIsInputFocused(true)}
                            onBlur={() => setTimeout(() => setIsInputFocused(false), 200)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && tagInput.trim()) {
                                e.preventDefault();
                                const currentTags = formData.extra_roles.split(',').filter(Boolean);
                                if (!currentTags.includes(tagInput.trim())) {
                                  setFormData({ ...formData, extra_roles: [...currentTags, tagInput.trim()].join(',') });
                                }
                                setTagInput('');
                              }
                            }}
                            className="flex-1 bg-transparent border-none outline-none text-sm min-w-[120px]"
                            placeholder="Type to search permissions..."
                          />
                          {isInputFocused && (
                            <div className="mt-2 p-2 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-48 overflow-y-auto z-[100] absolute w-full left-0 top-full">
                              <p className="text-[10px] font-bold text-slate-400 uppercase px-2 mb-1">Available Permissions</p>
                              {SUGGESTED_PERMISSIONS
                                .filter(perm => perm.toLowerCase().includes(tagInput.toLowerCase()))
                                .slice(0, 20)
                                .map(perm => (
                                  <button
                                    key={perm}
                                    type="button"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      const currentTags = formData.extra_roles.split(',').filter(Boolean);
                                      if (!currentTags.includes(perm)) {
                                        setFormData({ ...formData, extra_roles: [...currentTags, perm].join(',') });
                                      }
                                      setTagInput('');
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 rounded-lg transition-colors text-slate-600 font-medium flex items-center justify-between group"
                                  >
                                    <span>{perm}</span>
                                    <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 text-[#FDB913]" />
                                  </button>
                                ))
                              }
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="sticky bottom-0 z-20 p-6 border-t border-slate-100 bg-white/80 backdrop-blur-md flex justify-end gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="px-10 py-2.5 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-colors shadow-lg shadow-[#FDB913]/20"
                  >
                    {editingUser ? 'Save Changes' : 'Create User'}
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
              <h3 className="font-display font-bold text-2xl text-slate-900 mb-2">User Created!</h3>
              <p className="text-slate-500 mb-8">
                The new user account has been successfully registered. You can now share the credentials with them.
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
