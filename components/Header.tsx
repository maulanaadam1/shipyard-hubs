'use client';

import React from 'react';
import { Bell, User as UserIcon, LogOut, UserCircle, X, Ship } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '@/lib/api-client';
import { useNavigate } from 'react-router-dom';
import ProfileModal from './ProfileModal';

export default function Header({ onMenuClick }: { onMenuClick?: () => void }) {
  const { currentUser, setCurrentUser, notifications, markNotificationRead } = useData();
  const navigate = useNavigate();
  const [isUserSwitcherOpen, setIsUserSwitcherOpen] = React.useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = React.useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = React.useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = React.useState(false);
  const [authMode, setAuthMode] = React.useState<'login' | 'signup'>('login');
  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [authError, setAuthError] = React.useState('');
  const [successMessage, setSuccessMessage] = React.useState('');
  const [isAuthLoading, setIsAuthLoading] = React.useState(false);
  const loadingRef = React.useRef(false);

  const handleNotificationClick = (notification: any) => {
    // Mark as read
    if (!notification.is_read) {
      markNotificationRead(notification.id);
    }
    setIsNotificationsOpen(false);

    // Navigate to the right page
    const link = notification.link || '/dashboard';

    // For approval notifications, extract loan request ID from message
    // e.g. "Loan request ERQ/2024/05/001/YWTS requires your approval..."
    if (notification.type === 'approval') {
      const match = notification.message?.match(/Loan request (\S+) requires/);
      const requestId = match?.[1];
      if (requestId) {
        navigate(`${link}?approve=${encodeURIComponent(requestId)}`);
        return;
      }
    }

    navigate(link);
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check if Supabase is configured
    const isPlaceholder = import.meta.env.VITE_SUPABASE_URL?.includes('placeholder');
    if (isPlaceholder || !import.meta.env.VITE_SUPABASE_URL) {
      setAuthError('Supabase is not configured. Please set your API keys in the Settings menu.');
      return;
    }

    setAuthError('');
    setSuccessMessage('');
    setIsAuthLoading(true);
    loadingRef.current = true;
    
    const authTimeout = setTimeout(() => {
      if (loadingRef.current) {
        setAuthError('Connection timeout (30s). Please verify your Supabase URL and Anon Key.');
        setIsAuthLoading(false);
        loadingRef.current = false;
      }
    }, 30000);

    try {
      const defaultAdminUsername = import.meta.env.VITE_DEFAULT_ADMIN_USERNAME || 'superadmin';
      const defaultAdminPassword = import.meta.env.VITE_DEFAULT_ADMIN_PASSWORD || 'admin123';
      const isDefaultAdminLogin = identifier === defaultAdminUsername && password === defaultAdminPassword;

      // If it's a username (no @), append dummy domain
      const isEmail = identifier.includes('@');
      const authEmail = isEmail ? identifier : `${identifier}@shipyard.local`;

      if (authMode === 'login') {
        const { error } = await api.auth.signInWithPassword({ email: authEmail, password });
        
        if (error) {
          // Auto-create default admin if it doesn't exist
          if (isDefaultAdminLogin && error.message.includes('Invalid login credentials')) {
            const { data: authData, error: signUpError } = await api.auth.signUp({ email: authEmail, password });
            if (signUpError) throw signUpError;
            
            if (authData?.user) {
              await api.from('profiles').upsert({ 
                id: authData.user.id, 
                name: 'Super Admin', 
                email: '', 
                role: 'Admin' 
              }, { onConflict: 'id' });
              
              // Sign in after creation
              const { error: retryError } = await api.auth.signInWithPassword({ email: authEmail, password });
              if (retryError) throw retryError;
            }
          } else {
            throw error;
          }
        }
        setIsLoginModalOpen(false);
      } else {
        const { data: authData, error: signUpError } = await api.auth.signUp({ email: authEmail, password });
        if (signUpError) throw signUpError;
        
        if (authData?.user) {
          const isDefaultAdmin = authEmail === process.env.NEXT_PUBLIC_DEFAULT_ADMIN_EMAIL || identifier === defaultAdminUsername;
          const displayName = !isEmail && identifier === defaultAdminUsername ? 'Super Admin' : (isEmail ? authEmail.split('@')[0] : identifier);
          const displayEmail = isEmail ? authEmail : '';

          await api.from('profiles').upsert({ 
            id: authData.user.id, 
            name: displayName, 
            email: displayEmail, 
            role: isDefaultAdmin ? 'Admin' : 'Staff' 
          }, { onConflict: 'id' });
        }
        
        setSuccessMessage('Account created! You can now sign in.');
        setAuthMode('login');
        setPassword('');
        return;
      }
      setIdentifier('');
      setPassword('');
    } catch (error: any) {
      setAuthError(error.message);
    } finally {
      clearTimeout(authTimeout);
      setIsAuthLoading(false);
      loadingRef.current = false;
    }
  };

  const handleSupabaseLogout = async () => {
    // Force instant UI clearance so the user feels the logout immediately
    localStorage.clear();
    setCurrentUser(null);
    setIsUserSwitcherOpen(false);

    try {
      // Race supabase signout against a 1.5-second timeout to prevent deadlocks
      // if internet connection is lagging or the websocket is unresponsive.
      await Promise.race([
        api.auth.signOut(),
        new Promise(resolve => setTimeout(resolve, 1500))
      ]);
    } catch (error) {
      console.error('Error during sign out:', error);
    } finally {
      // Always redirect back to root to clean any leftover state.
      window.location.replace('/');
    }
  };

  return (
    <header className="h-16 shrink-0 bg-[#FDB913] text-slate-900 flex items-center justify-between px-4 md:px-8 z-30 shadow-sm">
      <div className="flex items-center gap-4 md:gap-8">
        {currentUser && (
          <button 
            onClick={onMenuClick}
            className="lg:hidden p-2 hover:bg-[#FDB913] rounded-lg transition-colors flex flex-col items-center justify-center gap-1.5"
          >
            <div className="w-6 h-0.5 bg-white rounded-full"></div>
            <div className="w-6 h-0.5 bg-white rounded-full"></div>
            <div className="w-6 h-0.5 bg-white rounded-full"></div>
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 md:gap-6">
        {currentUser && (
          <div className="relative">
            <button 
              onClick={() => {
                setIsNotificationsOpen(!isNotificationsOpen);
                setIsUserSwitcherOpen(false);
              }}
              className="relative p-2 hover:bg-slate-900/10 rounded-full transition-colors hidden sm:block"
            >
              <Bell className="w-5 h-5" />
              {notifications.filter(n => !n.is_read).length > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full border-2 border-[#FDB913] flex items-center justify-center">
                  {notifications.filter(n => !n.is_read).length}
                </span>
              )}
            </button>

            <AnimatePresence>
              {isNotificationsOpen && (
                <motion.div 
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute top-full right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50 text-slate-800"
                >
                  <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                      Notifications
                    </p>
                    <span className="px-2 py-0.5 bg-slate-200 rounded-full text-[10px] font-bold text-slate-500">
                      {notifications.length} Total
                    </span>
                  </div>
                  
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center">
                        <p className="text-sm text-slate-400">No notifications yet</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {notifications.map(notification => (
                          <div 
                            key={notification.id}
                            className={`p-4 hover:bg-slate-50 transition-colors cursor-pointer relative ${!notification.is_read ? 'bg-blue-50/30' : ''}`}
                            onClick={() => handleNotificationClick(notification)}
                          >
                            {!notification.is_read && (
                              <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#FDB913]"></div>
                            )}
                            <div className="flex justify-between items-start mb-1">
                              <h4 className="text-sm font-bold text-slate-800">{notification.title}</h4>
                              <span className="text-[10px] text-slate-400">{new Date(notification.created_at).toLocaleDateString()}</span>
                            </div>
                            <p className="text-xs text-slate-500 line-clamp-2">{notification.message}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  <div className="p-3 bg-slate-50 border-t border-slate-100 text-center">
                    <button className="text-[10px] font-bold text-[#FDB913] hover:underline uppercase tracking-wider">
                      View All Notifications
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        
        {!currentUser ? (
          <button 
            onClick={() => setIsLoginModalOpen(true)}
            className="p-2 bg-[#FDB913] hover:bg-[#FDB913]/80 rounded-full transition-all border border-[#FDB913]/70 shadow-sm flex items-center justify-center"
            title="Login"
          >
            <UserCircle className="w-6 h-6" />
          </button>
        ) : (
          <div className="relative">
            <button 
              onClick={() => setIsUserSwitcherOpen(!isUserSwitcherOpen)}
              className="flex items-center gap-3 pl-4 border-l border-slate-900/20 hover:opacity-80 transition-opacity"
            >
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium leading-none">{currentUser.name}</p>
                <p className="text-[10px] text-slate-700 uppercase tracking-wider font-bold mt-1">{currentUser.jabatan || currentUser.role}</p>
              </div>
              <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center border-2 border-white shadow-sm overflow-hidden shrink-0 relative">
                {currentUser.avatar ? (
                  <img 
                    src={currentUser.avatar} 
                    alt={currentUser.name} 
                    className="object-cover w-full h-full"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <UserIcon className="w-6 h-6 text-slate-400" />
                )}
              </div>
            </button>

            <AnimatePresence>
              {isUserSwitcherOpen && (
                <motion.div 
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute top-full right-0 mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50 text-slate-800"
                >
                  <div className="p-3 bg-slate-50 border-b border-slate-100">
                    <p className="text-xs font-bold text-slate-800 truncate">
                      {currentUser.name}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate">{currentUser.jabatan || currentUser.role}</p>
                  </div>
                  
                  <div className="p-2 space-y-1">
                    <button 
                      onClick={() => {
                        setIsProfileModalOpen(true);
                        setIsUserSwitcherOpen(false);
                      }}
                      className="w-full flex items-center gap-2 p-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors text-xs font-bold"
                    >
                      <UserCircle className="w-4 h-4" /> My Profile
                    </button>
                    <button 
                      onClick={handleSupabaseLogout}
                      className="w-full flex items-center gap-2 p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-xs font-bold"
                    >
                      <LogOut className="w-4 h-4" /> Sign Out
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Login Modal */}
      <AnimatePresence>
        {isLoginModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsLoginModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden text-slate-800"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="font-display font-bold text-xl text-slate-800">
                  {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
                </h3>
                <button onClick={() => setIsLoginModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <form onSubmit={handleEmailAuth} className="p-8 space-y-4">
                {authError && (
                  <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-xs rounded-xl font-medium">
                    {authError}
                  </div>
                )}
                {successMessage && (
                  <div className="p-3 bg-[#FDB913]/10 border border-[#FDB913]/20 text-[#FDB913] text-xs rounded-xl font-medium">
                    {successMessage}
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email or Username</label>
                  <input 
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                    placeholder="name@company.com or username"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Password</label>
                  <input 
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#FDB913]/30 focus:border-[#FDB913] transition-all"
                    placeholder="••••••••"
                  />
                </div>

                <button 
                  type="submit"
                  disabled={isAuthLoading}
                  className="w-full py-3 bg-[#FDB913] text-slate-900 rounded-xl text-sm font-bold hover:bg-[#e5a611] transition-all shadow-lg shadow-[#FDB913]/20 disabled:opacity-50"
                >
                  {isAuthLoading ? 'Processing...' : authMode === 'login' ? 'Sign In' : 'Sign Up'}
                </button>

                <div className="text-center pt-2">
                  <button 
                    type="button"
                    onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
                    className="text-xs font-bold text-slate-500 hover:text-[#FDB913] transition-colors"
                  >
                    {authMode === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Profile Modal */}
      <ProfileModal 
        isOpen={isProfileModalOpen} 
        onClose={() => setIsProfileModalOpen(false)} 
      />
    </header>
  );
}
