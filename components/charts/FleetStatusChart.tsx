'use client';

import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

import { useData } from '@/context/DataContext';

export default function FleetStatusChart() {
  const { fleet } = useData();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const stats = {
    Available: fleet.filter(a => a.available === 'Available').length,
    Deployed: fleet.filter(a => a.available === 'Deployed').length,
    Maintenance: fleet.filter(a => a.available === 'Maintenance').length,
    Damaged: fleet.filter(a => a.available === 'Damaged').length,
  };

  const data = [
    { name: 'Available', value: stats.Available, color: '#FDB913' }, // teal-600
    { name: 'Deployed', value: stats.Deployed, color: '#0ea5e9' }, // sky-500
    { name: 'Maintenance', value: stats.Maintenance, color: '#f59e0b' }, // amber-500
    { name: 'Damaged', value: stats.Damaged, color: '#ef4444' }, // red-500
  ].filter(d => d.value > 0);

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col">
      <h3 className="font-display font-bold text-slate-800 mb-4">Fleet Status & Health Overview</h3>
      <div className="h-[300px] w-full">
        {mounted && (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={5}
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
              />
              <Legend 
                verticalAlign="bottom" 
                height={36}
                iconType="circle"
                formatter={(value) => <span className="text-xs font-medium text-slate-600">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
