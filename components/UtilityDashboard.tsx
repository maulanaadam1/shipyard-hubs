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
  Download,
  Calendar
} from 'lucide-react';

export default function UtilityDashboard() {
  const { fleet, deployments } = useData();
  const [period, setPeriod] = useState<'daily' | 'monthly' | 'yearly' | 'custom'>('daily');
  const [customRange, setCustomRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  // Table pagination & expansion state
  const [rankingPage, setRankingPage] = useState(1);
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const itemsPerPage = 10;

  // 1. Filter deployments based on global period
  const filteredDeployments = useMemo(() => {
    const now = new Date();
    let startDate: Date;
    let endDate = new Date();

    switch (period) {
      case 'daily':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'monthly':
        startDate = new Date(now.setMonth(now.getMonth() - 6));
        break;
      case 'yearly':
        startDate = new Date(now.setFullYear(now.getFullYear() - 3));
        break;
      case 'custom':
        startDate = new Date(customRange.start);
        endDate = new Date(customRange.end);
        break;
      default:
        startDate = new Date(0);
    }

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    return deployments.filter(d => {
      const dStart = d.start_date;
      const dEnd = d.return_date || '9999-12-31';
      return dStart <= endStr && dEnd >= startStr;
    });
  }, [deployments, period, customRange]);

  // 2. Real data calculations (Filtered)
  const stats = useMemo(() => {
    const total = fleet.length;
    const active = fleet.filter(a => a.available === 'No').length;
    const rate = total > 0 ? Math.round((active / total) * 100) : 0;
    
    const completed = filteredDeployments.filter(d => d.return_status === 'Returned' && d.return_date);
    let avgDays = 0;
    if (completed.length > 0) {
      const totalDays = completed.reduce((acc, d) => {
        const start = new Date(d.start_date);
        const end = new Date(d.return_date!);
        return acc + Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      }, 0);
      avgDays = Math.round(totalDays / completed.length);
    }

    return { total, active, rate, avgDays, totalDeployments: filteredDeployments.length };
  }, [fleet, filteredDeployments]);

  // 3. Trend Data based on selected period
  const trendData = useMemo(() => {
    if (period === 'daily' || period === 'custom') {
      const days = period === 'daily' ? 7 : 
        Math.min(31, Math.ceil((new Date(customRange.end).getTime() - new Date(customRange.start).getTime()) / (1000 * 60 * 60 * 24)));
      
      const dates = [...Array(days)].map((_, i) => {
        const d = period === 'daily' ? new Date() : new Date(customRange.end);
        d.setDate(d.getDate() - (days - 1 - i));
        return d.toISOString().split('T')[0];
      });

      return dates.map(date => {
        const activeOnDate = deployments.filter(d => {
          const start = d.start_date;
          const end = d.return_date || new Date().toISOString().split('T')[0];
          return date >= start && date <= end;
        }).length;
        const rate = fleet.length > 0 ? Math.round((activeOnDate / fleet.length) * 100) : 0;
        return { name: new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), rate };
      });
    } else if (period === 'monthly') {
      const months = [...Array(6)].map((_, i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - (5 - i));
        return { month: d.getMonth() + 1, year: d.getFullYear(), label: d.toLocaleDateString(undefined, { month: 'short' }) };
      });

      return months.map(m => {
        const monthStart = `${m.year}-${String(m.month).padStart(2, '0')}-01`;
        const monthEnd = `${m.year}-${String(m.month).padStart(2, '0')}-31`;
        const activeInMonth = deployments.filter(d => d.start_date <= monthEnd && (d.return_date || '9999-12-31') >= monthStart).length;
        const rate = fleet.length > 0 ? Math.round((activeInMonth / (fleet.length * 5)) * 100) : 0;
        return { name: m.label, rate: Math.min(100, rate) };
      });
    } else {
      const years = [2024, 2025, 2026];
      return years.map(year => {
        const yearStart = `${year}-01-01`;
        const yearEnd = `${year}-12-31`;
        const activeInYear = deployments.filter(d => d.start_date <= yearEnd && (d.return_date || '9999-12-31') >= yearStart).length;
        const rate = fleet.length > 0 ? Math.round((activeInYear / (fleet.length * 10)) * 100) : 0;
        return { name: year.toString(), rate: Math.min(100, rate) };
      });
    }
  }, [deployments, fleet, period, customRange]);

  // 4. Efficiency ranking (Sorted by usage count DESC)
  const fullEfficiencyRanking = useMemo(() => {
    return fleet.map(asset => {
      const assetDeps = deployments.filter(d => d.product_id === asset.id);
      const totalDays = assetDeps.reduce((acc, d) => {
        const start = new Date(d.start_date);
        const end = d.return_date ? new Date(d.return_date) : new Date();
        return acc + Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      }, 0);
      
      return {
        ...asset,
        usageCount: assetDeps.length,
        totalDays: totalDays,
        efficiency: Math.min(100, Math.round((totalDays / 365) * 100))
      };
    }).sort((a, b) => b.totalDays - a.totalDays);
  }, [fleet, deployments]);

  // Pagination logic
  const totalPages = Math.ceil(fullEfficiencyRanking.length / itemsPerPage);
  const paginatedRanking = fullEfficiencyRanking.slice((rankingPage - 1) * itemsPerPage, rankingPage * itemsPerPage);

  return (
    <div className="p-8 space-y-8">
      {/* Global Header & Period Selector */}
      <div className="bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <h1 className="font-display font-bold text-3xl text-slate-800 tracking-tight">Utility Analytics</h1>
            <p className="text-slate-500 text-sm mt-1">Global performance tracking and resource optimization.</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 shadow-inner">
              {(['daily', 'monthly', 'yearly', 'custom'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => { setPeriod(p); setRankingPage(1); }}
                  className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                    period === p 
                      ? 'bg-white text-[#e5a611] shadow-sm border border-slate-200/50' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {period === 'custom' && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-0 bg-slate-100 p-1 rounded-xl border border-slate-200 shadow-inner"
              >
                <div className="flex items-center gap-2 px-3 py-1 bg-white rounded-lg shadow-sm border border-slate-200/50">
                  <Calendar className="w-3 h-3 text-[#e5a611]" />
                  <input 
                    type="date" 
                    value={customRange.start}
                    onChange={(e) => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
                    className="bg-transparent border-none text-[10px] font-bold text-slate-700 outline-none focus:ring-0 p-0 w-24 h-4"
                  />
                </div>
                <div className="px-2 text-slate-400 font-bold text-[10px]">TO</div>
                <div className="flex items-center gap-2 px-3 py-1 bg-white rounded-lg shadow-sm border border-slate-200/50">
                  <input 
                    type="date" 
                    value={customRange.end}
                    onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
                    className="bg-transparent border-none text-[10px] font-bold text-slate-700 outline-none focus:ring-0 p-0 w-24 h-4"
                  />
                </div>
              </motion.div>
            )}

            <button className="p-2 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-[#FDB913] transition-all shadow-sm">
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Overall Utilization" value={`${stats.rate}%`} icon={Activity} trend="Live" trendUp={true} color="teal" />
        <StatCard title="Active Assets" value={stats.active} icon={Zap} trend={`/ ${stats.total}`} trendUp={true} color="sky" />
        <StatCard title="Avg. Deployment" value={`${stats.avgDays} Days`} icon={Clock} trend="Historical" trendUp={true} color="amber" />
        <StatCard title="Total Usage" value={stats.totalDeployments} icon={TrendingUp} trend="Cumulative" trendUp={true} color="indigo" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Utilization Chart - NOW FULL WIDTH */}
        <div className="lg:col-span-3 bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
            <div>
              <h3 className="font-display font-bold text-lg text-slate-800">Utilization Trend</h3>
              <p className="text-xs text-slate-500">Fleet activity over selected period</p>
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
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} domain={[0, 100]} tickFormatter={(val) => `${val}%`} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }} formatter={(val) => [`${val}%`, 'Utilization']} />
                <Area type="monotone" dataKey="rate" stroke="#FDB913" strokeWidth={3} fillOpacity={1} fill="url(#colorRate)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Detailed Table with Pagination & Expansion */}
      <div className="bg-white rounded-[40px] border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/30">
          <div>
            <h3 className="font-display font-bold text-xl text-slate-800">Asset Performance Ranking</h3>
            <p className="text-xs text-slate-500 mt-1">Ranked by total cumulative duration. Click row for project history.</p>
          </div>
          <div className="flex items-center gap-2">
             <span className="text-xs font-bold text-slate-400">Total: {fullEfficiencyRanking.length} Assets</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50/50">
                <th className="px-8 py-5">Equipment / Alias</th>
                <th className="px-8 py-5">Category</th>
                <th className="px-8 py-5 text-center">Total Deployed</th>
                <th className="px-8 py-5 text-center">Usage Intensity</th>
                <th className="px-8 py-5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedRanking.map((asset, i) => {
                const isExpanded = expandedAssetId === asset.id;
                const assetDeps = deployments.filter(d => d.product_id === asset.id);

                return (
                  <React.Fragment key={asset.id}>
                    <tr 
                      onClick={() => setExpandedAssetId(isExpanded ? null : asset.id)}
                      className={`cursor-pointer transition-colors group ${isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50/50'}`}
                    >
                      <td className="px-8 py-4">
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                            isExpanded ? 'bg-[#FDB913] text-white rotate-90' : 'bg-slate-100 text-slate-400 group-hover:scale-110'
                          }`}>
                            <Zap className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-800">{asset.alias || asset.name}</p>
                            <p className="text-[10px] text-slate-400 font-mono uppercase">{asset.no_asset}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-4">
                        <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-md">{asset.type}</span>
                      </td>
                      <td className="px-8 py-4 text-center">
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-600 rounded-full">
                          <TrendingUp className="w-3 h-3" />
                          <span className="text-xs font-bold">{asset.usageCount} times</span>
                        </div>
                      </td>
                      <td className="px-8 py-4">
                        <div className="flex flex-col items-center gap-1.5">
                          <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${asset.usageCount > 0 ? 'bg-[#FDB913]' : 'bg-slate-200'}`} 
                              style={{ width: `${Math.min(100, (asset.usageCount / 10) * 100)}%` }}
                            ></div>
                          </div>
                          <span className="text-[10px] font-bold text-slate-400">{asset.totalDays} Cumulative Days</span>
                        </div>
                      </td>
                      <td className="px-8 py-4 text-right">
                        <span className={`text-[10px] font-bold px-3 py-1.5 rounded-xl uppercase tracking-wider border ${
                          asset.available === 'Yes' ? 'bg-teal-50 text-teal-600 border-teal-100' : 'bg-[#FDB913]/10 text-[#e5a611] border-[#FDB913]/20'
                        }`}>
                          {asset.available === 'Yes' ? 'Available' : 'Active'}
                        </span>
                      </td>
                    </tr>

                    {/* Expandable Project History Sub-table */}
                    <motion.tr
                      initial={false}
                      animate={{ height: isExpanded ? 'auto' : 0 }}
                      className="overflow-hidden bg-slate-50/30"
                    >
                      <td colSpan={5} className="p-0">
                        <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'p-8 opacity-100' : 'h-0 p-0 opacity-0'}`}>
                          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
                            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                                <Activity className="w-3 h-3 text-[#FDB913]" />
                                Project History
                              </h4>
                              <span className="text-[10px] font-bold text-slate-400">{assetDeps.length} Records Found</span>
                            </div>
                            <table className="w-full text-left">
                              <thead>
                                <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">
                                  <th className="px-6 py-3">Project Name / Shipname</th>
                                  <th className="px-6 py-3">Date Range</th>
                                  <th className="px-6 py-3">Duration</th>
                                  <th className="px-6 py-3">Vendor / User</th>
                                  <th className="px-6 py-3 text-right">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {assetDeps
                                  .map(dep => {
                                    const start = new Date(dep.start_date);
                                    const end = dep.return_date ? new Date(dep.return_date) : new Date();
                                    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
                                    return { ...dep, calculatedDays: days };
                                  })
                                  .sort((a, b) => b.calculatedDays - a.calculatedDays)
                                  .map((dep, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                      <td className="px-6 py-3">
                                        <p className="text-xs font-bold text-slate-800">{dep.project_name || 'N/A'}</p>
                                        <p className="text-[10px] text-slate-400">{dep.shipname || '-'}</p>
                                      </td>
                                      <td className="px-6 py-3">
                                        <div className="flex items-center gap-2 text-[10px] font-medium text-slate-500">
                                          <Calendar className="w-3 h-3" />
                                          {dep.start_date} <span className="text-slate-300">→</span> {dep.return_date || 'Ongoing'}
                                        </div>
                                      </td>
                                      <td className="px-6 py-3">
                                        <span className="text-[10px] font-bold text-[#FDB913] bg-[#FDB913]/10 px-2 py-0.5 rounded-full">
                                          {dep.calculatedDays} Days
                                        </span>
                                      </td>
                                      <td className="px-6 py-3">
                                        <p className="text-[10px] font-bold text-slate-600">{dep.vendor || 'Internal'}</p>
                                      </td>
                                      <td className="px-6 py-3 text-right">
                                        <span className={`text-[10px] font-bold ${dep.return_status === 'Returned' ? 'text-teal-600' : 'text-amber-600'}`}>
                                          {dep.return_status}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                {assetDeps.length === 0 && (
                                  <tr>
                                    <td colSpan={5} className="px-6 py-10 text-center text-slate-400 text-xs font-medium">
                                      No deployment records found for this asset.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </motion.tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Controls */}
        <div className="p-8 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between">
          <p className="text-xs text-slate-500 font-medium">
            Showing <span className="text-slate-800 font-bold">{(rankingPage - 1) * itemsPerPage + 1}</span> to <span className="text-slate-800 font-bold">{Math.min(rankingPage * itemsPerPage, fullEfficiencyRanking.length)}</span> of <span className="text-slate-800 font-bold">{fullEfficiencyRanking.length}</span> assets
          </p>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setRankingPage(prev => Math.max(1, prev - 1))}
              disabled={rankingPage === 1}
              className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-all shadow-sm"
            >
              Previous
            </button>
            <div className="flex items-center gap-1">
              {[...Array(totalPages)].slice(0, 5).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setRankingPage(i + 1)}
                  className={`w-8 h-8 rounded-xl text-xs font-bold transition-all ${
                    rankingPage === i + 1 ? 'bg-[#FDB913] text-slate-900 shadow-md shadow-[#FDB913]/20' : 'text-slate-400 hover:bg-slate-100'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              {totalPages > 5 && <span className="text-slate-300">...</span>}
            </div>
            <button 
              onClick={() => setRankingPage(prev => Math.min(totalPages, prev + 1))}
              disabled={rankingPage === totalPages}
              className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-all shadow-sm"
            >
              Next
            </button>
          </div>
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
