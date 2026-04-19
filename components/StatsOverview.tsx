'use client';

import React from 'react';
import { Package, ClipboardList, Wrench, AlertCircle } from 'lucide-react';
import { useData } from '@/context/DataContext';

export default function StatsOverview() {
  const { fleet, deployments } = useData();

  const totalEquipment = fleet.length;
  const activeLoans = fleet.filter(a => a.available === 'Deployed').length;
  const inMaintenance = fleet.filter(a => a.available === 'Maintenance').length;
  const damaged = fleet.filter(a => a.available === 'Damaged').length;
  const utilizationRate = totalEquipment > 0 ? Math.round((activeLoans / totalEquipment) * 100) : 0;

  const stats = [
    { 
      label: 'Total Equipment', 
      value: totalEquipment, 
      icon: Package, 
      color: 'bg-[#FDB913]/10 text-[#FDB913]',
      trend: '+2.5%',
      trendUp: true
    },
    { 
      label: 'Utilization Rate', 
      value: `${utilizationRate}%`, 
      icon: ClipboardList, 
      color: 'bg-sky-50 text-sky-600',
      trend: '+12%',
      trendUp: true
    },
    { 
      label: 'In Maintenance', 
      value: inMaintenance, 
      icon: Wrench, 
      color: 'bg-amber-50 text-amber-600',
      trend: '-5%',
      trendUp: false
    },
    { 
      label: 'Damaged Items', 
      value: damaged, 
      icon: AlertCircle, 
      color: 'bg-red-50 text-red-600',
      trend: '+1%',
      trendUp: true
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {stats.map((stat, i) => (
        <div key={i} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className={`p-3 rounded-xl ${stat.color}`}>
              <stat.icon className="w-6 h-6" />
            </div>
            <div className={`text-xs font-bold px-2 py-1 rounded-full ${stat.trendUp ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
              {stat.trend}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">{stat.label}</p>
            <h4 className="text-2xl font-display font-bold text-slate-900 mt-1">{stat.value}</h4>
          </div>
        </div>
      ))}
    </div>
  );
}
