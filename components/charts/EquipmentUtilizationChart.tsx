'use client';

import React, { useMemo } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  LabelList
} from 'recharts';
import { useData } from '@/context/DataContext';

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white p-4 border border-slate-200 shadow-xl rounded-2xl">
        <p className="font-bold text-slate-800 mb-2">{data.name}</p>
        <div className="space-y-1">
          <p className="text-xs text-slate-500 flex justify-between gap-8">
            Utilization: <span className="font-bold text-[#FDB913]">{data.utilization}%</span>
          </p>
          <p className="text-xs text-slate-500 flex justify-between gap-8">
            Deployed: <span className="font-bold text-slate-700">{data.deployed}</span>
          </p>
          <p className="text-xs text-slate-500 flex justify-between gap-8">
            Maintenance: <span className="font-bold text-amber-600">{data.maintenance}</span>
          </p>
          <p className="text-xs text-slate-500 flex justify-between gap-8">
            Available: <span className="font-bold text-slate-400">{data.available}</span>
          </p>
          <div className="pt-1 mt-1 border-t border-slate-100">
            <p className="text-[10px] text-slate-400 flex justify-between">
              Total Assets: <span>{data.total}</span>
            </p>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

export default function EquipmentUtilizationChart() {
  const { fleet } = useData();

  const chartData = useMemo(() => {
    const categories = Array.from(new Set(fleet.map(item => item.type)));
    
    return categories.map(category => {
      const itemsInCategory = fleet.filter(item => item.type === category);
      const total = itemsInCategory.length;
      const deployed = itemsInCategory.filter(item => item.available === 'Deployed').length;
      const maintenance = itemsInCategory.filter(item => item.available === 'Maintenance').length;
      const available = itemsInCategory.filter(item => item.available === 'Available').length;
      
      const utilizationRate = total > 0 ? Math.round((deployed / total) * 100) : 0;

      return {
        name: category,
        utilization: utilizationRate,
        total,
        deployed,
        maintenance,
        available
      };
    }).sort((a, b) => b.utilization - a.utilization);
  }, [fleet]);

  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="font-display font-bold text-lg text-slate-800">Equipment Utilization</h3>
          <p className="text-xs text-slate-500">Utilization rate by equipment category</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-[#FDB913]"></div>
            <span className="text-[10px] font-bold text-slate-400 uppercase">Utilization %</span>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
            <XAxis type="number" hide domain={[0, 100]} />
            <YAxis 
              dataKey="name" 
              type="category" 
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fontWeight: 600, fill: '#64748b' }}
              width={80}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
            <Bar 
              dataKey="utilization" 
              radius={[0, 4, 4, 0]} 
              barSize={20}
            >
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.utilization > 70 ? '#FDB913' : entry.utilization > 40 ? '#0ea5e9' : '#94a3b8'} 
                />
              ))}
              <LabelList 
                dataKey="utilization" 
                position="right" 
                formatter={(val: any) => `${val}%`}
                style={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
