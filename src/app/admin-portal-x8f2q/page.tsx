"use client";

import { Users, Truck, PackageCheck, AlertCircle, Check } from "lucide-react";
import Link from "next/link";

export default function AdminDashboard() {
  // Static state for demonstration since we are building the UI framework
  const stats = {
    totalTanks: 450,
    lending: 320,
    inHouse: 45,
    empty: 80,
    broken: 5
  };

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4 animate-fade-in">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">管理者ダッシュボード</h1>
          <p className="text-slate-500 text-sm mt-1">システム全体の稼働状況とタンクステータス</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="card p-5 border-t-4 border-t-slate-700">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-sm font-semibold text-slate-500">総タンク数</h3>
            <PackageCheck size={18} className="text-slate-400" />
          </div>
          <p className="text-3xl font-bold text-slate-800">{stats.totalTanks}</p>
        </div>
        
        <div className="card p-5 border-t-4 border-t-blue-500">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-sm font-semibold text-slate-500">貸出中</h3>
            <Truck size={18} className="text-blue-500" />
          </div>
          <p className="text-3xl font-bold text-slate-800">{stats.lending}</p>
        </div>
        
        <div className="card p-5 border-t-4 border-t-emerald-500">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-sm font-semibold text-slate-500">自社利用 / 空</h3>
            <Users size={18} className="text-emerald-500" />
          </div>
          <p className="text-3xl font-bold text-slate-800">{stats.inHouse + stats.empty}</p>
        </div>
        
        <div className="card p-5 border-t-4 border-t-red-500">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-sm font-semibold text-slate-500">破損 / 要修理</h3>
            <AlertCircle size={18} className="text-red-500" />
          </div>
          <p className="text-3xl font-bold text-slate-800">{stats.broken}</p>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="grid md:grid-cols-3 gap-6">
        
        {/* Recent Activity (Takes up 2 columns) */}
        <div className="md:col-span-2 card p-6">
          <h2 className="text-lg font-bold text-slate-800 mb-6">直近のアクティビティ</h2>
          
          <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
            
            {/* Mock Timeline Items */}
            <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
              <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-blue-100 text-blue-600 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2">
                <Check size={16} />
              </div>
              <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] card p-4 border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-800 text-sm">返却承認</span>
                  <time className="text-xs font-medium text-slate-500">10分前</time>
                </div>
                <div className="text-sm text-slate-600">
                  <span className="font-mono bg-slate-100 px-1 py-0.5 rounded text-xs mr-2">A-01</span>
                  スタッフ: 山田
                </div>
              </div>
            </div>

            <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
              <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-amber-100 text-amber-600 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2">
                <Truck size={16} />
              </div>
              <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] card p-4 border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-800 text-sm">新規発注</span>
                  <time className="text-xs font-medium text-slate-500">1時間前</time>
                </div>
                <div className="text-sm text-slate-600">
                  <span className="font-semibold text-slate-700 mr-2">〇〇ダイビング</span>
                  10kg × 5本
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Quick Actions (Takes up 1 column) */}
        <div className="space-y-6">
          <div className="card p-6 border-t-4 border-t-indigo-500">
            <h2 className="text-lg font-bold text-slate-800 mb-4">マスター管理</h2>
            <div className="space-y-3">
              <button className="w-full text-left px-4 py-3 rounded-md bg-slate-50 hover:bg-slate-100 text-slate-700 text-sm font-medium transition-colors border border-slate-200">
                スタッフ/権限管理
              </button>
              <Link href="/admin-portal-x8f2q/customers" className="block w-full text-left px-4 py-3 rounded-md bg-slate-50 hover:bg-slate-100 text-slate-700 text-sm font-medium transition-colors border border-slate-200">
                貸出先(顧客)リスト管理
              </Link>
              <button className="w-full text-left px-4 py-3 rounded-md bg-slate-50 hover:bg-slate-100 text-slate-700 text-sm font-medium transition-colors border border-slate-200">
                タンクDB管理
              </button>
            </div>
          </div>
          
          <div className="card p-6 bg-gradient-to-br from-slate-800 to-slate-900 border-none text-white">
            <h2 className="text-lg font-bold mb-2">システム設定</h2>
            <p className="text-xs text-slate-300 mb-6 leading-relaxed">
              Firebaseの接続設定やバックアップ、全体ルールの調整を行います。
            </p>
            <button className="w-full py-2 bg-white/10 hover:bg-white/20 rounded text-sm transition-colors border border-white/10">
              設定を開く
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
