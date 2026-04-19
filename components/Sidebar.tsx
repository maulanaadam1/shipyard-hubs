'use client';

import React from 'react';
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
  Activity
} from 'lucide-react';
import { useData } from '@/context/DataContext';
import { motion } from 'motion/react';

export default function Sidebar({ activeTab, onTabChange }: { activeTab: string, onTabChange: (tab: string) => void }) {
  const { currentUser } = useData();

  const navGroups = [
    {
      title: 'Main',
      items: [
        { icon: LayoutDashboard, label: 'Dashboard', roles: ['Admin', 'Manager', 'Staff'] },
        { icon: Activity, label: 'Utility', roles: ['Admin', 'Manager', 'Staff'] },
        { icon: Briefcase, label: 'Job Order', roles: ['Admin', 'Manager', 'Staff'] },
      ]
    },
    {
      title: 'Equipment Management',
      items: [
        { icon: ClipboardList, label: 'Request', roles: ['Admin', 'Manager', 'Staff'] },
        { icon: Package, label: 'Release', roles: ['Admin', 'Manager'] },
        { icon: RotateCcw, label: 'Return', roles: ['Admin', 'Manager'] },
      ]
    },
    {
      title: 'Operations',
      items: [
        { icon: Wrench, label: 'Maintenance', roles: ['Admin', 'Manager'] },
        { icon: Package, label: 'Inventory', roles: ['Admin', 'Manager', 'Staff'] },
        { icon: BarChart3, label: 'Reports', roles: ['Admin', 'Manager'] },
      ]
    },
    {
      title: 'Master',
      items: [
        { icon: Ship, label: 'Master Equipment', roles: ['Admin', 'Manager'] },
        { icon: Truck, label: 'Master Vendor', roles: ['Admin', 'Manager'] },
        { icon: Building2, label: 'Master Company', roles: ['Admin', 'Manager'] },
        { icon: Anchor, label: 'Master Kapal', roles: ['Admin', 'Manager'] },
        { icon: Users, label: 'User Management', roles: ['Admin'] },
      ]
    }
  ];

  const filteredGroups = navGroups.map(group => ({
    ...group,
    items: group.items.filter(item => item.roles.includes(currentUser?.role || 'Staff'))
  })).filter(group => group.items.length > 0);

  return (
    <aside className="w-64 bg-white border-r border-slate-200 h-screen flex flex-col sticky top-0 z-40">
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
                onClick={() => onTabChange(item.label)}
                className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors ${
                  activeTab === item.label 
                    ? 'bg-[#FDB913]/10 text-[#e5a611] font-medium' 
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  <item.icon className="w-5 h-5" />
                  <span className="text-sm">{item.label}</span>
                </div>
                {activeTab === item.label && <ChevronRight className="w-4 h-4" />}
              </motion.button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
