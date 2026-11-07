import { StrictMode, useState, useEffect, lazy, Suspense, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import './globals.css';
import { DataProvider, useData } from '../context/DataContext';

// Register Service Worker for PWA in production only.
// In dev, stale cached bundles can hide Vite updates and show a blank page.
if (
  typeof window !== 'undefined' &&
  import.meta.env.PROD &&
  'serviceWorker' in navigator
) {
  window.addEventListener('load', () => {
    // Add version query to bypass potential intermediate caches
    navigator.serviceWorker.register('/sw.js?v=4').then(registration => {
      console.log('SW registered: ', registration);
      
      // Check for updates frequently
      registration.update();

      // If a new SW is waiting, skip waiting and activate
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (installingWorker) {
          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New content is available, reload the page
              console.log('New content available; reloading...');
              window.location.reload();
            }
          };
        }
      };
    }).catch(registrationError => {
      console.log('SW registration failed: ', registrationError);
    });
  });
} else if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(registration => registration.unregister());
  });
}
// Each menu's code is fetched when first opened, so the login page and the
// first screen stay small. Once the app is idle the rest is fetched in the
// background, so later menu switches don't wait (skipped on Data Saver).
const pageLoaders: Array<() => Promise<unknown>> = [];
function page<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  let loaded: { default: T } | undefined;
  const fetchPage = () => load().then(mod => (loaded = mod));
  pageLoaders.push(fetchPage);
  // A promise always settles a tick later, so React would still show the
  // loading spinner for a preloaded page; a thenable that answers right away
  // lets it render on the same pass.
  return lazy(() => (loaded
    ? { then: (done: (mod: { default: T }) => void) => done(loaded!) }
    : fetchPage()) as Promise<{ default: T }>);
}
function preloadPages() {
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  const run = () => pageLoaders.forEach(load => load().catch(() => {}));
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 2000);
}

const Dashboard = page(() => import('../components/Dashboard'));
import { NotFoundPage, ServerStatusGate } from '../components/StatusPages';
import { installServerWatch } from '../lib/server-status';
import LandingPage from '../components/LandingPage';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import RouteErrorBoundary from '../components/RouteErrorBoundary';
const EquipmentFleet = page(() => import('../components/EquipmentFleet'));
const EquipmentLoans = page(() => import('../components/EquipmentLoans'));
const EquipmentDeployment = page(() => import('../components/EquipmentDeployment'));
const EquipmentMaintenance = page(() => import('../components/EquipmentMaintenance'));
const EquipmentReturn = page(() => import('../components/EquipmentReturn'));
const EquipmentRelease = page(() => import('../components/EquipmentRelease'));
const VendorManagement = page(() => import('../components/VendorManagement'));
const CompanyManagement = page(() => import('../components/CompanyManagement'));
const ShipManagement = page(() => import('../components/ShipManagement'));
const MasterShipType = page(() => import('../components/MasterShipType'));
const MasterLocation = page(() => import('../components/MasterLocation'));
const UserManagement = page(() => import('../components/UserManagement'));
const ProjectManagement = page(() => import('../components/ProjectManagement'));
const UtilityDashboard = page(() => import('../components/UtilityDashboard'));
const ApprovalWorkflowManagement = page(() => import('../components/ApprovalWorkflowManagement'));
const DropdownConfiguration = page(() => import('../components/DropdownConfiguration'));
const RoleManagement = page(() => import('../components/RoleManagement'));
const ShipDocking = page(() => import('../components/ShipDocking'));
const VesselLayout = page(() => import('../components/VesselLayout'));
const MasterDockStatus = page(() => import('../components/MasterDockStatus'));
const MasterLayout = page(() => import('../components/MasterLayout'));
const WorkOrderDashboard = page(() => import('../components/WorkOrderDashboard'));
const WorkOrderItems = page(() => import('../components/WorkOrderItems'));
const DataFindings = page(() => import('../components/DataFindings'));
const PriceReference = page(() => import('../components/PriceReference'));
const MaterialStock = page(() => import('../components/MaterialStock'));
const AIAssistant = page(() => import('../components/AIAssistant'));
const AIShare = page(() => import('../components/AIShare'));
const AISettings = page(() => import('../components/AISettings'));
const AILogs = page(() => import('../components/AILogs'));
const RepairList = page(() => import('../components/RepairList'));
const RepairItems = page(() => import('../components/RepairItems'));
const MarketingPriceReference = page(() => import('../components/MarketingPriceReference'));
const HSEDashboard = page(() => import('../components/HSEDashboard'));
const Attendance = page(() => import('../components/Attendance'));
const WorkPermits = page(() => import('../components/WorkPermits'));
const FinancialDashboard = page(() => import('../components/FinancialDashboard'));
const ApiSyncManagement = page(() => import('../components/ApiSyncManagement'));
const IngestSources = page(() => import('../components/IngestSources'));
const MasterService = page(() => import('../components/MasterService'));
const MasterEmployee = page(() => import('../components/MasterEmployee'));
const MasterComponent = page(() => import('../components/MasterComponent'));
const MaterialRequisition = page(() => import('../components/MaterialRequisition'));

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 bg-[#FDB913]/10 rounded-2xl flex items-center justify-center mb-4">
        <span className="text-3xl">🚧</span>
      </div>
      <h2 className="text-xl font-bold text-slate-700 mb-2">{title}</h2>
      <p className="text-slate-400 text-sm">Halaman ini sedang dalam pengembangan.</p>
    </div>
  );
}

