'use client';

import React from 'react';
import { Briefcase, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { useData } from '@/context/DataContext';

export default function StatsOverview() {
  const { projects } = useData();

  const activeJobs = projects.filter(p => {
    const s = p.status?.toLowerCase() || '';
    return s === 'active' || s === 'in progress' || s === 'on going' || s === 'ongoing';
  }).length;

  const completedJobs = projects.filter(p =>
    p.status?.toLowerCase() === 'completed'
  ).length;

  const delayedJobs = projects.filter(p => {
    const s = p.status?.toLowerCase() || '';
    const isActive = s === 'active' || s === 'in progress' || s === 'on going' || s === 'ongoing';
    if (!isActive) return false;
    const ed = p.est_finish || p.actual_finish;
    return ed && new Date(ed).getTime() < Date.now();
  }).length;

  const totalJobs = projects.length;

  const stats = [
    {
      label: 'Total Job Orders',
      value: totalJobs,
      icon: Briefcase,
      color: 'bg-[#FDB913]/10 text-[#FDB913]',
      trend: null,
    },
    {
      label: 'Active Jobs',
      value: activeJobs,
      icon: Clock,
      color: 'bg-sky-50 text-sky-600',
      trend: null,
    },
    {
      label: 'Completed',
      value: completedJobs,
      icon: CheckCircle,
      color: 'bg-emerald-50 text-emerald-600',
      trend: null,
    },
    {
      label: 'Delayed / Overdue',
      value: delayedJobs,
      icon: AlertTriangle,
      color: 'bg-red-50 text-red-600',
      trend: null,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {stats.map((stat, i) => (
        <div key={i} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className={`p-3 rounded-xl ${stat.color}`}>
              <stat.icon className="w-6 h-6" />
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
