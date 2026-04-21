import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './globals.css';
import { DataProvider, useData } from '../context/DataContext';
import Dashboard from '../components/Dashboard';
import LandingPage from '../components/LandingPage';

function AppContent() {
  const { currentUser, isAuthLoading } = useData();

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1a365d]"></div>
      </div>
    );
  }

  if (!currentUser) {
    return <LandingPage />;
  }

  return <Dashboard />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <DataProvider>
        <Routes>
          <Route path="/" element={<AppContent />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </DataProvider>
    </BrowserRouter>
  </StrictMode>
);
