'use client';

import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import { useData } from '@/context/DataContext';

export default function RepairHistoryChart() {
  const { deployments } = useData();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Process deployments to get returns by month
  const last6Months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    return d.toLocaleString('default', { month: 'short' });
  });

  const data = last6Months.map(month => {
    const monthDeployments = deployments.filter(dep => {
      if (!dep.return_date) return false;
      const depMonth = new Date(dep.return_date).toLocaleString('default', { month: 'short' });
      return depMonth === month;
    });

    return {
      month,
      returned: monthDeployments.filter(d => d.return_status === 'Returned').length,
      damaged: monthDeployments.filter(d => d.return_status === 'Damaged').length,
    };
  });

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col">
      <h3 className="font-display font-bold text-slate-800 mb-4">Equipment Return History</h3>
      <div className="h-[300px] w-full">
        {mounted && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRet" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#FDB913" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#FDB913" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorDam" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis 
                dataKey="month" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 11, fontWeight: 500, fill: '#64748b' }}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 11, fontWeight: 500, fill: '#64748b' }}
              />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
              />
              <Area 
                type="monotone" 
                dataKey="returned" 
                stroke="#FDB913" 
                fillOpacity={1} 
                fill="url(#colorRet)" 
                strokeWidth={2}
              />
              <Area 
                type="monotone" 
                dataKey="damaged" 
                stroke="#ef4444" 
                fillOpacity={1} 
                fill="url(#colorDam)" 
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      
      <div className="flex items-center justify-center gap-4 mt-4">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[#FDB913]"></div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Returned (OK)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-500"></div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Damaged</span>
        </div>
      </div>
    </div>
  );
}
