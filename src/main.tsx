import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import './globals.css';
import { DataProvider, useData } from '../context/DataContext';

// Register Service Worker for PWA
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('SW registered: ', registration);
    }).catch(registrationError => {
      console.log('SW registration failed: ', registrationError);
    });
  });
}
import Dashboard from '../components/Dashboard';
import LandingPage from '../components/LandingPage';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import EquipmentFleet from '../components/EquipmentFleet';
import EquipmentLoans from '../components/EquipmentLoans';
import EquipmentDeployment from '../components/EquipmentDeployment';
import EquipmentMaintenance from '../components/EquipmentMaintenance';
import EquipmentReturn from '../components/EquipmentReturn';
import EquipmentRelease from '../components/EquipmentRelease';
import VendorManagement from '../components/VendorManagement';
import CompanyManagement from '../components/CompanyManagement';
import ShipManagement from '../components/ShipManagement';
import UserManagement from '../components/UserManagement';
import ProjectManagement from '../components/ProjectManagement';
import UtilityDashboard from '../components/UtilityDashboard';
import ApprovalWorkflowManagement from '../components/ApprovalWorkflowManagement';
import DropdownConfiguration from '../components/DropdownConfiguration';
import RoleManagement from '../components/RoleManagement';

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

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="fixed inset-0 flex bg-slate-50 overflow-hidden">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed lg:relative inset-y-0 left-0 z-40 transition-transform duration-300 h-full overflow-y-auto
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <Sidebar onTabChange={() => setSidebarOpen(false)} />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <DataProvider>
        <Routes>
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
            <Route path="job-order" element={
              <ProtectedRoute resource="Job Order">
                <ProjectManagement />
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
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </DataProvider>
    </BrowserRouter>
  </StrictMode>
);
