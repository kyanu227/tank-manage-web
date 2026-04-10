"use client";

import { useAuth } from "@/lib/contexts/AuthContext";
import { LogOut, User as UserIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppHeader() {
  const { user, userProfile, logout } = useAuth();
  const pathname = usePathname();
  
  // Hide header on pure customer facing routes if needed, 
  // but for now, we'll just adapt based on auth state
  
  if (!user) return null; // Don't show full header to unauthenticated users

  return (
    <header className="sticky top-0 z-50 glass-panel rounded-none border-x-0 border-t-0 px-4 py-3 flex items-center justify-between">
      <div className="font-bold text-lg text-white flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
        <span>Tank<span className="text-blue-400">Operate</span></span>
      </div>
      
      <div className="flex items-center gap-4">
        {userProfile?.role === 'admin' && (
          <nav className="hidden md:flex gap-4 mr-4">
            <Link href="/admin" className={`text-sm ${pathname.startsWith('/admin') ? 'text-blue-600 font-medium' : 'text-slate-500 hover:text-slate-800'}`}>
              Dashboard
            </Link>
            <Link href="/staff" className={`text-sm ${pathname.startsWith('/staff') ? 'text-blue-600 font-medium' : 'text-slate-500 hover:text-slate-800'}`}>
              Workers
            </Link>
          </nav>
        )}
        
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-sm font-medium text-white">{userProfile?.name || user.displayName || 'Staff'}</span>
            <span className="text-xs text-slate-400 capitalize">{userProfile?.role || 'User'}</span>
          </div>
          <button 
            onClick={() => logout()}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
