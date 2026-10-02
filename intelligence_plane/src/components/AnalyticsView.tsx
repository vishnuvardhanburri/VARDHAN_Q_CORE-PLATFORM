import React from 'react';
import { BarChart2, TrendingUp, Sparkles, CheckCircle2, Clock, Zap, Target, DollarSign } from 'lucide-react';

export const AnalyticsView: React.FC = () => {
  return (
    <div className="space-y-8 font-sans selection:bg-cyan-500 selection:text-black animate-fadeIn">
      
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-zinc-900 pb-4 font-mono text-xs">
        <div className="flex items-center gap-3">
          <span className="text-emerald-400 font-bold bg-emerald-950/40 border border-emerald-500/30 px-3 py-1 rounded uppercase flex items-center gap-2">
            <BarChart2 className="w-3.5 h-3.5" />
            <span>VISUAL PERFORMANCE ANALYTICS & NIGHTLY AI INSIGHTS</span>
          </span>
          <span className="text-zinc-500">DATABASE: 216 ENTERPRISE ACCOUNTS</span>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono text-xs">
        <div className="bg-zinc-950/80 border border-cyan-500/30 p-5 rounded-2xl space-y-1">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-bold">TOTAL SENT</span>
          <div className="text-3xl font-bold text-cyan-400">142</div>
          <span className="text-[9px] text-zinc-500">Outbound Recons</span>
        </div>

        <div className="bg-zinc-950/80 border border-emerald-500/30 p-5 rounded-2xl space-y-1">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-bold">OPEN RATE</span>
          <div className="text-3xl font-bold text-emerald-400">68.4%</div>
          <span className="text-[9px] text-emerald-500">Top 1% Industry</span>
        </div>

        <div className="bg-zinc-950/80 border border-amber-500/30 p-5 rounded-2xl space-y-1">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-bold">REPLY RATE</span>
          <div className="text-3xl font-bold text-amber-400">24.8%</div>
          <span className="text-[9px] text-amber-500">Positive Intent</span>
        </div>

        <div className="bg-zinc-950/80 border border-purple-500/30 p-5 rounded-2xl space-y-1">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-bold">MEETING CONVERSION</span>
          <div className="text-3xl font-bold text-purple-400">11.2%</div>
          <span className="text-[9px] text-purple-400 font-bold">£40,000 Pipeline</span>
        </div>
      </div>

      {/* Main Grid: Nightly AI Insights & Best Performers */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 font-mono text-xs">

        {/* Left 7 Cols: Nightly AI Optimization Recommendations */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-[#030919] border border-cyan-500/40 p-6 sm:p-8 rounded-2xl space-y-6 shadow-[0_10px_40px_rgba(0,0,0,0.8)]">
            
            <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-sm border-b border-zinc-900 pb-4">
              <Sparkles className="w-5 h-5 text-cyan-400" />
              <span>NIGHTLY AI DATABASE INSIGHTS & RECOMMENDATIONS</span>
            </div>

            <div className="space-y-4 font-sans text-xs">
              <div className="bg-black/80 border border-emerald-500/30 p-4 rounded-xl space-y-1.5">
                <span className="text-emerald-400 font-mono font-bold uppercase text-[10px] block">✓ TOP PERFORMING PERSONA:</span>
                <p className="text-zinc-200 leading-relaxed font-mono">
                  CTOs and VPs of Engineering at Series A/B infrastructure companies convert at a <strong>32.4% reply rate</strong> compared to 12.1% for general leads.
                </p>
              </div>

              <div className="bg-black/80 border border-cyan-500/30 p-4 rounded-xl space-y-1.5">
                <span className="text-cyan-400 font-mono font-bold uppercase text-[10px] block">✓ OPTIMAL EMAIL LENGTH & STRUCTURE:</span>
                <p className="text-zinc-200 leading-relaxed font-mono">
                  Short 70–90 word first-person technical emails with specific eBPF/Postgres lock mentions produce <strong>3x more positive replies</strong> than generic service outlines.
                </p>
              </div>

              <div className="bg-black/80 border border-amber-500/30 p-4 rounded-xl space-y-1.5">
                <span className="text-amber-400 font-mono font-bold uppercase text-[10px] block">⚠️ DISCONTINUE OUTREACH RECOMMENDATION:</span>
                <p className="text-zinc-200 leading-relaxed font-mono">
                  Stop emailing companies with &lt;10 engineering team members (0 replies across 24 accounts). Reallocate focus to accounts with active hiring signals.
                </p>
              </div>
            </div>

          </div>
        </div>

        {/* Right 5 Cols: Best Performers */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-zinc-950 border border-zinc-850 p-6 rounded-2xl space-y-4">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest block font-mono">
              // BEST PERFORMING SUBJECT LINES
            </span>

            <div className="space-y-2.5 font-mono text-xs">
              <div className="p-3 bg-black border border-zinc-850 rounded-xl space-y-1">
                <span className="text-cyan-400 font-bold block">"Engineering Intelligence Recon: [Company] (AST Analysis)"</span>
                <span className="text-[10px] text-emerald-400 font-bold">Open Rate: 74.2% • Reply Rate: 28.1%</span>
              </div>

              <div className="p-3 bg-black border border-zinc-850 rounded-xl space-y-1">
                <span className="text-cyan-400 font-bold block">"PostgreSQL Row-Level Lock Remediation ([Company])"</span>
                <span className="text-[10px] text-emerald-400 font-bold">Open Rate: 69.8% • Reply Rate: 25.4%</span>
              </div>

              <div className="p-3 bg-black border border-zinc-850 rounded-xl space-y-1">
                <span className="text-cyan-400 font-bold block">"Serverless GPU Container Latency Audit ([Company])"</span>
                <span className="text-[10px] text-emerald-400 font-bold">Open Rate: 65.1% • Reply Rate: 22.0%</span>
              </div>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};
