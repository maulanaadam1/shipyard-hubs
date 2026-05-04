'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  Map as MapIcon, 
  Maximize2, 
  Minimize2, 
  RotateCw,
  Info,
  Ship
} from 'lucide-react';
import { useData, Project } from '@/context/DataContext';
import { api } from '@/lib/api-client';

// Normalized vessel path from reference
const NORMALIZED_PATH_D = "M0 115 L 0 235 110 235 110 115 Q 110 15 55 0 0 15 0 115";
const ORIGINAL_PATH_WIDTH = 110;
const ORIGINAL_PATH_HEIGHT = 235;

export default function VesselLayout() {
  const { projects, fetchData, canAccess } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [zoom, setZoom] = useState(1);
  const [hoveredVessel, setHoveredVessel] = useState<Project | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Filter only active vessels (status_dock or ship_visibility)
  const activeVessels = useMemo(() => {
    return projects.filter(p => {
      const isVisible = p.ship_visibility === 'active' || p.status_dock === 'Docking' || p.status_dock === 'On Dock';
      const matchesSearch = p.shipname?.toLowerCase().includes(searchTerm.toLowerCase());
      return isVisible && matchesSearch;
    });
  }, [projects, searchTerm]);

  const handleUpdatePosition = async (project: Project, x: number, y: number) => {
    setIsSaving(true);
    try {
      const { error } = await api.from('projects')
        .update({ 
          x_coordinate: Math.round(x), 
          y_coordinate: Math.round(y) 
        })
        .eq('id', project.id);
      
      if (error) throw error;
      await fetchData();
    } catch (err: any) {
      console.error('Error updating position:', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRotate = async (project: Project) => {
    const currentRotation = project.rotation || 0;
    const nextRotation = (currentRotation + 45) % 360;
    
    setIsSaving(true);
    try {
      const { error } = await api.from('projects')
        .update({ rotation: nextRotation })
        .eq('id', project.id);
      
      if (error) throw error;
      await fetchData();
    } catch (err: any) {
      console.error('Error rotating vessel:', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'Docking': return '#2ecc71'; // Green
      case 'On Dock': return '#3498db'; // Blue
      case 'Undocking': return '#f1c40f'; // Yellow
      case 'Completed': return '#95a5a6'; // Gray
      default: return '#e67e22'; // Orange
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 overflow-hidden relative">
      {/* Header Controls */}
      <div className="absolute top-6 left-6 z-20 flex flex-col gap-4">
        <div className="bg-white/10 backdrop-blur-md border border-white/20 p-2 rounded-2xl flex items-center gap-3 shadow-2xl">
          <div className="w-10 h-10 bg-[#FDB913] rounded-xl flex items-center justify-center text-slate-900 shadow-lg">
            <MapIcon className="w-5 h-5" />
          </div>
          <div className="pr-4 border-r border-white/10">
            <h2 className="text-white font-bold text-sm leading-none">Vessel Layout</h2>
            <p className="text-white/40 text-[10px] mt-1 font-medium tracking-wider uppercase">Shipyard Terminal</p>
          </div>
          <div className="flex items-center gap-2 px-2">
            <button 
              onClick={() => setZoom(z => Math.min(2, z + 0.1))}
              className="p-2 hover:bg-white/10 rounded-lg text-white/70 transition-colors"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
              className="p-2 hover:bg-white/10 rounded-lg text-white/70 transition-colors"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input 
            type="text" 
            placeholder="Search vessel..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl text-xs text-white outline-none focus:ring-2 focus:ring-[#FDB913]/30 transition-all"
          />
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-6 left-6 z-20 bg-white/10 backdrop-blur-md border border-white/20 p-4 rounded-2xl shadow-2xl space-y-3">
        <h4 className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Status Legend</h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {[
            { label: 'Docking', color: '#2ecc71' },
            { label: 'On Dock', color: '#3498db' },
            { label: 'Undocking', color: '#f1c40f' },
            { label: 'Completed', color: '#95a5a6' }
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-[10px] text-white/60 font-medium">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Saving Indicator */}
      {isSaving && (
        <div className="absolute top-6 right-6 z-20 flex items-center gap-2 px-4 py-2 bg-[#FDB913] text-slate-900 rounded-full text-[10px] font-bold shadow-lg animate-pulse">
          <RotateCw className="w-3 h-3 animate-spin" />
          SAVING POSITION...
        </div>
      )}

      {/* SVG Layout Area */}
      <div className="flex-1 overflow-hidden cursor-move select-none flex items-center justify-center">
        <div 
          className="transition-transform duration-300 origin-center"
          style={{ transform: `scale(${zoom})` }}
        >
          <svg 
            viewBox="0 0 1234.961 649.739" 
            className="w-[1200px] h-auto drop-shadow-2xl"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Port Background Elements from Reference */}
            <g transform="translate(-1170.8034,-52.171147)">
              {/* Ground Areas */}
              <path fill="#2c3e50" d="m1799.299 530.643-81.455 1.917-17.25-245.802 48.874.479 1.916 27.311 37.853 14.374z opacity-50"/>
              
              {/* Slipways & Berths */}
              <path fill="#34495e" transform="rotate(-90)" d="M-304.486 1345.068h133.921v106.131h-133.921z"/>
              <path fill="#34495e" transform="rotate(-90)" d="M-510.999 1473.478h319.592v106.173h-319.592z"/>
              <path fill="#34495e" transform="rotate(-90)" d="M-537.351 2145.721h359.839v71.872h-359.839z"/>
              
              {/* Water Area */}
              <path fill="#1a2a3a" d="M1351.06 294.58s12.69-6.156 35.547-.027c22.857 6.13 41.077-8.946 52.81-5.8 11.732 3.146 12.19 3.717 12.19 3.717v217.852l194.13 3.808c24.681-7.352 71.956 19.974 74.116 18.52 39.23-.019 79.266-1.717 79.266-1.717l11.832-.002 337.118 6.596-.04 3.134 68.326.486v-5.27l126.599 2.447c0 .423 15.487 3.672 15.487 3.672l47.781 3.15-.935 157.018-1233.206 3.355-.599-382.525z"/>
              
              {/* Buildings */}
              <path fill="#4a5568" transform="rotate(-90)" d="M-603.456 2342.911h439.478v63.307h-439.478z"/>
              <path fill="#4a5568" d="m1288.954 474.402-118.083-24.966-.018-310.35 117.34-.058z"/>
              
              {/* Layout Infrastructure */}
              <path fill="#2d3748" d="M1289.02 482.709s14.4 3.896 20.837 8.3 1.694 13.045 3.388 17.958 35.914 6.437 35.914 6.437V195.739h8.13v-24.776h84.025v23.76h7.962v327.965h26.597V194.672h99.1l.51 341.569h4.912v-19.99h60.138v53.532h-7.623v13.213h29.138v-12.875h36.083v13.214h29.306v-13.722h-4.743l-18.126-280.025h41.843l1.863 27.613 38.116 13.044 12.875 201.083h7.962l2.032 22.7h5.252l-1.863-22.53 86.904 2.201v33.373h10.334v-33.711l25.749.338v33.204h10.164l.508-32.695 65.898 1.863.17 32.187 9.995.17V535.9l71.15 1.356v32.356h23.547l.17-32.187 33.033.847V188.454l8.131-8.3h49.127l7.793 8.47V538.95l6.268.339 8.978 31.509h7.793V538.95l87.412.074v25.844h10.842v-23.462l6.261-.072c-.073.002-.162-21.527-.162-21.527V274.51l63.48-.263.02-133.917-596.856-1.39-521.082.122z"/>

              {/* Labels (Simplified for React) */}
              <text x="1720" y="382" fill="white" className="text-[10px] font-bold opacity-30 select-none">SLIPWAY E</text>
              <text x="1495" y="342" fill="white" className="text-[10px] font-bold opacity-30 select-none">SLIPWAY D</text>
              <text x="1399" y="234" fill="white" className="text-[10px] font-bold opacity-30 select-none text-center">SLIPWAY A/B/C</text>
              <text x="2182" y="341" fill="white" className="text-[10px] font-bold opacity-30 select-none">GRAVING DOCK</text>
            </g>

            {/* Vessels Layer */}
            <g id="vessels-layer">
              {activeVessels.map(vessel => {
                const isRect = ['BG', 'TK', 'LCT'].includes(vessel.type || '');
                const targetWidth = (vessel.width || 10) * 3.6;
                const targetHeight = (vessel.length || 30) * 3.2;
                
                return (
                  <motion.g
                    key={vessel.id}
                    drag
                    dragMomentum={false}
                    initial={{ 
                      x: vessel.x_coordinate || 100, 
                      y: vessel.y_coordinate || 100,
                      rotate: vessel.rotation || 0
                    }}
                    animate={{ 
                      x: vessel.x_coordinate || 100, 
                      y: vessel.y_coordinate || 100,
                      rotate: vessel.rotation || 0
                    }}
                    onDragEnd={(e, info) => {
                      // Note: We need to handle relative coordinates correctly
                      // For now, assume the drag x/y is what we want to save
                      handleUpdatePosition(vessel, info.point.x, info.point.y);
                    }}
                    onMouseEnter={() => setHoveredVessel(vessel)}
                    onMouseLeave={() => setHoveredVessel(null)}
                    className="cursor-grab active:cursor-grabbing"
                    whileHover={{ scale: 1.05 }}
                  >
                    {isRect ? (
                      <rect 
                        width={targetWidth}
                        height={targetHeight}
                        x={-targetWidth / 2}
                        y={-targetHeight / 2}
                        fill={getStatusColor(vessel.status_dock)}
                        stroke="#000"
                        strokeWidth="1"
                        rx="4"
                        className="transition-all duration-300"
                      />
                    ) : (
                      <g transform={`scale(${targetWidth / ORIGINAL_PATH_WIDTH}, ${targetHeight / ORIGINAL_PATH_HEIGHT}) translate(-${ORIGINAL_PATH_WIDTH/2}, -${ORIGINAL_PATH_HEIGHT/2})`}>
                        <path 
                          d={NORMALIZED_PATH_D}
                          fill={getStatusColor(vessel.status_dock)}
                          stroke="#000"
                          strokeWidth="1"
                        />
                      </g>
                    )}
                    
                    {/* Vessel Label */}
                    <text 
                      textAnchor="middle" 
                      dominantBaseline="middle"
                      fill="white"
                      className="text-[8px] font-bold pointer-events-none select-none uppercase"
                      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
                      transform="rotate(90)"
                    >
                      {vessel.shipname?.substring(0, 15)}
                    </text>

                    {/* Quick Rotation Tool */}
                    <foreignObject x={targetWidth/2} y={-targetHeight/2} width="30" height="30">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRotate(vessel);
                        }}
                        className="w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform"
                      >
                        <RotateCw className="w-3 h-3 text-slate-900" />
                      </button>
                    </foreignObject>
                  </motion.g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>

      {/* Vessel Callout / Info Panel */}
      <AnimatePresence>
        {hoveredVessel && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="absolute top-6 right-6 z-30 w-72 bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-6 shadow-2xl"
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-slate-900" style={{ backgroundColor: getStatusColor(hoveredVessel.status_dock) }}>
                <Ship className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-white font-bold text-base leading-none">{hoveredVessel.shipname}</h3>
                <span className="inline-block mt-2 px-2 py-0.5 bg-white/10 rounded-full text-[9px] font-bold text-white/60 uppercase tracking-widest border border-white/10">
                  {hoveredVessel.type || 'Standard'}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-white/10">
                <span className="text-[10px] font-bold text-white/40 uppercase">Status</span>
                <span className="text-xs font-bold" style={{ color: getStatusColor(hoveredVessel.status_dock) }}>
                  {hoveredVessel.status_dock || 'Unknown'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-white/5 rounded-2xl border border-white/10">
                  <span className="block text-[9px] font-bold text-white/30 uppercase mb-1">Width</span>
                  <span className="text-sm font-bold text-white">{hoveredVessel.width || '-'} m</span>
                </div>
                <div className="p-3 bg-white/5 rounded-2xl border border-white/10">
                  <span className="block text-[9px] font-bold text-white/30 uppercase mb-1">Length</span>
                  <span className="text-sm font-bold text-white">{hoveredVessel.length || '-'} m</span>
                </div>
              </div>
              <div className="p-4 bg-[#FDB913]/10 border border-[#FDB913]/20 rounded-2xl flex gap-3">
                <Info className="w-4 h-4 text-[#FDB913] shrink-0" />
                <p className="text-[10px] text-[#FDB913] leading-relaxed">
                  Drag the vessel to reposition. Click the rotate icon to adjust orientation.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