// Shown while a menu's code arrives the first time it is opened.
function PageLoading() {
  return (
    <div className="p-8 flex justify-center" role="status" aria-label="Memuat halaman">
      <div className="w-6 h-6 rounded-full border-2 border-slate-200 border-t-slate-500 animate-spin" />
    </div>
  );
}

function AppLayout() {
  const location = useLocation();
  useEffect(preloadPages, []);
  const [sidebarOpen, setSidebarOpen] = useState(typeof window !== 'undefined' ? window.innerWidth >= 1024 : false);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="fixed inset-0 flex bg-slate-50 overflow-hidden">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-[100] lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar wrapper */}
      <div className={`
        fixed lg:relative inset-y-0 left-0 z-[110] transition-all duration-300 h-full overflow-hidden
        ${sidebarOpen ? 'w-64 translate-x-0' : 'w-0 -translate-x-full lg:-translate-x-full'}
      `}>
        <div className="w-64 h-full">
          <Sidebar onTabChange={() => {
            if (window.innerWidth < 1024) setSidebarOpen(false);
          }} />
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 overflow-y-auto">
          <RouteErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
}

function AccessDenied({ resource }: { resource: string }) {
  return (
    <div className="p-8 flex flex-col items-center justify-center min-h-[70vh] text-center">
      <div className="w-24 h-24 bg-red-50 rounded-full flex items-center justify-center mb-6 border-4 border-white shadow-xl">
        <span className="text-4xl">🔐</span>
      </div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Access Denied</h2>
      <p className="text-slate-500 max-w-xs mx-auto mb-8">
        You don't have permission to access the <span className="font-bold text-slate-700">{resource}</span> module.
      </p>
      <div className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-bold text-sm shadow-lg mx-auto w-fit">
        Ask administrator to add menu
      </div>
    </div>
  );
}

function ProtectedRoute({ children, resource }: { children: React.ReactNode, resource: string }) {
  const { canAccess } = useData();
  
  if (!canAccess(resource, 'view')) {
    return <AccessDenied resource={resource} />;
  }
  
  return <>{children}</>;
}

