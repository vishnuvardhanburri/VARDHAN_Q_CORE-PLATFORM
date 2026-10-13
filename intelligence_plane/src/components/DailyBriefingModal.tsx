import React from 'react';
import { Sparkles, Terminal, CheckCircle2, X, ArrowRight, Flame, ShieldAlert, Zap, TrendingUp } from 'lucide-react';
import { TargetCompany } from '../data/mockData';

interface DailyBriefingModalProps {
  isOpen: boolean;
  onClose: () => void;
  companies: TargetCompany[];
  onStartMission: () => void;
}

export const DailyBriefingModal: React.FC<DailyBriefingModalProps> = ({
  isOpen,
  onClose,
  companies,
  onStartMission
}) => {
  if (!isOpen) return null;

  const topTarget = companies[0] || companies.find(c => c.name === 'Wiz') || companies[0];

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 font-sans animate-fadeIn">
      <div className="w-full max-w-3xl bg-[#030919] border border-cyan-500/50 rounded-2xl shadow-[0_20px_70px_rgba(6,182,212,0.25)] overflow-hidden flex flex-col space-y-6 p-6 sm:p-8 relative">
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-6 right-6 text-zinc-500 hover:text-zinc-300 p-1 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Executive Header */}
        <div className="space-y-2 border-b border-zinc-900 pb-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-cyan-950/80 border border-cyan-500/40 rounded-full text-cyan-400 font-mono text-xs font-bold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>DAILY AI EXECUTIVE BRIEFING • MORNING INTELLIGENCE</span>
          </div>

          <h2 className="font-display text-2xl sm:text-3xl font-extralight text-white uppercase tracking-tight">
            Today's Best Opportunities & Action Plan
          </h2>
          <p className="text-xs text-zinc-400 font-mono">
            Generated at 06:00 AM • Based on overnight hiring signals, GitHub commits & open rates
          </p>
        </div>

        {/* AI Assistant Report Body */}
        <div className="space-y-4 font-mono text-xs max-h-[440px] overflow-y-auto pr-1">
          
          {/* Section 1: Who is most likely to reply today */}
          <div className="bg-black/80 border border-emerald-500/30 p-4 rounded-xl space-y-2">
            <span className="text-emerald-400 font-bold uppercase flex items-center gap-2 text-[11px]">
              <Flame className="w-4 h-4 text-emerald-400" />
              <span>1. HIGHEST REPLY PROBABILITY TARGETS TODAY (SCORE 90+):</span>
            </span>
            <p className="text-zinc-300 font-sans text-xs leading-relaxed">
              <strong>{topTarget?.name || 'Wiz'} (Score 98)</strong> and <strong>Stripe (Score 92)</strong> show 94%+ reply probability. Wiz posted 6 new platform engineering jobs yesterday, and Stripe opened your previous follow-up twice overnight.
            </p>
          </div>

          {/* Section 2: Companies with new engineering activity */}
          <div className="bg-black/80 border border-cyan-500/30 p-4 rounded-xl space-y-2">
            <span className="text-cyan-400 font-bold uppercase flex items-center gap-2 text-[11px]">
              <Zap className="w-4 h-4 text-cyan-400" />
              <span>2. OVERNIGHT ENGINEERING & HIRING SIGNALS:</span>
            </span>
            <p className="text-zinc-300 font-sans text-xs leading-relaxed">
              Modal Labs launched a new serverless GPU container cold-start paper. Datadog updated their ClickHouse vector agent repository with 142 new commits.
            </p>
          </div>

          {/* Section 3: Today's Action Plan */}
          <div className="bg-black/80 border border-purple-500/30 p-4 rounded-xl space-y-2">
            <span className="text-purple-400 font-bold uppercase flex items-center gap-2 text-[11px]">
              <CheckCircle2 className="w-4 h-4 text-purple-400" />
              <span>3. TODAY'S RECOMMENDED EXECUTION SEQUENCE:</span>
            </span>
            <ul className="text-zinc-300 font-sans text-xs space-y-1 list-disc pl-4">
              <li>Execute 12 First Email recons (target send window: 09:00 - 11:30 AM EST).</li>
              <li>Send 9 scheduled Follow-Up #1 & #2 emails.</li>
              <li>Reply to 3 incoming prospect messages in the Reply Centre (2 meeting requests pending).</li>
            </ul>
          </div>

        </div>

        {/* Start Mission Button */}
        <div className="pt-2">
          <button
            onClick={() => {
              onStartMission();
              onClose();
            }}
            className="w-full py-4 bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-500 hover:from-cyan-400 hover:to-blue-400 text-black font-mono text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-[0_0_30px_rgba(6,182,212,0.35)] flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>START TODAY'S MISSION (EST. 48 MINUTES)</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

      </div>
    </div>
  );
};
