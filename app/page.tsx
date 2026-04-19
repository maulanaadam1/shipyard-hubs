'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import Dashboard from '@/components/Dashboard';
import EquipmentFleet from '@/components/EquipmentFleet';
import EquipmentLoans from '@/components/EquipmentLoans';
import EquipmentDeployment from '@/components/EquipmentDeployment';
import EquipmentReturn from '@/components/EquipmentReturn';
import EquipmentMaintenance from '@/components/EquipmentMaintenance';
import UserManagement from '@/components/UserManagement';
import VendorManagement from '@/components/VendorManagement';
import CompanyManagement from '@/components/CompanyManagement';
import ShipManagement from '@/components/ShipManagement';
import ProjectManagement from '@/components/ProjectManagement';
import UtilityDashboard from '@/components/UtilityDashboard';
import LandingPage from '@/components/LandingPage';
import { useData } from '@/context/DataContext';

function DashboardContent() {
  const { currentUser, isAuthLoading } = useData();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  
  const [activeTab, setActiveTab] = useState(tabParam || 'Dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    if (tabParam && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  }, [tabParam]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setIsSidebarOpen(false);
    router.push(`/?tab=${encodeURIComponent(tab)}`);
  };

  if (isAuthLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#FDB913] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-bold text-slate-500">Authenticating...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LandingPage />;
  }

  return (
    <div suppressHydrationWarning className="flex min-h-screen relative">
      {/* Sidebar Overlay for Mobile/Tablet Portrait */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <div className={`
        fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />
      </div>

      <main className="flex-1 flex flex-col min-w-0 w-full">
        <Header onMenuClick={() => setIsSidebarOpen(!isSidebarOpen)} />
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'Dashboard' ? (
            <>
              <Dashboard />
              
              {/* Mobile View Simulation / Footer Info */}
              <div className="px-8 pb-8">
                <div className="bg-slate-900 rounded-3xl p-8 text-white flex flex-col md:flex-row items-center justify-between gap-8 overflow-hidden relative">
                  <div className="relative z-10 max-w-md">
                    <h2 className="font-display font-bold text-3xl mb-4 text-[#FDB913]">Mobile Companion</h2>
                    <p className="text-slate-400 text-sm leading-relaxed mb-6">
                      Access the full power of the Shipyard Hub on the go. 
                      Track equipment health, update work orders, and receive 
                      real-time alerts directly on your mobile device.
                    </p>
                    <div className="flex gap-4">
                      <button className="px-6 py-2.5 bg-[#FDB913] hover:bg-[#FDB913] rounded-full font-bold text-sm transition-colors">
                        Download iOS
                      </button>
                      <button className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-full font-bold text-sm transition-colors border border-slate-700">
                        Download Android
                      </button>
                    </div>
                  </div>

                  {/* Decorative Mobile Mockup */}
                  <div className="relative w-64 h-[400px] bg-slate-800 rounded-[3rem] border-[8px] border-slate-700 shadow-2xl overflow-hidden hidden lg:block">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-slate-700 rounded-b-2xl"></div>
                    <div className="p-4 pt-10">
                      <div className="w-full h-32 bg-[#FDB913]/20 rounded-2xl mb-4 border border-[#FDB913]/30 flex items-center justify-center">
                        <div className="w-12 h-12 rounded-full border-4 border-[#FDB913] border-t-transparent animate-spin"></div>
                      </div>
                      <div className="space-y-3">
                        <div className="h-4 bg-slate-700 rounded-full w-3/4"></div>
                        <div className="h-4 bg-slate-700 rounded-full w-1/2"></div>
                        <div className="grid grid-cols-2 gap-2 mt-6">
                          <div className="h-20 bg-slate-700 rounded-xl"></div>
                          <div className="h-20 bg-slate-700 rounded-xl"></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Background Glow */}
                  <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-[#FDB913]/20 blur-[100px] rounded-full"></div>
                </div>
              </div>
            </>
          ) : activeTab === 'Utility' ? (
            <UtilityDashboard />
          ) : activeTab === 'Master Equipment' ? (
            <EquipmentFleet />
          ) : activeTab === 'Master Vendor' ? (
            <VendorManagement />
          ) : activeTab === 'Master Company' ? (
            <CompanyManagement />
          ) : activeTab === 'Master Kapal' ? (
            <ShipManagement />
          ) : activeTab === 'Job Order' ? (
            <ProjectManagement />
          ) : activeTab === 'Request' ? (
            <EquipmentLoans />
          ) : activeTab === 'Release' ? (
            <EquipmentDeployment />
          ) : activeTab === 'Return' ? (
            <EquipmentReturn />
          ) : activeTab === 'Maintenance' ? (
            <EquipmentMaintenance />
          ) : activeTab === 'User Management' ? (
            <UserManagement />
          ) : (
            <div className="p-8 flex items-center justify-center h-full text-slate-400 font-medium">
              Section &quot;{activeTab}&quot; is under development.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <div className="w-12 h-12 border-4 border-[#FDB913] border-t-transparent rounded-full animate-spin"></div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
