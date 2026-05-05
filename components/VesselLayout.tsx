'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence, useMotionValue } from 'motion/react';
import { 
  Search, 
  Map as MapIcon, 
  Maximize2, 
  Minimize2, 
  RotateCw,
  Info,
  Ship,
  LayoutGrid,
  Lock
} from 'lucide-react';
import { useData, Project } from '@/context/DataContext';
import { api } from '@/lib/api-client';

// Normalized vessel path from reference
const NORMALIZED_PATH_D = "M0 115 L 0 235 110 235 110 115 Q 110 15 55 0 0 15 0 115";
const ORIGINAL_PATH_WIDTH = 110;
const ORIGINAL_PATH_HEIGHT = 235;

export default function VesselLayout() {
  const { projects, dockStatuses, fetchData, canAccess } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [zoom, setZoom] = useState(1.0); 
  const [hoveredVessel, setHoveredVessel] = useState<Project | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [localProjects, setLocalProjects] = useState<Project[]>([]);
  const canView = canAccess('Vessel Layout', 'view');
  const canEdit = canAccess('Vessel Layout', 'edit');
  const [isLegendExpanded, setIsLegendExpanded] = useState(false);

  // Sync local projects with context projects
  React.useEffect(() => {
    setLocalProjects(projects);
  }, [projects]);

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#f8fafc] p-8 text-center">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mb-4">
          <Lock className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">Access Restricted</h2>
        <p className="text-sm text-slate-500 mt-2 max-w-xs">You do not have permission to view the Vessel Layout. Please contact your administrator.</p>
      </div>
    );
  }
  
  const svgRef = React.useRef<SVGSVGElement>(null);

  // Helper to convert screen coordinates to SVG coordinates
  const getSVGCoordinates = (clientX: number, clientY: number) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    
    // This matrix transformation handles zoom, pan, and responsive scaling automatically
    const transformed = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: transformed.x, y: transformed.y };
  };

  // Filter only active vessels (status_dock or ship_visibility) using local state for immediate feedback
  const activeVessels = useMemo(() => {
    const activeStatusNames = (dockStatuses || []).filter(s => s.is_active).map(s => s.name);
    return localProjects.filter(p => {
      const isVisible = p.ship_visibility === 'active' || 
                       activeStatusNames.includes(p.status_dock || '');
      const matchesSearch = p.shipname?.toLowerCase().includes(searchTerm.toLowerCase());
      return isVisible && matchesSearch;
    });
  }, [localProjects, searchTerm, dockStatuses]);

  const handleUpdatePosition = async (project: Project, x: number, y: number) => {
    // Optimistic Update: Change local state immediately
    setLocalProjects(prev => prev.map(p => p.id === project.id ? { ...p, x_coordinate: x, y_coordinate: y } : p));
    
    setIsSaving(true);
    try {
      const { error } = await api.from('projects')
        .update({ 
          x_coordinate: x, 
          y_coordinate: y 
        })
        .eq('id', project.id);
      
      if (error) throw error;
      // Fetch data in background, but don't clear local state unless error
      await fetchData();
    } catch (err: any) {
      console.error('Error updating position:', err.message);
      // Rollback on error
      await fetchData();
    } finally {
      setIsSaving(false);
    }
  };

  const handleRotate = async (project: Project) => {
    const currentRotation = project.rotation || 0;
    const nextRotation = (currentRotation + 45) % 360;
    
    // Optimistic Update
    setLocalProjects(prev => prev.map(p => p.id === project.id ? { ...p, rotation: nextRotation } : p));

    setIsSaving(true);
    try {
      const { error } = await api.from('projects')
        .update({ rotation: nextRotation })
        .eq('id', project.id);
      
      if (error) throw error;
      await fetchData();
    } catch (err: any) {
      console.error('Error rotating vessel:', err.message);
      await fetchData();
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusColor = (statusName?: string) => {
    const status = (dockStatuses || []).find(s => s.name === statusName);
    return status?.color || '#e67e22'; // Default orange
  };

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] overflow-hidden relative">
      {/* Legend */}
      <div 
        onClick={() => setIsLegendExpanded(!isLegendExpanded)}
        className={`absolute bottom-6 left-6 z-20 bg-white/95 backdrop-blur-xl border border-slate-200 rounded-full shadow-xl cursor-pointer overflow-hidden items-center hover:shadow-2xl group hidden md:flex transition-all ${isLegendExpanded ? 'px-5 h-10 w-auto' : 'w-10 h-10 justify-center'}`}
      >
        {!isLegendExpanded ? (
          <LayoutGrid className="w-4 h-4 text-slate-500 group-hover:text-[#FDB913]" />
        ) : (
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2 pr-4 border-r border-slate-100 h-4">
               <LayoutGrid className="w-3.5 h-3.5 text-[#FDB913]" />
               <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Legend</span>
            </div>
            <div className="flex items-center gap-4">
              {(dockStatuses || []).filter(s => s.is_active).map(s => (
                <div key={s.id} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full shadow-sm" style={{ backgroundColor: s.color }} />
                  <span className="text-[9px] text-slate-700 font-bold whitespace-nowrap uppercase tracking-tight">{s.name}</span>
                </div>
              ))}
            </div>
            <div className="pl-1 border-l border-slate-100 ml-2 h-4 flex items-center">
              <Minimize2 className="w-3 h-3 text-slate-300 hover:text-slate-500" />
            </div>
          </div>
        )}
      </div>

      {/* Saving Indicator */}
      {isSaving && (
        <div className="absolute top-6 right-6 z-20 flex items-center gap-2 px-4 py-2 bg-[#FDB913] text-slate-900 rounded-full text-[10px] font-bold shadow-lg animate-pulse">
          <RotateCw className="w-3 h-3 animate-spin" />
          SAVING POSITION...
        </div>
      )}

      {/* SVG Layout Area */}
      <div className="flex-1 w-full h-full overflow-auto md:overflow-hidden select-none bg-[#f1f5f9] custom-scrollbar flex items-start md:items-center justify-start md:justify-center">
        <motion.div 
          animate={{ 
            scale: zoom
          }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="origin-top-left md:origin-center h-full w-auto md:w-full md:h-full flex items-start justify-start md:items-center md:justify-center"
        >
          <svg 
            ref={svgRef}
            viewBox="0 0 1234.961 649.739" 
            className="h-full w-auto md:w-full md:h-full max-w-none drop-shadow-sm"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="xMidYMid slice"
          >
            {/* Full Original Port Background Elements from Reference */}
            <g id="layer15" transform="translate(-1170.8034,-52.171147)">
                <path style={{ display: 'inline', fill: '#c7af92', fillOpacity: 1, stroke: '#28170b', strokeWidth: '.274439' }} d="m1799.299 530.643-81.455 1.917-17.25-245.802 48.874.479 1.916 27.311 37.853 14.374z"/>
                <path style={{ display: 'inline', fill: '#c7af92', fillOpacity: 1, stroke: '#28170b', strokeWidth: '.274439' }} d="m1799.299 530.643-81.455 1.917-17.25-245.802 48.874.479 1.916 27.311 37.853 14.374z"/>
                <path style={{ display: 'inline', fill: '#c7af92', fillOpacity: 1, stroke: '#28170b', strokeWidth: '.274439' }} transform="rotate(-90)" d="M-304.486 1345.068h133.921v106.131h-133.921z"/>
                <path style={{ display: 'inline', fill: '#c7af92', fillOpacity: 1, stroke: '#28170b', strokeWidth: '.27357' }} transform="rotate(-90)" d="M-510.999 1473.478h319.592v106.173h-319.592z"/>
                <path style={{ display: 'inline', fill: '#c7af92', fillOpacity: 1, stroke: '#28170b', strokeWidth: '.274439' }} transform="rotate(-90)" d="M-537.351 2145.721h359.839v71.872h-359.839z"/>
                <path style={{ display: 'inline', fill: '#aef', stroke: '#aef', strokeWidth: '.274337', strokeDasharray: 'none' }} d="M1351.06 294.58s12.69-6.156 35.547-.027c22.857 6.13 41.077-8.946 52.81-5.8 11.732 3.146 12.19 3.717 12.19 3.717v217.852l194.13 3.808c24.681-7.352 71.956 19.974 74.116 18.52 39.23-.019 79.266-1.717 79.266-1.717l11.832-.002 337.118 6.596-.04 3.134 68.326.486v-5.27l126.599 2.447c0 .423 15.487 3.672 15.487 3.672l47.781 3.15-.935 157.018-1233.206 3.355-.599-382.525z"/>
                <path style={{ display: 'inline', fill: '#fff', fillOpacity: 1, stroke: '#28170b', strokeWidth: '.252177' }} transform="rotate(-90)" d="M-603.456 2342.911h439.478v63.307h-439.478z"/>
                <path style={{ display: 'inline', fill: '#fff', fillOpacity: 1, stroke: '#1a1a1a', strokeWidth: '.224951', strokeDasharray: 'none', strokeOpacity: 1 }} d="m1288.954 474.402-118.083-24.966-.018-310.35 117.34-.058z"/>
                <path style={{ display: 'inline', fill: '#e9e8e6', fillOpacity: 1, stroke: '#000', strokeWidth: '.224951', strokeDasharray: 'none' }} d="M1289.02 482.709s14.4 3.896 20.837 8.3 1.694 13.045 3.388 17.958 35.914 6.437 35.914 6.437V195.739h8.13v-24.776h84.025v23.76h7.962v327.965h26.597V194.672h99.1l.51 341.569h4.912v-19.99h60.138v53.532h-7.623v13.213h29.138v-12.875h36.083v13.214h29.306v-13.722h-4.743l-18.126-280.025h41.843l1.863 27.613 38.116 13.044 12.875 201.083h7.962l2.032 22.7h5.252l-1.863-22.53 86.904 2.201v33.373h10.334v-33.711l25.749.338v33.204h10.164l.508-32.695 65.898 1.863.17 32.187 9.995.17V535.9l71.15 1.356v32.356h23.547l.17-32.187 33.033.847V188.454l8.131-8.3h49.127l7.793 8.47V538.95l6.268.339 8.978 31.509h7.793V538.95l87.412.074v25.844h10.842v-23.462l6.261-.072c-.073.002-.162-21.527-.162-21.527V274.51l63.48-.263.02-133.917-596.856-1.39-521.082.122z"/>
                <path style={{ display: 'inline', fill: '#28170b', stroke: '#28170b', strokeWidth: '.274439', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-513.849 1475.433h5.672v100.625h-5.672zm-27.537 672.025h5.217v69.72h-5.217z"/>
                <path style={{ display: 'inline', fill: '#c7af92', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-535.062 2243.481h369.827v96.114h-369.827z"/>
                <path style={{ display: 'inline', fill: '#349e2b', fillOpacity: 1, stroke: '#000', strokeWidth: '.242171' }} d="M1889.74 158.011h14.047v29.5h-14.047z"/>
                <path style={{ display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: 1.14778, strokeDasharray: 'none' }} d="M1996.063 533.316a37.221 37.281 0 0 1-37.055 37.281 37.221 37.281 0 0 1-37.386-36.947"/>
                <path style={{ display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: 1.1596, strokeDasharray: 'none' }} d="M1958.45 495.479a37.634 37.634 0 0 1 37.634 37.466 37.634 37.634 0 0 1-37.298 37.8"/>
                <path style={{ display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: 1.16021, strokeDasharray: 'none' }} d="M1958.922 495.37v38.963l-37.855-.518"/>
                <path style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439' }} d="M1805.747 274.595h13.689v14.284h-13.689z"/>
                <path style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.188786' }} d="M1807.47 221.015h45.433v4.82h-45.433z"/>
                <path style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.23792' }} d="M1852.947 220.934h11.189v13.399h-11.189z"/>
                <path style={{ display: 'inline', fill: '#000', fillOpacity: 1, stroke: '#000', strokeWidth: '.260471' }} d="M1852.327 255.982h.435v49.26h-.435z"/>
                <path style={{ display: 'inline', fill: '#349e2b', fillOpacity: 1, stroke: '#000', strokeWidth: '.218386' }} d="M1864.09 221.029h10.051v7.526h-10.051z"/>
                <path style={{ display: 'inline', fill: '#f7b088', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439' }} d="M1984.273 305.019h10.521v43.348h-10.521z"/>
                <path style={{ display: 'inline', fill: '#349e2b', fillOpacity: 1, stroke: '#000', strokeWidth: '.213443' }} d="M1857.67 239.44h16.79v4.164h-16.79z"/>
                <path style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.268424', strokeDasharray: 'none', strokeDashoffset: 0, strokeOpacity: 1 }} d="M1576.435 190.1h26.989v35.6h-26.989z"/>
                <path style={{ display: 'inline', fill: '#21b1e6', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439' }} transform="rotate(-90)" d="M-291.281 1616.403h58.399v58.828h-58.399z"/>
                <path style={{ display: 'inline', fill: '#d98000', fillOpacity: 1, stroke: '#000', strokeWidth: '.286848', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-491.553 1615.926h177.96v60.006h-177.96z"/>
                <path style={{ display: 'inline', fill: '#386db6', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} d="M1808.445 152.606h80.977v61.94l-9.097 6.444h-72.843zm-109.408 33.965v9.825h-81.645v-31.604l-4.303-.045v-16.734h-9.964v-4.059h25.407l.034 4.262h37.915v-8.375h16.596v46.403z"/>
                <path style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.264777', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-165.026 1904.24h16.606v79.775h-16.606z"/>
                <path style={{ display: 'inline', fill: '#f7b088', fillOpacity: 1, stroke: '#000', strokeWidth: '.276897', strokeDasharray: 'none' }} d="M1779.257 257.266h-50.07V194.38h29.18l-.18 22.324 20.588-.128z"/>
                <path style={{ display: 'inline', fill: '#d98000', fillOpacity: 1, stroke: '#000', strokeWidth: '.274253', strokeDasharray: 'none' }} d="M1778.776 216.62v-58.384h-49.664v36.078h28.892v22.563z"/>
                <path style={{ display: 'inline', fill: '#ff2a2a', stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-152.327 1729.468h6.642v9.746h-6.642z"/>
                <path style={{ display: 'inline', fill: '#0093ff', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} d="M1739.773 158.375v-12.578h50.416v39.519h-11.364v-27.097z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.261916', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-305.066 1760.107h47.721v21.022h-47.721z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-305.082 1781.206h47.764v10.924h-47.764z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.280322', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-257.288 1778.915h30.497v13.234h-30.497z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-223.947 1778.788h16.952v15.064h-16.952zm-85.565-15.306h4.411v26.955h-4.411z"/>
                <path style={{ display: 'inline', fill: '#ff2a2a', stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-146.693 1808.647h6.642v9.746h-6.642zm-2.28 236.698h6.642v9.746h-6.642z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.262806', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-289.59 1704.586h16.482v17.042h-16.482z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-289.572 1721.627h16.277v18.819h-16.277z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.336104', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-483.552 1984.059h55.17v19.182h-55.17z"/>
                <path style={{ display: 'inline', fill: 'none', stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} d="M2011.42 190.142h34.813s5.083 1.24 5.932 4.712 0 181.432 0 181.432-.366 2.967-3.923 2.967h-38.54s-12.963-4.703-12.963-13.85v-160.85s.17-10.498 14.773-14.41z"/>
                <path style={{ display: 'inline', fill: 'none', stroke: '#000', strokeWidth: '.26551', strokeDasharray: 'none' }} d="M2110.077 190.138h-32.583s-4.757 1.24-5.552 4.712 0 181.44 0 181.44.343 2.968 3.673 2.968h44.214s4.024-1.23 4.074-6.483c.086-9.149 0-168.226 0-168.226s-.16-10.498-13.826-14.411z"/>
                <path style={{ display: 'inline', fill: 'none', stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} d="M2051.977 500.374v-96.56s-.756-5.077-5.838-5.077h-34.728s-14.727 3.764-14.727 14.437v14.908h6.28v55.559h-6.564s.459 16.698 12.617 16.698 42.96.036 42.96.036zm19.82-.014v-97.408s1.108-4.918 6.359-4.918h39.302s6.611 1.998 6.611 6.233v52.007s.049 5.255-4.695 9.998c-4.744 4.744-35.382 30.69-35.382 30.69s-4.85 4.165-12.195 3.397z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-509.702 2133.614h29.803v15.523h-29.803z"/>
                <path style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439' }} d="M2140.322 301.292h8.625v8.385h-8.625zm0 12.937h8.625v8.385h-8.625zm0 18.447h8.625v8.385h-8.625z"/>
                <path style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-238.836 1590.878h12.696v12.546h-12.696z"/>
                <path style={{ display: 'inline', fill: '#386db6', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-229.409 1604.267h39.295v8.5h-39.295z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.277752', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-188.528 1574.966h32.971v26.299h-32.971z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.275379', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-194.619 1475.939h39.094v99.052h-39.094z"/>
                <path style={{ display: 'inline', fill: '#f7b088', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-297.748 1577.777h40.723v5.542h-40.723z"/>
                <path style={{ display: 'inline', fill: '#f7b088', fillOpacity: 1, stroke: '#000', strokeWidth: '.247949', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-291.028 1609.029h33.083v5.568h-33.083z"/>
                <path style={{ display: 'inline', fill: '#f7b088', fillOpacity: 1, stroke: '#000', strokeWidth: '.204566', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-344.019 1577.655h22.345v5.611h-22.345z"/>
                <path style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-161.282 1289.043h21.321v31.187h-21.321zm-63.028.216h24.21v19.161h-24.21zm-29.823.189h28.623v8.153h-28.623zm-227.666 5.763h31.325v19.336h-31.325zm100.964-5.844h39.792v23.747h-39.792z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.281128', strokeDasharray: 'none' }} d="M1366.816 150.38h19.341v-5.924h34.61v26.496h-53.999z"/>
                <path style={{ display: 'inline', fill: '#ff2a2a', fillOpacity: 1, stroke: '#000', strokeWidth: '.268405', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-170.999 1357.233h20.65v9.513h-20.65z"/>
                <path style={{ display: 'inline', fill: '#d98000', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-193.635 1442.356h17.602v8.279h-17.602z"/>
                <circle style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} cx="-525.552" cy="1885.822" r="6.072" transform="rotate(-90)"/>
                <path style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.276983', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-506.896 1879.104h13.658v13.663h-13.658z"/>
                <path style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.245712', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-518.145 1879.124h10.723v13.695h-10.723z"/>
                <circle style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} cx="-300.919" cy="1924.601" r="2.713" transform="rotate(-90)"/>
                <circle style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} cx="-252.55" cy="1601.299" r="3.349" transform="rotate(-90)"/>
                <circle style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} cx="-163.741" cy="1432.282" r="3.808" transform="rotate(-90)"/>
                <rect style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.22995', strokeDasharray: 'none' }} width="19.2" height="11.38" x="-193.561" y="1344.795" rx="0" ry="0" transform="rotate(-90)"/>
                <path style={{ display: 'inline', fill: '#d98000', fillOpacity: 1, stroke: '#000', strokeWidth: '.281914', strokeDasharray: 'none' }} d="m1794.933 338.582 3.183 47.4h29.864v48.37h68.803l-.867-96.18z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.286142', strokeDasharray: 'none' }} d="m1798.147 386.052 2.914 48.27h26.859V386.03z"/>
                <path style={{ display: 'inline', fill: '#f7b088', fillOpacity: 1, stroke: '#000', strokeWidth: '.281914', strokeDasharray: 'none' }} d="M1895.39 305.346h-102.966l2.529 33.105h101z"/>
                <path style={{ display: 'inline', fill: '#386db6', fillOpacity: 1, stroke: '#000', strokeWidth: '.27354', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-484.948 1830.906h50.464v65.896h-50.464z"/>
                <path style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.284795', strokeDasharray: 'none' }} d="M1801.013 434.435h30.292v70.345h-25.373z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.351845', strokeDasharray: 'none' }} d="m1806.06 505.314 2.695 23.467h36.829v-23.605z"/>
                <path style={{ display: 'inline', fill: '#d98000', fillOpacity: 1, stroke: '#000', strokeWidth: '.233054', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-435.522 1917.269h130.146v65.823h-130.146z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.347892', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-469.883 1917.307h34.279v30.754h-34.279z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.231909', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-469.925 1948.083h34.371v35.044h-34.371z"/>
                <path style={{ display: 'inline', fill: '#386db6', fillOpacity: 1, stroke: '#000', strokeWidth: '.118295', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-338.792 1917.212h33.473v65.938h-33.473z"/>
                <path style={{ display: 'inline', fill: '#21b1e6', fillOpacity: 1, stroke: '#000', strokeWidth: '.110242', strokeDasharray: 'none' }} transform="matrix(0 1 1 0 0 0)" d="M338.906 1917.208h29.067v65.946h-29.067z"/>
                <path style={{ display: 'inline', fill: '#f8f461', fillOpacity: 1, stroke: '#000', strokeWidth: '.274439', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-161.356 2283.957h13.164v16.541h-13.164z"/>
                <path style={{ display: 'inline', fill: '#b3b3b3', fillOpacity: 1, stroke: '#000', strokeWidth: '.323352', strokeDasharray: 'none' }} transform="rotate(-90)" d="M-274.24 2342.773h77.875v63.318h-77.875z"/>
 
                 <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9276px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1720.393" y="382.532"><tspan style={{ textAlign: 'start', textAnchor: 'start', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1720.393" y="382.532">SLIPWAY E</tspan></text>

                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9276px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1645.315" y="264.662"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1645.315" y="264.662">CNC</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9276px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1950.052" y="357.616"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1950.052" y="357.616">CNC</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9276px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1846.556" y="325.514"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1846.556" y="325.514">WAREHOUSE</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '5.89084px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.359341', strokeOpacity: 1 }} x="1754.683" y="237.363"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.359341', strokeOpacity: 1 }} x="1754.683" y="237.363">WAREHOUSE</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '5.89084px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.359341', strokeOpacity: 1 }} x="1754.683" y="179.387"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.359341', strokeOpacity: 1 }} x="1754.683" y="179.387">WORSHOP</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '5.89084px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.359341', strokeOpacity: 1 }} x="1764.865" y="153.632"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.359341', strokeOpacity: 1 }} x="1764.865" y="153.632">MUSHOLA</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9277px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666591', strokeOpacity: 1 }} x="1650.012" y="175.062"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666591', strokeOpacity: 1 }} x="1650.012" y="175.062">OFFICE</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '8.83459px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1624.428" y="409.214"><tspan style={{ textAlign: 'start', textAnchor: 'start', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1624.428" y="409.214">HANGGAR</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9276px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1495.754" y="342.553"><tspan style={{ textAlign: 'start', textAnchor: 'start', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1495.754" y="342.553">SLIPWAY D</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9276px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1399.833" y="234.812"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1399.833" y="234.812">SLIPWAY</tspan><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1399.833" y="248.471">A / B / C</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '8.83459px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1846.327" y="382.342"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1846.327" y="382.342">WORKSHOP</tspan><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1846.327" y="393.385">PIPA</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '8.83459px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1950.794" y="398.193"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1950.794" y="398.193">WORKSHOP</tspan><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1950.794" y="409.237">MACHINERY</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '8.83459px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="2182.521" y="341.654"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="2182.521" y="341.654">GRAVING</tspan><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="2182.521" y="352.697">DOCK</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '12.0556px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.735391', strokeOpacity: 1 }} x="2292.912" y="350.491"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.735391', strokeOpacity: 1 }} x="2292.912" y="350.491">BUILDING</tspan><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.735391', strokeOpacity: 1 }} x="2292.912" y="365.56">BERTH</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9277px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666591', strokeOpacity: 1 }} x="1849.619" y="189.034"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666591', strokeOpacity: 1 }} x="1849.619" y="189.034">OFFICE</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9276px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1720.393" y="382.532"><tspan style={{ textAlign: 'start', textAnchor: 'start', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1720.393" y="382.532">SLIPWAY E</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9276px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1645.315" y="264.662"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1645.315" y="264.662">CNC</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9276px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1950.052" y="357.616"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1950.052" y="357.616">CNC</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9276px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1846.556" y="325.514"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1846.556" y="325.514">WAREHOUSE</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '5.89084px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.359341', strokeOpacity: 1 }} x="1754.683" y="237.363"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.359341', strokeOpacity: 1 }} x="1754.683" y="237.363">WAREHOUSE</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '5.89084px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.359341', strokeOpacity: 1 }} x="1754.683" y="179.387"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.359341', strokeOpacity: 1 }} x="1754.683" y="179.387">WORSHOP</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '5.89084px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.359341', strokeOpacity: 1 }} x="1764.865" y="153.632"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.359341', strokeOpacity: 1 }} x="1764.865" y="153.632">MUSHOLA</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9277px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666591', strokeOpacity: 1 }} x="1650.012" y="175.062"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666591', strokeOpacity: 1 }} x="1650.012" y="175.062">OFFICE</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '8.83459px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1624.428" y="409.214"><tspan style={{ textAlign: 'start', textAnchor: 'start', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1624.428" y="409.214">HANGGAR</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9276px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1495.754" y="342.553"><tspan style={{ textAlign: 'start', textAnchor: 'start', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1495.754" y="342.553">SLIPWAY D</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9276px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1399.833" y="234.812"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1399.833" y="234.812">SLIPWAY</tspan><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1399.833" y="248.471">A / B / C</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '8.83459px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1846.327" y="382.342"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1846.327" y="382.342">WORKSHOP</tspan><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1846.327" y="393.385">PIPA</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '8.83459px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1950.794" y="398.193"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1950.794" y="398.193">WORKSHOP</tspan><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="1950.794" y="409.237">MACHINERY</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '8.83459px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="2182.521" y="341.654"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="2182.521" y="341.654">GRAVING</tspan><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.53891', strokeOpacity: 1 }} x="2182.521" y="352.697">DOCK</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '12.0556px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.735391', strokeOpacity: 1 }} x="2292.912" y="350.491"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.735391', strokeOpacity: 1 }} x="2292.912" y="350.491">BUILDING</tspan><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.735391', strokeOpacity: 1 }} x="2292.912" y="365.56">BERTH</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9277px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666591', strokeOpacity: 1 }} x="1849.619" y="189.034"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666591', strokeOpacity: 1 }} x="1849.619" y="189.034">OFFICE</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9276px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1950.052" y="326.473"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1950.052" y="326.473">OFFICE</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '10.9276px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1862.513" y="462.831"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: '.666584', strokeOpacity: 1 }} x="1862.513" y="462.831">OFFICE</tspan></text>
                <text xmlSpace="preserve" style={{ fontWeight: 700, fontSize: '46.7788px', fontFamily: 'Arial', textAlign: 'end', textAnchor: 'end', display: 'inline', fill: 'none', fillOpacity: 1, stroke: '#000', strokeWidth: 2.85351, strokeOpacity: 1 }} x="1786.056" y="108.399"><tspan style={{ textAlign: 'center', textAnchor: 'middle', fill: '#000', fillOpacity: 1, stroke: 'none', strokeWidth: 2.85351, strokeOpacity: 1 }} x="1786.056" y="108.399">AREA DOCKING DAN FLOATING</tspan></text>
            </g>

            {/* Vessels Layer */}
            <g id="vessels-layer">
              {activeVessels.map(vessel => (
                <VesselComponent 
                  key={vessel.id}
                  vessel={vessel}
                  getSVGCoordinates={getSVGCoordinates}
                  handleUpdatePosition={handleUpdatePosition}
                  handleRotate={handleRotate}
                  setHoveredVessel={setHoveredVessel}
                  zoom={zoom}
                  canEdit={canEdit}
                />
              ))}
            </g>
          </svg>
        </motion.div>
      </div>

      {/* Vessel Callout / Info Panel */}
      <AnimatePresence>
        {hoveredVessel && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, x: 20 }}
            animate={{ 
              opacity: 1, 
              scale: 1, 
              x: 0 
            }}
            exit={{ opacity: 0, scale: 0.9, x: 20 }}
            className="fixed md:absolute top-20 right-4 md:top-6 md:right-6 z-50 w-60 md:w-72 bg-white border border-slate-200 rounded-[1.5rem] md:rounded-[2rem] p-4 md:p-6 shadow-2xl"
          >
            <div className="flex items-center gap-3 md:gap-4 mb-4 md:mb-6">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center text-white shadow-lg" style={{ backgroundColor: getStatusColor(hoveredVessel.status_dock) }}>
                <Ship className="w-5 h-5 md:w-6 md:h-6" />
              </div>
              <div className="overflow-hidden">
                <h3 className="text-slate-800 font-bold text-sm md:text-base leading-tight truncate">{hoveredVessel.shipname}</h3>
                <span className="inline-block mt-1 px-2 py-0.5 bg-slate-100 rounded-full text-[8px] md:text-[9px] font-bold text-slate-500 uppercase tracking-widest border border-slate-200">
                  {hoveredVessel.type || 'Standard'}
                </span>
              </div>
            </div>

            <div className="space-y-3 md:space-y-4">
              <div className="flex justify-between items-center py-1.5 md:py-2 border-b border-slate-100">
                <span className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-wider">Status</span>
                <span className="text-xs font-bold" style={{ color: getStatusColor(hoveredVessel.status_dock) }}>
                  {hoveredVessel.status_dock || 'Unknown'}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-2 md:gap-3">
                <div className="p-2.5 md:p-3 bg-slate-50 rounded-xl md:rounded-2xl border border-slate-100">
                  <span className="block text-[8px] md:text-[9px] font-bold text-slate-400 uppercase mb-0.5 md:mb-1">Width</span>
                  <span className="text-xs md:text-sm font-bold text-slate-700">{hoveredVessel.width || '-'} m</span>
                </div>
                <div className="p-2.5 md:p-3 bg-slate-50 rounded-xl md:rounded-2xl border border-slate-100">
                  <span className="block text-[8px] md:text-[9px] font-bold text-slate-400 uppercase mb-0.5 md:mb-1">Length</span>
                  <span className="text-xs md:text-sm font-bold text-slate-700">{hoveredVessel.length || '-'} m</span>
                </div>
              </div>

              <div className="p-3 md:p-4 bg-[#FDB913]/5 border border-[#FDB913]/20 rounded-xl md:rounded-2xl flex gap-2 md:gap-3">
                <div className="w-5 h-5 md:w-6 md:h-6 bg-[#FDB913]/20 rounded-lg flex items-center justify-center shrink-0">
                  <Info className="w-3 md:w-3.5 h-3 md:h-3.5 text-[#FDB913]" />
                </div>
                <p className="text-[9px] md:text-[10px] text-slate-500 leading-relaxed font-medium">
                  {canEdit 
                    ? "Drag vessel to reposition. Click rotate icon to change orientation." 
                    : "You are in View Only mode. Drag and rotate are disabled."}
                </p>
              </div>
            </div>
            
            {/* Close button for mobile */}
            <button 
              onClick={() => setHoveredVessel(null)}
              className="md:hidden mt-6 w-full py-3 bg-slate-100 text-slate-600 rounded-2xl text-xs font-bold hover:bg-slate-200 transition-colors"
            >
              Close Details
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Sub-component for individual vessel to encapsulate MotionValues
function VesselComponent({ vessel, getSVGCoordinates, handleUpdatePosition, handleRotate, setHoveredVessel, zoom, canEdit }: { 
  vessel: Project, 
  getSVGCoordinates: (x: number, y: number) => { x: number, y: number },
  handleUpdatePosition: (v: Project, x: number, y: number) => void,
  handleRotate: (v: Project) => void,
  setHoveredVessel: (v: Project | null) => void,
  zoom: number,
  canEdit: boolean
}) {
  const isRect = ['BG', 'TK', 'LCT'].includes(vessel.type || '');
  const targetWidth = (vessel.width || 10) * 3.6;
  const targetHeight = (vessel.length || 30) * 3.2;

  // Use MotionValues for smooth position updates
  const mvX = useMotionValue(vessel.x_coordinate || 100);
  const mvY = useMotionValue(vessel.y_coordinate || 100);

  // Store the drag offset in SVG units
  const dragOffset = React.useRef({ x: 0, y: 0 });

  const vesselRef = React.useRef<SVGGElement>(null);

  // Hard-block background scrolling on touchstart to ensure drag works on mobile
  React.useEffect(() => {
    const el = vesselRef.current;
    if (!el || !canEdit) return;
    
    const handleTouchStart = (e: TouchEvent) => {
      // If editing is enabled, prevent the browser from starting a scroll gesture
      if (e.cancelable) {
        e.preventDefault();
      }
    };
    
    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    return () => el.removeEventListener('touchstart', handleTouchStart);
  }, [canEdit]);

  // Sync MotionValues when vessel props change (e.g. after DB update or project reload)
  React.useEffect(() => {
    mvX.set(vessel.x_coordinate || 100);
    mvY.set(vessel.y_coordinate || 100);
  }, [vessel.x_coordinate, vessel.y_coordinate, mvX, mvY]);

  const getStatusColor = (statusName?: string) => {
    const status = (dockStatuses || []).find(s => s.name === statusName);
    return status?.color || '#e67e22';
  };

  return (
     <motion.g
      ref={vesselRef}
      drag={canEdit}
      dragMomentum={false}
      dragElastic={0}
      onDragStart={(e, info) => {
        if (!canEdit) return;
        const mouseSVG = getSVGCoordinates(info.point.x, info.point.y);
        dragOffset.current = {
          x: mouseSVG.x - mvX.get(),
          y: mouseSVG.y - mvY.get()
        };
      }}
      onDragEnd={(e, info) => {
        if (!canEdit) return;
        const mouseSVG = getSVGCoordinates(info.point.x, info.point.y);
        const finalX = Math.round(mouseSVG.x - dragOffset.current.x);
        const finalY = Math.round(mouseSVG.y - dragOffset.current.y);
        handleUpdatePosition(vessel, finalX, finalY);
      }}
      style={{ 
        x: mvX, 
        y: mvY,
        cursor: canEdit ? 'grab' : 'default',
        touchAction: 'none'
      }}
      initial={{ 
        rotate: vessel.rotation || 0
      }}
      animate={{ 
        rotate: vessel.rotation || 0
      }}
      onMouseEnter={() => setHoveredVessel(vessel)}
      onMouseLeave={() => setHoveredVessel(null)}
      onTap={() => setHoveredVessel(vessel)}
      className="active:cursor-grabbing"
    >
      {/* Invisible larger hit area for easier mobile dragging */}
      <rect 
        width={Math.max(targetWidth, 40)} 
        height={Math.max(targetHeight, 40)}
        x={-Math.max(targetWidth, 40) / 2}
        y={-Math.max(targetHeight, 40) / 2}
        fill="transparent"
        style={{ pointerEvents: 'auto', touchAction: 'none' }}
      />

      {/* Visual content centered at 0,0 */}
      <g style={{ pointerEvents: 'none' }}>
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
      </g>
        
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
      
      {/* Rotation tool */}
      {canEdit && (
        <foreignObject x={targetWidth/2} y={-targetHeight/2} width="30" height="30" style={{ pointerEvents: 'auto' }}>
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
      )}
    </motion.g>
  );
}
