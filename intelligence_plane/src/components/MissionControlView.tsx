import React, { useState } from 'react';
import { Zap, Clock, Shield, CheckCircle2, AlertCircle, ArrowUpRight, Flame, Sparkles, Send, SkipForward, Eye, Edit3, MessageSquare, TrendingUp, Building2, Terminal, ChevronRight, RefreshCw, DollarSign } from 'lucide-react';
import { TargetCompany, ProspectReply } from '../data/mockData';

interface MissionControlViewProps {
  companies: TargetCompany[];
  replies: ProspectReply[];
  completedTodayCount: number;
  onSelectAction: (company: TargetCompany) => void;
  onSendEmail: (companyId: string) => void;
  onSkipAction: (companyId: string) => void;
  onOpenReplyCentre: () => void;
  onResetMission: () => void;
}

export const MissionControlView: React.FC<MissionControlViewProps> = ({
  companies,
  replies,
  completedTodayCount,
  onSelectAction,
  onSendEmail,
  onSkipAction,
  onOpenReplyCentre,
  onResetMission
}) => {
  const [activeQueueFilter, setActiveQueueFilter] = useState<'all' | 'emails' | 'followups' | 'research'>('all');

  // Active Mission Telemetry Calculations
  const emailsDueCount = companies.filter(c => c.currentStage === 'First Email').length;
  const followUpsDueCount = companies.filter(c => c.currentStage.includes('Follow Up')).length;
  const unreadRepliesCount = replies.filter(r => !r.isRead).length;
  const researchNeededCount = companies.filter(c => c.currentStage === 'Research Update Needed').length;

  const totalMissionTasks = emailsDueCount + followUpsDueCount + unreadRepliesCount + researchNeededCount;
  const totalTasksSum = completedTodayCount + totalMissionTasks;
  const progressPercent = totalTasksSum > 0 ? Math.min(100, Math.round((completedTodayCount / totalTasksSum) * 100)) : 0;

  // Sorted Action Queue by AI Priority Score (0 - 100)
  const sortedCompanies = [...companies].sort((a, b) => b.priorityScore - a.priorityScore);

  const filteredQueue = sortedCompanies.filter(c => {
    if (activeQueueFilter === 'emails') return c.currentStage === 'First Email';
    if (activeQueueFilter === 'followups') return c.currentStage.includes('Follow Up');
    if (activeQueueFilter === 'research') return c.currentStage === 'Research Update Needed';
    return true;
  });

  const topTarget = sortedCompanies[0];

  return (
    <div className="space-y-8 font-sans selection:bg-cyan-500 selection:text-black animate-fadeIn">

      {/* Top Good Morning Executive Banner */}
      <div className="bg-gradient-to-r from-[#051126] via-[#020817] to-black border border-cyan-500/30 p-6 sm:p-8 rounded-2xl relative overflow-hidden shadow-[0_10px_40px_rgba(0,0,0,0.8)]">
        <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-wrap items-start justify-between gap-6 relative z-10">
          <div className="space-y-4 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-cyan-950/60 border border-cyan-500/40 rounded-full text-cyan-400 font-mono text-xs font-bold uppercase tracking-wider">
              <Zap className="w-3.5 h-3.5 fill-cyan-400" />
              <span>OUTBOUND OPERATING SYSTEM • MISSION CONTROL</span>
            </div>

            <h1 className="font-display text-3xl sm:text-5xl font-extralight text-white tracking-tight uppercase leading-tight">
              Good Morning Vishnu
            </h1>

            <div className="space-y-2 text-sm text-zinc-300 font-mono">
              <div className="text-xs font-bold text-cyan-400 uppercase tracking-widest">// TODAY'S MISSION CADENCE</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
                <div className="bg-black/60 border border-zinc-800 p-2.5 rounded-lg flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400" />
                  <span>Send 12 First Emails</span>
                </div>
                <div className="bg-black/60 border border-zinc-800 p-2.5 rounded-lg flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>Send 9 Follow Ups</span>
                </div>
                <div className="bg-black/60 border border-zinc-800 p-2.5 rounded-lg flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span>Reply to 3 Prospects</span>
                </div>
                <div className="bg-black/60 border border-zinc-800 p-2.5 rounded-lg flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-400" />
                  <span>Update 4 Reports</span>
                </div>
              </div>
            </div>
          </div>

          {/* Time & Progress Gauge */}
          <div className="bg-black/80 border border-cyan-500/40 p-5 rounded-2xl space-y-4 min-w-[260px] font-mono text-xs">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">ESTIMATED TIME</span>
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
                  className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-full transition-all duration-500" 
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono tracking-wider pt-1">
                <span>{completedTodayCount} of {totalTasksSum} Completed</span>
                <button
                  onClick={onResetMission}
                  className="text-cyan-400 hover:text-white flex items-center gap-1 font-bold cursor-pointer"
                  title="Reset Mission to 0"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>RESET</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 11 Stat Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5 font-mono text-xs">
        <div className="bg-zinc-950/80 border border-cyan-500/30 p-4 rounded-xl space-y-1 hover:border-cyan-400 transition-colors">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-bold">EMAILS DUE</span>
          <div className="text-2xl font-bold text-cyan-400">{emailsDueCount}</div>
          <span className="text-[9px] text-zinc-500">First Touch Recon</span>
        </div>

        <div className="bg-zinc-950/80 border border-emerald-500/30 p-4 rounded-xl space-y-1 hover:border-emerald-400 transition-colors">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-bold">FOLLOW UPS DUE</span>
          <div className="text-2xl font-bold text-emerald-400">{followUpsDueCount}</div>
          <span className="text-[9px] text-zinc-500">Auto Scheduled</span>
        </div>

        <div className="bg-zinc-950/80 border border-amber-500/30 p-4 rounded-xl space-y-1 hover:border-amber-400 transition-colors cursor-pointer" onClick={onOpenReplyCentre}>
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-bold">REPLIES INBOX</span>
          <div className="text-2xl font-bold text-amber-400 flex items-center justify-between">
            <span>{unreadRepliesCount}</span>
            {unreadRepliesCount > 0 && <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />}
          </div>
          <span className="text-[9px] text-amber-500 font-bold">2 Meeting Requests</span>
        </div>

        <div className="bg-zinc-950/80 border border-purple-500/30 p-4 rounded-xl space-y-1 hover:border-purple-400 transition-colors">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-bold">MEETINGS BOOKED</span>
          <div className="text-2xl font-bold text-purple-400">4</div>
          <span className="text-[9px] text-purple-400 font-bold">Active Deals</span>
        </div>

        <div className="bg-zinc-950/80 border border-amber-500/40 p-4 rounded-xl space-y-1 shadow-[0_0_15px_rgba(245,158,11,0.15)]">
          <span className="text-[10px] text-amber-400 uppercase tracking-wider block font-bold">£1M ARR TARGET GOAL</span>
          <div className="text-2xl font-bold text-amber-400 flex items-center gap-0.5">
            <DollarSign className="w-4 h-4 text-amber-400" />
            <span>£1,000,000</span>
          </div>
          <span className="text-[9px] text-zinc-400 font-bold">Advisory Pipeline</span>
        </div>

        <div className="bg-zinc-950/80 border border-cyan-500/30 p-4 rounded-xl space-y-1">
          <span className="text-[10px] text-cyan-400 uppercase tracking-wider block font-bold">SENT TODAY</span>
          <div className="text-2xl font-bold text-cyan-400">{completedTodayCount}</div>
          <span className="text-[9px] text-zinc-500">Manual Outbound</span>
        </div>
      </div>

      {/* Main Grid: Live Action Queue & Why Now Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* Left 8 Cols: Live Action Queue */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-zinc-400 uppercase font-bold tracking-wider flex items-center gap-2">
              <Flame className="w-4 h-4 text-cyan-400" />
              <span>LIVE ACTION QUEUE (PRIORITY ORDERED)</span>
            </span>

            {/* Filter Pills */}
            <div className="flex gap-1.5 text-[10px]">
              {['all', 'emails', 'followups', 'research'].map(f => (
                <button
                  key={f}
                  onClick={() => setActiveQueueFilter(f as any)}
                  className={`px-2.5 py-1 rounded font-bold uppercase transition-colors cursor-pointer border ${
                    activeQueueFilter === f
                      ? 'bg-cyan-500 text-black border-cyan-400'
                      : 'bg-zinc-950 text-zinc-400 border-zinc-850 hover:text-white'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Action Cards List */}
          <div className="space-y-3 font-mono">
            {filteredQueue.map((company, idx) => {
              const statusColor = company.priorityScore >= 95 ? 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40'
                                : company.priorityScore >= 85 ? 'text-cyan-400 border-cyan-500/40 bg-cyan-950/40'
                                : 'text-amber-400 border-amber-500/40 bg-amber-950/40';

              return (
                <div
                  key={company.id}
                  className={`p-4 rounded-xl border transition-all bg-gradient-to-r from-zinc-950 via-black to-zinc-950 border-zinc-850 hover:border-cyan-500/50 flex flex-wrap items-center justify-between gap-4 group shadow-md ${
                    idx === 0 ? 'ring-1 ring-cyan-500/50 shadow-[0_0_20px_rgba(6,182,212,0.15)]' : ''
                  }`}
                >
                  {/* Left Company Info */}
                  <div className="flex items-center gap-4 min-w-[240px]">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-3 h-3 rounded-full ${
                        company.priorityScore >= 95 ? 'bg-emerald-400 animate-pulse' :
                        company.priorityScore >= 85 ? 'bg-cyan-400' : 'bg-amber-400'
                      }`} />
                      <div>
                        <h3 className="font-display text-sm font-bold text-white uppercase tracking-wide group-hover:text-cyan-400 transition-colors">
                          {company.name}
                        </h3>
                        <p className="text-[10px] text-zinc-400 font-sans">
                          {company.contactName} ({company.contactRole})
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Priority Badge */}
                  <div className="flex items-center gap-4 text-xs">
                    <div className="text-center">
                      <span className="text-[9px] text-zinc-500 block">PRIORITY</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded border ${statusColor}`}>
                        {company.priorityScore}
                      </span>
                    </div>

                    <div className="text-center">
                      <span className="text-[9px] text-zinc-500 block">STAGE</span>
                      <span className="text-xs text-white font-bold">{company.currentStage}</span>
                    </div>

                    <div className="text-center hidden sm:block">
                      <span className="text-[9px] text-zinc-500 block">TIMING</span>
                      <span className="text-[10px] text-amber-400 font-bold">{company.dueUrgency}</span>
                    </div>
                  </div>

                  {/* Observation Signal */}
                  <div className="w-full sm:w-auto text-[11px] text-zinc-400 font-sans italic border-l-2 border-cyan-500/40 pl-2 max-w-xs line-clamp-1">
                    "{company.whyNowSignals[0]}"
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      onClick={() => onSelectAction(company)}
                      className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 rounded font-bold transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Preview</span>
                    </button>

                    <button
                      onClick={() => onSendEmail(company.id)}
                      className="px-3.5 py-1.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold rounded transition-all shadow-[0_0_12px_rgba(6,182,212,0.3)] flex items-center gap-1 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Send</span>
                    </button>

                    <button
                      onClick={() => onSkipAction(company.id)}
                      className="p-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 rounded border border-zinc-800 transition-colors cursor-pointer"
                      title="Skip for now"
                    >
                      <SkipForward className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right 4 Cols: Why Now Panel & Top Target Analysis */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Why Now Panel */}
          {topTarget && (
            <div className="bg-[#030919] border border-cyan-500/40 p-6 rounded-2xl space-y-4 shadow-[0_4px_30px_rgba(0,0,0,0.8)] relative">
              <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                <div className="flex items-center gap-2 font-mono text-xs text-cyan-400 font-bold uppercase tracking-wider">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  <span>WHY NOW SIGNAL ENGINE</span>
                </div>
                <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-500/40 px-2 py-0.5 rounded font-bold">
                  SCORE {topTarget.priorityScore}
                </span>
              </div>

              <div className="space-y-1">
                <h4 className="font-display text-base font-bold text-white uppercase">
                  {topTarget.name}
                </h4>
                <p className="text-xs text-zinc-400 font-mono">
                  Why am I emailing {topTarget.name} today?
                </p>
              </div>

              <div className="space-y-2.5 font-mono text-xs">
                {topTarget.whyNowSignals.map((sig, i) => (
                  <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-black/80 border border-zinc-850">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0 mt-1.5" />
                    <span className="text-zinc-300 font-sans text-xs">{sig}</span>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-zinc-900/80">
                <button
                  onClick={() => onSelectAction(topTarget)}
                  className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-mono text-xs font-bold uppercase rounded-xl transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>OPEN EMAIL COMPOSER FOR {topTarget.name.toUpperCase()}</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Daily AI Executive Assistant Briefing Quick Box */}
          <div className="bg-zinc-950 border border-purple-500/30 p-5 rounded-2xl space-y-3 font-mono text-xs">
            <div className="flex items-center gap-2 text-purple-400 font-bold uppercase">
              <Terminal className="w-4 h-4 text-purple-400" />
              <span>MORNING EXECUTIVE BRIEFING</span>
            </div>
            <p className="text-xs text-zinc-300 font-sans leading-relaxed">
              "Targeting £1,000,000 GBP pipeline goal. Today's 12 First Email recons have a 94%+ reply probability based on overnight hiring signals."
            </p>
          </div>

        </div>

      </div>

    </div>
  );
};
