'use client';

import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie
} from 'recharts';
import { useData } from '@/context/DataContext';
import { 
  Activity, 
  TrendingUp, 
  Clock, 
  Zap, 
  ArrowUpRight, 
  ArrowDownRight,
  Filter,
  Download
} from 'lucide-react';

export default function UtilityDashboard() {
  const { fleet, deployments } = useData();
  const [timeRange, setTimeRange] = useState('This Month');

  // Calculate overall utilization
  const totalEquipment = fleet.length;
  const deployedCount = fleet.filter(a => a.available === 'Deployed').length;
  const utilizationRate = totalEquipment > 0 ? Math.round((deployedCount / totalEquipment) * 100) : 0;

  // Category-wise utilization
  const categoryData = useMemo(() => {
    const categories = Array.from(new Set(fleet.map(item => item.type)));
    return categories.map(cat => {
      const items = fleet.filter(i => i.type === cat);
      const deployed = items.filter(i => i.available === 'Deployed').length;
      return {
        name: cat,
        utilization: items.length > 0 ? Math.round((deployed / items.length) * 100) : 0,
        total: items.length,
        active: deployed
      };
    }).sort((a, b) => b.utilization - a.utilization);
  }, [fleet]);

  // Mock historical data for trend
  const trendData = [
    { name: 'Mon', rate: 65 },
    { name: 'Tue', rate: 68 },
    { name: 'Wed', rate: 75 },
    { name: 'Thu', rate: 72 },
    { name: 'Fri', rate: 80 },
    { name: 'Sat', rate: 55 },
    { name: 'Sun', rate: 45 },
  ];

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-slate-800 tracking-tight">Equipment Utility Analytics</h1>
          <p className="text-slate-500 text-sm mt-1">Real-time utilization tracking and performance metrics.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
            {['This Week', 'This Month', 'This Year'].map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  timeRange === range 
                    ? 'bg-[#FDB913] text-slate-900 shadow-md' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
          <button className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-[#FDB913] transition-colors shadow-sm">
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Overall Utilization" 
          value={`${utilizationRate}%`} 
          icon={Activity} 
          trend="+5.2%" 
          trendUp={true}
          color="teal"
        />
        <StatCard 
          title="Active Assets" 
          value={deployedCount} 
          icon={Zap} 
          trend="+12" 
          trendUp={true}
          color="sky"
        />
        <StatCard 
          title="Avg. Deployment" 
          value="14 Days" 
          icon={Clock} 
          trend="-2 Days" 
          trendUp={true}
          color="amber"
        />
        <StatCard 
          title="Efficiency Score" 
          value="88/100" 
          icon={TrendingUp} 
          trend="+3%" 
          trendUp={true}
          color="indigo"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Utilization Chart */}
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="font-display font-bold text-lg text-slate-800">Utilization Trend</h3>
              <p className="text-xs text-slate-500">Daily average utilization rate</p>
            </div>
          </div>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="colorRate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FDB913" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#FDB913" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: '#94a3b8' }} 
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: '#94a3b8' }} 
                  domain={[0, 100]}
                  tickFormatter={(val) => `${val}%`}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="rate" 
                  stroke="#FDB913" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorRate)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
          <h3 className="font-display font-bold text-lg text-slate-800 mb-6">Category Utility</h3>
          <div className="space-y-6">
            {categoryData.slice(0, 5).map((cat, i) => (
              <div key={i} className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-bold text-slate-700">{cat.name}</span>
                  <span className="text-[#FDB913] font-bold">{cat.utilization}%</span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${cat.utilization}%` }}
                    transition={{ duration: 1, delay: i * 0.1 }}
                    className={`h-full rounded-full ${
                      cat.utilization > 80 ? 'bg-[#FDB913]' : 
                      cat.utilization > 50 ? 'bg-sky-500' : 'bg-slate-400'
                    }`}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  <span>{cat.active} Active</span>
                  <span>{cat.total} Total</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="font-display font-bold text-lg text-slate-800">Asset Efficiency Ranking</h3>
          <button className="text-xs font-bold text-[#FDB913] hover:text-[#e5a611] flex items-center gap-1">
            View All Assets <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50/50">
                <th className="px-8 py-4">Asset Name</th>
                <th className="px-8 py-4">Category</th>
                <th className="px-8 py-4 text-center">Deployments</th>
                <th className="px-8 py-4 text-center">Utilization</th>
                <th className="px-8 py-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fleet.slice(0, 6).map((asset, i) => (
                <tr key={i} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400">
                        <Zap className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-800">{asset.name}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{asset.no_asset}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-4">
                    <span className="text-xs font-medium text-slate-600">{asset.type}</span>
                  </td>
                  <td className="px-8 py-4 text-center">
                    <span className="text-xs font-bold text-slate-700">12</span>
                  </td>
                  <td className="px-8 py-4">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-[#FDB913] rounded-full" style={{ width: '75%' }}></div>
                      </div>
                      <span className="text-[10px] font-bold text-slate-500">75%</span>
                    </div>
                  </td>
                  <td className="px-8 py-4 text-right">
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider ${
                      asset.available === 'Available' ? 'bg-[#FDB913]/10 text-[#FDB913]' :
                      asset.available === 'Deployed' ? 'bg-sky-50 text-sky-600' :
                      'bg-amber-50 text-amber-600'
                    }`}>
                      {asset.available}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, trend, trendUp, color }: any) {
  const colors: any = {
    teal: 'bg-[#FDB913]/10 text-[#FDB913]',
    sky: 'bg-sky-50 text-sky-600',
    amber: 'bg-amber-50 text-amber-600',
    indigo: 'bg-indigo-50 text-indigo-600',
  };

  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all group">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-3 rounded-2xl transition-transform group-hover:scale-110 ${colors[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full ${
          trendUp ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
        }`}>
          {trendUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {trend}
        </div>
      </div>
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{title}</p>
        <h4 className="text-3xl font-display font-bold text-slate-900 mt-1">{value}</h4>
      </div>
    </div>
  );
}
