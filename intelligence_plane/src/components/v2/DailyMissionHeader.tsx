import React from 'react';
import { Zap, Clock, RefreshCw, CheckCircle2, Sparkles, PlusCircle, Play, ShieldAlert, ArrowRight } from 'lucide-react';

interface DailyMissionHeaderProps {
  completedCount: number;
  totalMissionGoal: number;
  onRunDiscovery: () => void;
  onResetMission: () => void;
}

export const DailyMissionHeader: React.FC<DailyMissionHeaderProps> = ({
  completedCount,
  totalMissionGoal,
  onRunDiscovery,
  onResetMission
}) => {
  const progressPercent = totalMissionGoal > 0 ? Math.min(100, Math.round((completedCount / totalMissionGoal) * 100)) : 0;

  return (
    <div className="bg-gradient-to-r from-[#030d22] via-[#020716] to-black border border-cyan-500/30 p-6 sm:p-8 rounded-2xl relative overflow-hidden shadow-[0_10px_50px_rgba(0,0,0,0.8)] font-sans">
      <div className="absolute top-0 right-0 w-72 h-72 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-wrap items-start justify-between gap-6 relative z-10 font-mono text-xs">
        
        {/* Left Today's Mission Cadence */}
        <div className="space-y-4 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1 bg-cyan-950/80 border border-cyan-500/40 rounded-full text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 fill-cyan-400" />
              <span>08:00 AM AUTONOMOUS OUTBOUND SYSTEM • V2 ACTIVE</span>
            </span>

            <span className="px-3 py-1 bg-purple-950/80 border border-purple-500/40 rounded-full text-purple-300 font-bold uppercase tracking-wider">
              TARGET: £30,000+ ENTERPRISE ENGAGEMENTS
            </span>
          </div>

          <h1 className="font-display text-3xl sm:text-5xl font-extralight text-white tracking-tight uppercase leading-tight">
            Good Morning Vishnu
          </h1>

          <div className="space-y-2 text-zinc-300">
            <div className="text-[11px] font-bold text-cyan-400 uppercase tracking-widest">// TODAY'S AUTONOMOUS MISSION CADENCE (AUTO-GENERATED)</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-[11px] pt-1 font-sans">
              <div className="bg-black/80 border border-zinc-850 p-2 rounded-lg flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                <span>Research 20+ New Accounts</span>
              </div>
              <div className="bg-black/80 border border-zinc-850 p-2 rounded-lg flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>Generate 20 Reports & Emails</span>
              </div>
              <div className="bg-black/80 border border-zinc-850 p-2 rounded-lg flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-400" />
                <span>Send 20+ First-Touch Emails</span>
              </div>
              <div className="bg-black/80 border border-zinc-850 p-2 rounded-lg flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span>Process Due Follow-Ups & Replies</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Time & Execution Controls */}
        <div className="bg-black/90 border border-cyan-500/40 p-5 rounded-2xl space-y-4 min-w-[280px]">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">ESTIMATED EXECUTION TIME</span>
            <span className="text-cyan-400 font-bold flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              <span>48 MINUTES</span>
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px]">
              <span className="text-zinc-400">MISSION PROGRESS</span>
              <span className="text-emerald-400 font-bold">{progressPercent}%</span>
            </div>
            <div className="w-full bg-zinc-900 h-2.5 rounded-full overflow-hidden border border-zinc-800">
              <div 
                className="bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-400 h-full transition-all duration-500" 
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-zinc-500 tracking-wider pt-1">
              <span>{completedCount} of {totalMissionGoal} Mission Tasks Done</span>
            </div>
          </div>

          {/* Quick Discovery Button */}
          <button
            onClick={onRunDiscovery}
            className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold uppercase rounded-xl transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)] flex items-center justify-center gap-2 cursor-pointer text-xs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AUTO-DISCOVER 20 NEW ICP ACCOUNTS</span>
          </button>
        </div>

      </div>
    </div>
  );
};
