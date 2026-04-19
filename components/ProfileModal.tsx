import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, User, Mail, Shield, KeyRound, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { supabase } from '@/lib/supabase';
import Image from 'next/image';

export default function ProfileModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { currentUser } = useData();
  const [isResetting, setIsResetting] = useState(false);
  const [resetStatus, setResetStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  if (!isOpen || !currentUser) return null;

  const handleResetPassword = async () => {
    setIsResetting(true);
    setResetStatus('idle');
    setErrorMessage('');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(currentUser.email, {
        redirectTo: window.location.origin,
      });

      if (error) throw error;
      setResetStatus('success');
    } catch (error: any) {
      setResetStatus('error');
      setErrorMessage(error.message);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden text-slate-800"
          >
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="font-display font-bold text-xl text-slate-800 flex items-center gap-2">
                <User className="w-5 h-5 text-[#FDB913]" />
                User Profile
              </h3>
              <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Avatar & Basic Info */}
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center border-4 border-white shadow-md overflow-hidden shrink-0 relative">
                  {currentUser.avatar ? (
                    <Image 
                      src={currentUser.avatar} 
                      alt={currentUser.name} 
                      fill 
                      className="object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <User className="w-10 h-10 text-slate-400" />
                  )}
                </div>
                <div>
                  <h4 className="font-bold text-lg text-slate-900">{currentUser.name}</h4>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FDB913]/20 text-[#FDB913] text-xs font-bold uppercase tracking-wider mt-1">
                    <Shield className="w-3 h-3" />
                    {currentUser.role}
                  </span>
                </div>
              </div>

              {/* Details */}
              <div className="space-y-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 block">Email Address</label>
                  <div className="flex items-center gap-2 text-slate-700 font-medium bg-white p-3 rounded-xl border border-slate-200">
                    <Mail className="w-4 h-4 text-slate-400" />
                    {currentUser.email}
                  </div>
                </div>
              </div>

              {/* Password Reset */}
              <div className="pt-4 border-t border-slate-100">
                <h5 className="font-bold text-sm text-slate-800 mb-3 flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-slate-500" />
                  Security
                </h5>
                
                {resetStatus === 'success' ? (
                  <div className="bg-green-50 text-green-700 p-4 rounded-xl text-sm font-medium flex items-start gap-3 border border-green-200">
                    <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                    <p>Password reset email sent! Please check your inbox to set a new password.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-500">
                      Need to change your password? We will send a secure reset link to your email address.
                    </p>
                    {resetStatus === 'error' && (
                      <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-medium flex items-center gap-2 border border-red-100">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {errorMessage}
                      </div>
                    )}
                    <button
                      onClick={handleResetPassword}
                      disabled={isResetting}
                      className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isResetting ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <KeyRound className="w-4 h-4" />
                      )}
                      Send Password Reset Email
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
