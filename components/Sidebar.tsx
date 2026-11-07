'use client';

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  ShieldCheck,
  Fingerprint,
  FileCheck2,
  BadgeDollarSign,
  Ship, 
  Wrench, 
  ClipboardList, 
  ListChecks,
  SearchCheck,
  Tags,
  Bot,
  ScrollText,
  Package,
  Boxes,
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
  Shield,
  MapPin,
  Map as MapIcon,
  Layout,
  FileSpreadsheet,
  Server,
  Inbox
} from 'lucide-react';
import { useData } from '@/context/DataContext';
import { motion } from 'motion/react';

export default function Sidebar({ onTabChange }: { onTabChange: () => void }) {
  const { currentUser, canAccess } = useData();
  const location = useLocation();
  const navigate = useNavigate();

  // Groups with no menu the user may open are hidden (e.g. HSE until its menus exist).
  const navGroups = [
    {
      title: 'Main',
      items: [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard', resource: 'Dashboard' },
        { icon: Bot, label: 'AI Assistant', path: '/ai-assistant', resource: 'AI Asisten' },
      ]
    },
    {
      title: 'Marketing',
      items: [
        { icon: Briefcase, label: 'Job Order', path: '/job-order', resource: 'Job Order' },
        { icon: ClipboardList, label: 'Repair List', path: '/repair-list', resource: 'Repair List' },
        { icon: ListChecks, label: 'Item Repair List', path: '/repair-items', resource: 'Item Repair List' },
        { icon: BadgeDollarSign, label: 'Harga Acuan Marketing', path: '/marketing-price-reference', resource: 'Harga Acuan Marketing' },
      ]
    },
    {
      title: 'Facility',
      items: [
        { icon: Activity, label: 'Utility', path: '/utility', resource: 'Utility' },
        { icon: Anchor, label: 'Ship Docking', path: '/ship-docking', resource: 'Ship Docking' },
        { icon: MapIcon, label: 'Vessel Layout', path: '/vessel-layout', resource: 'Vessel Layout' },
      ]
    },
    {
      title: 'PPC',
      items: [
        { icon: FileSpreadsheet, label: 'Work Order', path: '/work-order', resource: 'Work Order' },
        { icon: ListChecks, label: 'Item Pekerjaan WO', path: '/work-order-items', resource: 'Item Pekerjaan WO' },
        { icon: Tags, label: 'Harga Acuan Jasa', path: '/price-reference', resource: 'Harga Acuan' },
        { icon: SearchCheck, label: 'Data Perlu Dicek', path: '/data-findings', resource: 'Data Perlu Dicek' },
      ]
    },
    {
      title: 'Equipment Management',
      items: [
        { icon: ClipboardList, label: 'Request', path: '/request', resource: 'Request' },
        { icon: Package, label: 'Release', path: '/release', resource: 'Release' },
        { icon: RotateCcw, label: 'Return', path: '/return', resource: 'Return' },
        { icon: Wrench, label: 'Maintenance', path: '/maintenance', resource: 'Maintenance' },
        { icon: Package, label: 'Equipment Inventory', path: '/inventory', resource: 'Inventory' },
      ]
    },
    {
      title: 'Warehouse',
      items: [
        { icon: ClipboardList, label: 'Request Material', path: '/request-material', resource: 'Request' },
        { icon: Boxes, label: 'Persediaan Material', path: '/material-stock', resource: 'Persediaan Material' },
        { icon: BarChart3, label: 'Reports', path: '/reports', resource: 'Reports' },
      ]
    },
    {
      title: 'Finance',
      items: [
        { icon: BarChart3, label: 'Financial Dashboard', path: '/financial-dashboard', resource: 'Financial Dashboard' },
      ]
    },
    {
      title: 'HSE',
      items: [
        { icon: ShieldCheck, label: 'Dashboard HSE', path: '/hse', resource: 'Dashboard HSE' },
        { icon: Fingerprint, label: 'Absensi', path: '/hse/attendance', resource: 'Data Absensi' },
        { icon: FileCheck2, label: 'Work Permit', path: '/hse/work-permits', resource: 'Data HSE' },
      ]
    },
    {
      title: 'Master Facility',
      items: [
        { icon: MapPin, label: 'Master Location', path: '/master-location', resource: 'Master Location' },
        { icon: Wrench, label: 'Master Service', path: '/master-service', resource: 'Master Service' },
        { icon: Ship, label: 'Master Equipment', path: '/master-equipment', resource: 'Master Equipment' },
        { icon: Activity, label: 'Master Dock Status', path: '/master-dock-status', resource: 'Master Dock Status' },
        { icon: Layout, label: 'Master Layout', path: '/master-layout', resource: 'Master Layout' },
      ]
    },
    {
      title: 'Master Inventory',
      items: [
        { icon: Package, label: 'Master Component', path: '/master-component', resource: 'Master Component' },
      ]
    },
    {
      title: 'Master Ship',
      items: [
        { icon: Anchor, label: 'Master Kapal', path: '/master-kapal', resource: 'Master Kapal' },
        { icon: Ship, label: 'Master Ship Type', path: '/master-ship-type', resource: 'Master Ship Type' },
      ]
    },
    {
      title: 'Master Company',
      items: [
        { icon: Truck, label: 'Master Vendor', path: '/master-vendor', resource: 'Master Vendor' },
        { icon: Building2, label: 'Master Company', path: '/master-company', resource: 'Master Company' },
      ]
    },
    {
      title: 'Master User',
      items: [
        { icon: Users, label: 'Master Employee', path: '/master-employee', resource: 'Master Employee' },
        { icon: ClipboardList, label: 'Approval Workflow', path: '/master-workflow', resource: 'Master Workflow' },
      ]
    },
    {
      title: 'Master Data Eksternal',
      items: [
        { icon: Server, label: 'API Sync Config', path: '/master-api-sync', resource: 'API Sync Config' },
        { icon: Inbox, label: 'Sumber Data Eksternal', path: '/ingest-sources', resource: 'Sumber Data Eksternal' },
        { icon: Bot, label: 'Pengaturan AI', path: '/ai-settings', resource: 'Pengaturan AI' },
        { icon: ScrollText, label: 'Log AI', path: '/ai-logs', resource: 'Log AI' },
      ]
    },
    {
      title: 'Master Config',
      items: [
        { icon: Settings, label: 'Master Configuration', path: '/master-config', resource: 'Master Configuration' },
        { icon: Shield, label: 'Role Management', path: '/master-roles', resource: 'Role Management' },
        { icon: Users, label: 'User Management', path: '/user-management', resource: 'User Management' },
      ]
    }
  ];

  const filteredGroups = navGroups.map(group => ({
    ...group,
    items: group.items.filter((item: { resource: string; adminOnly?: boolean }) =>
      item.adminOnly ? currentUser?.role === 'Admin' : canAccess(item.resource, 'view'))
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
                  (location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)) 
                    ? 'bg-[#FDB913]/10 text-[#e5a611] font-medium' 
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <item.icon className="w-5 h-5 shrink-0" />
                  <span className="text-sm text-left leading-tight break-words pr-2">{item.label}</span>
                </div>
                {(location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)) && <ChevronRight className="w-4 h-4 shrink-0" />}
              </motion.button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
