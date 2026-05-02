'use client';

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Ship, 
  Wrench, 
  ClipboardList, 
  Package, 
  BarChart3,
  Settings,
  ChevronRight,
  RotateCcw,
  Users,
  Check,
  Building2,
  Truck,
  Anchor,
  Briefcase,
  Activity,
  Shield
} from 'lucide-react';
import { useData } from '@/context/DataContext';
import { motion } from 'motion/react';

export default function Sidebar({ onTabChange }: { onTabChange: () => void }) {
  const { currentUser, canAccess } = useData();
  const location = useLocation();
  const navigate = useNavigate();

  const navGroups = [
    {
      title: 'Main',
      items: [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard', resource: 'Dashboard' },
        { icon: Activity, label: 'Utility', path: '/utility', resource: 'Utility' },
        { icon: Briefcase, label: 'Job Order', path: '/job-order', resource: 'Job Order' },
      ]
    },
    {
      title: 'Equipment Management',
      items: [
        { icon: ClipboardList, label: 'Request', path: '/request', resource: 'Request' },
        { icon: Package, label: 'Release', path: '/release', resource: 'Release' },
        { icon: RotateCcw, label: 'Return', path: '/return', resource: 'Return' },
      ]
    },
    {
      title: 'Operations',
      items: [
        { icon: Wrench, label: 'Maintenance', path: '/maintenance', resource: 'Maintenance' },
        { icon: Package, label: 'Inventory', path: '/inventory', resource: 'Inventory' },
        { icon: BarChart3, label: 'Reports', path: '/reports', resource: 'Reports' },
      ]
    },
    {
      title: 'Master',
      items: [
        { icon: Ship, label: 'Master Equipment', path: '/master-equipment', resource: 'Master Equipment' },
        { icon: Truck, label: 'Master Vendor', path: '/master-vendor', resource: 'Master Vendor' },
        { icon: Building2, label: 'Master Company', path: '/master-company', resource: 'Master Company' },
        { icon: Anchor, label: 'Master Kapal', path: '/master-kapal', resource: 'Master Kapal' },
        { icon: ClipboardList, label: 'Approval Workflow', path: '/master-workflow', resource: 'Master Workflow' },
        { icon: Settings, label: 'Master Configuration', path: '/master-config', resource: 'Master Configuration' },
        { icon: Shield, label: 'Role Management', path: '/master-roles', resource: 'Role Management' },
        { icon: Users, label: 'User Management', path: '/user-management', resource: 'User Management' },
      ]
    }
  ];

  const filteredGroups = navGroups.map(group => ({
    ...group,
    items: group.items.filter(item => canAccess(item.resource, 'view'))
  })).filter(group => group.items.length > 0);

  return (
    <aside className="w-64 bg-white border-r border-slate-200 h-full flex flex-col z-40">
      <div className="p-6 border-bottom border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#FDB913] rounded-lg flex items-center justify-center shadow-sm">
            <Ship className="text-slate-900 w-5 h-5" />
          </div>
          <span className="font-display font-bold text-lg tracking-tight text-slate-800">Shipyard Hub</span>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-6 overflow-y-auto custom-scrollbar">
        {filteredGroups.map((group, gIdx) => (
          <div key={group.title} className="space-y-1">
            <h3 className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              {group.title}
            </h3>
            {group.items.map((item, idx) => (
              <motion.button
                key={item.label}
                whileHover={{ x: 4 }}
                onClick={() => {
                  navigate(item.path);
                  onTabChange();
                }}
                className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors ${
                  location.pathname === item.path 
                    ? 'bg-[#FDB913]/10 text-[#e5a611] font-medium' 
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  <item.icon className="w-5 h-5" />
                  <span className="text-sm">{item.label}</span>
                </div>
                {location.pathname === item.path && <ChevronRight className="w-4 h-4" />}
              </motion.button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