function AppContent() {
  const { currentUser, isAuthLoading, isLoading } = useData();

  if (isAuthLoading || (currentUser && isLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-[#FDB913] rounded-xl flex items-center justify-center animate-pulse">
            <span className="text-2xl">🚢</span>
          </div>
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#FDB913]"></div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">
            Setting up your workspace...
          </p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LandingPage />;
  }

  return <AppLayout />;
}

// Before the first render, so the session check's failures are seen too.
installServerWatch();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ServerStatusGate>
      <DataProvider>
        <Routes>
          {/* Public demo page: no ShipHub login, guarded by the share switch in Pengaturan AI */}
          <Route path="/ai-assistant/share" element={<Suspense fallback={<PageLoading />}><AIShare /></Suspense>} />
          <Route path="/" element={<AppContent />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={
              <ProtectedRoute resource="Dashboard">
                <Dashboard />
              </ProtectedRoute>
            } />
            <Route path="utility" element={
              <ProtectedRoute resource="Utility">
                <UtilityDashboard />
              </ProtectedRoute>
            } />
            <Route path="repair-list" element={
              <ProtectedRoute resource="Repair List">
                <RepairList />
              </ProtectedRoute>
            } />
            <Route path="hse" element={
              <ProtectedRoute resource="Dashboard HSE">
                <HSEDashboard />
              </ProtectedRoute>
            } />
            <Route path="hse/attendance" element={
              <ProtectedRoute resource="Data Absensi">
                <Attendance />
              </ProtectedRoute>
            } />
            <Route path="hse/work-permits" element={
              <ProtectedRoute resource="Data HSE">
                <WorkPermits />
              </ProtectedRoute>
            } />
            <Route path="marketing-price-reference" element={
              <ProtectedRoute resource="Harga Acuan Marketing">
                <MarketingPriceReference />
              </ProtectedRoute>
            } />
            <Route path="repair-items" element={
              <ProtectedRoute resource="Item Repair List">
                <RepairItems />
              </ProtectedRoute>
            } />
            <Route path="repair-list/:joId" element={
              <ProtectedRoute resource="Repair List">
                <RepairList />
              </ProtectedRoute>
            } />
            <Route path="job-order" element={
              <ProtectedRoute resource="Job Order">
                <ProjectManagement />
              </ProtectedRoute>
            } />
            <Route path="work-order" element={
              <ProtectedRoute resource="Work Order">
                <WorkOrderDashboard />
              </ProtectedRoute>
            } />
            <Route path="work-order-items" element={
              <ProtectedRoute resource="Item Pekerjaan WO">
                <WorkOrderItems />
              </ProtectedRoute>
            } />
            <Route path="ai-assistant" element={
              <ProtectedRoute resource="AI Asisten">
                <AIAssistant />
              </ProtectedRoute>
            } />
            <Route path="ai-logs" element={
              <ProtectedRoute resource="Log AI">
                <AILogs />
              </ProtectedRoute>
            } />
            <Route path="ingest-sources" element={
              <ProtectedRoute resource="Sumber Data Eksternal">
                <IngestSources />
              </ProtectedRoute>
            } />
            <Route path="ai-settings" element={
              <ProtectedRoute resource="Pengaturan AI">
                <AISettings />
              </ProtectedRoute>
            } />
            <Route path="price-reference" element={
              <ProtectedRoute resource="Harga Acuan">
                <PriceReference />
              </ProtectedRoute>
            } />
            <Route path="data-findings" element={
              <ProtectedRoute resource="Data Perlu Dicek">
                <DataFindings />
              </ProtectedRoute>
            } />
            <Route path="financial-dashboard" element={
              <ProtectedRoute resource="Financial Dashboard">
                <FinancialDashboard />
              </ProtectedRoute>
            } />
            <Route path="request" element={
              <ProtectedRoute resource="Request">
                <EquipmentLoans />
              </ProtectedRoute>
            } />
            <Route path="release" element={
              <ProtectedRoute resource="Release">
                <EquipmentRelease />
              </ProtectedRoute>
            } />
            <Route path="request-material" element={
              <ProtectedRoute resource="Request">
                <MaterialRequisition />
              </ProtectedRoute>
            } />
            <Route path="return" element={
              <ProtectedRoute resource="Return">
                <EquipmentReturn />
              </ProtectedRoute>
            } />
            <Route path="maintenance" element={
              <ProtectedRoute resource="Maintenance">
                <EquipmentMaintenance />
              </ProtectedRoute>
            } />
            <Route path="material-stock" element={
              <ProtectedRoute resource="Persediaan Material">
                <MaterialStock />
              </ProtectedRoute>
            } />
            <Route path="inventory" element={
              <ProtectedRoute resource="Inventory">
                <EquipmentFleet />
              </ProtectedRoute>
            } />
            <Route path="reports" element={
              <ProtectedRoute resource="Reports">
                <PlaceholderPage title="Reports" />
              </ProtectedRoute>
            } />
            <Route path="master-equipment" element={
              <ProtectedRoute resource="Master Equipment">
                <EquipmentFleet />
              </ProtectedRoute>
            } />
            <Route path="master-vendor" element={
              <ProtectedRoute resource="Master Vendor">
                <VendorManagement />
              </ProtectedRoute>
            } />
            <Route path="master-company" element={
              <ProtectedRoute resource="Master Company">
                <CompanyManagement />
              </ProtectedRoute>
            } />
            <Route path="master-kapal" element={
              <ProtectedRoute resource="Master Kapal">
                <ShipManagement />
              </ProtectedRoute>
            } />
            <Route path="master-ship-type" element={
              <ProtectedRoute resource="Master Kapal">
                <MasterShipType />
              </ProtectedRoute>
            } />
            <Route path="master-component" element={
              <ProtectedRoute resource="Master Component">
                <MasterComponent />
              </ProtectedRoute>
            } />
            <Route path="master-location" element={
              <ProtectedRoute resource="Master Location">
                <MasterLocation />
              </ProtectedRoute>
            } />
            <Route path="master-service" element={
              <ProtectedRoute resource="Master Location">
                <MasterService />
              </ProtectedRoute>
            } />
            <Route path="master-employee" element={
              <ProtectedRoute resource="User Management">
                <MasterEmployee />
              </ProtectedRoute>
            } />
            <Route path="master-dock-status" element={
              <ProtectedRoute resource="Master Dock Status">
                <MasterDockStatus />
              </ProtectedRoute>
            } />
            <Route path="master-layout" element={
              <ProtectedRoute resource="Master Layout">
                <MasterLayout />
              </ProtectedRoute>
            } />
            <Route path="master-workflow" element={
              <ProtectedRoute resource="Master Workflow">
                <ApprovalWorkflowManagement />
              </ProtectedRoute>
            } />
            <Route path="master-config" element={
              <ProtectedRoute resource="Master Configuration">
                <DropdownConfiguration />
              </ProtectedRoute>
            } />
            <Route path="master-api-sync" element={
              <ProtectedRoute resource="Master Configuration">
                <ApiSyncManagement />
              </ProtectedRoute>
            } />
            <Route path="master-roles" element={
              <ProtectedRoute resource="Role Management">
                <RoleManagement />
              </ProtectedRoute>
            } />
            <Route path="user-management" element={
              <ProtectedRoute resource="User Management">
                <UserManagement />
              </ProtectedRoute>
            } />
            <Route path="ship-docking" element={
              <ProtectedRoute resource="Ship Docking">
                <ShipDocking />
              </ProtectedRoute>
            } />
            <Route path="vessel-layout" element={
              <ProtectedRoute resource="Vessel Layout">
                <VesselLayout />
              </ProtectedRoute>
            } />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </DataProvider>
      </ServerStatusGate>
    </BrowserRouter>
  </StrictMode>
);
