import React, { useState } from 'react';
import { Send, Copy, RefreshCw, Edit3, Clock, ShieldCheck, Sparkles, Save, CheckCircle2, ArrowRight, ArrowLeft, ChevronLeft, ChevronRight, Zap, AlertTriangle } from 'lucide-react';
import { TargetCompany } from '../data/mockData';

interface ActionQueueViewProps {
  companies: TargetCompany[];
  activeCompany: TargetCompany;
  onSelectCompany: (company: TargetCompany) => void;
  onSendEmail: (companyId: string) => void;
}

export const ActionQueueView: React.FC<ActionQueueViewProps> = ({
  companies,
  activeCompany,
  onSelectCompany,
  onSendEmail
}) => {
  const [emailSubject, setEmailSubject] = useState(activeCompany.emailSubject);
  const [emailBody, setEmailBody] = useState(activeCompany.emailBody);
  const [isEditing, setIsEditing] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Sync state when active company changes
  React.useEffect(() => {
    setEmailSubject(activeCompany.emailSubject);
    setEmailBody(activeCompany.emailBody);
  }, [activeCompany]);

  const currentIndex = companies.findIndex(c => c.id === activeCompany.id);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;

  const handlePrev = () => {
    if (safeIndex > 0) {
      onSelectCompany(companies[safeIndex - 1]);
    }
  };

  const handleNext = () => {
    if (safeIndex < companies.length - 1) {
      onSelectCompany(companies[safeIndex + 1]);
    }
  };

  const handleSendAndAdvance = () => {
    onSendEmail(activeCompany.id);
    if (safeIndex < companies.length - 1) {
      onSelectCompany(companies[safeIndex + 1]);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(`TO: ${activeCompany.contactEmail}\nSUBJECT: ${emailSubject}\n\n${emailBody}`);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  const handleRegenerate = () => {
    setIsRegenerating(true);
    setTimeout(() => {
      setEmailBody(`Hi ${activeCompany.contactName.split(' ')[0]},\n\nOur automated AI telemetry scanner identified AST query latency anomalies and PostgreSQL row-level lock contention inside ${activeCompany.name}'s ingestion layer.\n\nAt VARDHAN Technologies, we specialize in high-velocity 5-day architectural refactoring sprints. We recently refactored a high-frequency payment pipeline, dropping p99 latencies from 4.8s to 1.42ms under 10x traffic surge.\n\nWe authored a concise 3-page AST threat diagnostic report specifically for ${activeCompany.name}. Mind if I send over the audit breakdown?\n\nBest regards,\n\nVishnu Vardhan Burri\nPrincipal Architect | VARDHAN Technologies\nhttps://www.vardhantechlabs.com`);
      setIsRegenerating(false);
    }, 600);
  };

  return (
    <div className="space-y-6 font-sans selection:bg-cyan-500 selection:text-black animate-fadeIn">
      
      {/* Top Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-900 pb-4 font-mono text-xs">
        <div className="flex items-center gap-3">
          <span className="text-cyan-400 font-bold bg-cyan-950/60 border border-cyan-500/30 px-3 py-1 rounded uppercase flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 fill-cyan-400" />
            <span>EMAIL COMPOSER • HIGH-INTENSITY WRITER</span>
          </span>
          <span className="text-zinc-500">TARGET #{safeIndex + 1} OF {companies.length}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePrev}
            disabled={safeIndex === 0}
            className="px-3 py-1.5 bg-zinc-950 hover:bg-zinc-900 disabled:opacity-40 border border-zinc-800 text-zinc-300 rounded font-bold transition-colors flex items-center gap-1 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>PREV TARGET</span>
          </button>

          <button
            onClick={handleNext}
            disabled={safeIndex === companies.length - 1}
            className="px-3 py-1.5 bg-zinc-950 hover:bg-zinc-900 disabled:opacity-40 border border-zinc-800 text-zinc-300 rounded font-bold transition-colors flex items-center gap-1 cursor-pointer"
          >
            <span>NEXT TARGET</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Composer Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* Left 8 Cols: Large Clean Writing Interface */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-[#030816] border border-cyan-500/40 p-6 sm:p-8 rounded-2xl space-y-6 shadow-[0_10px_50px_rgba(0,0,0,0.9)] relative">
            
            {/* Contact Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-900 pb-5">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-2xl font-bold text-white uppercase tracking-wide">
                    {activeCompany.name}
                  </h2>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-500/40 px-2 py-0.5 rounded font-bold uppercase">
                    SCORE {activeCompany.priorityScore}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 font-mono mt-1">
                  Recipient: <span className="text-white font-bold">{activeCompany.contactName}</span> ({activeCompany.contactRole}) &lt;{activeCompany.contactEmail}&gt;
                </p>
              </div>

              <div className="text-right font-mono text-xs">
                <span className="text-cyan-400 font-bold bg-cyan-950/60 border border-cyan-500/30 px-3 py-1 rounded block uppercase">
                  {activeCompany.currentStage}
                </span>
                <span className="text-amber-400 text-[10px] block mt-1">TIMING: {activeCompany.dueUrgency}</span>
              </div>
            </div>

            {/* AI Metric Pills */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
              <div className="bg-black/80 border border-zinc-850 p-2.5 rounded-lg flex items-center justify-between">
                <span className="text-zinc-500 text-[10px]">READING TIME</span>
                <span className="text-cyan-400 font-bold flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>{activeCompany.readingTime}</span>
                </span>
              </div>

              <div className="bg-black/80 border border-zinc-850 p-2.5 rounded-lg flex items-center justify-between">
                <span className="text-zinc-500 text-[10px]">PERSONALISATION</span>
                <span className="text-emerald-400 font-bold">{activeCompany.personalisationScore}/100</span>
              </div>

              <div className="bg-black/80 border border-zinc-850 p-2.5 rounded-lg flex items-center justify-between">
                <span className="text-zinc-500 text-[10px]">SPAM RISK</span>
                <span className="text-emerald-400 font-bold">{activeCompany.spamScore}% (SAFE)</span>
              </div>

              <div className="bg-black/80 border border-zinc-850 p-2.5 rounded-lg flex items-center justify-between">
                <span className="text-zinc-500 text-[10px]">AI CONFIDENCE</span>
                <span className="text-purple-400 font-bold">{activeCompany.aiConfidence}%</span>
              </div>
            </div>

            {/* Email Subject Line */}
            <div className="space-y-1.5 font-mono text-xs">
              <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">SUBJECT LINE:</label>
              <input
                type="text"
                value={emailSubject}
                onChange={e => setEmailSubject(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-850 rounded-xl p-3 text-cyan-400 font-bold text-sm focus:outline-none focus:border-cyan-400"
              />
            </div>

            {/* Full Email Writing Area */}
            <div className="space-y-1.5 font-mono text-xs">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">SUPERHUMAN EMAIL BODY:</label>
                <span className="text-[10px] text-zinc-500">{emailBody.split(/\s+/).length} words</span>
              </div>
              
              <textarea
                rows={12}
                value={emailBody}
                onChange={e => setEmailBody(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-850 rounded-xl p-4 text-zinc-200 leading-relaxed font-mono text-xs focus:outline-none focus:border-cyan-400 resize-none"
              />
            </div>

            {/* Action Bar Buttons */}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                onClick={handleSendAndAdvance}
                className="flex-1 py-4 bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-500 hover:from-cyan-400 hover:to-blue-400 text-black font-mono text-xs font-bold uppercase rounded-xl transition-all shadow-[0_0_25px_rgba(6,182,212,0.35)] flex items-center justify-center gap-2 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>🚀 SEND EMAIL & AUTO-ADVANCE NEXT (PRESS ENTER)</span>
              </button>

              <button
                onClick={handleRegenerate}
                disabled={isRegenerating}
                className="px-4 py-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-purple-400 font-mono text-xs font-bold uppercase rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className={`w-4 h-4 ${isRegenerating ? 'animate-spin' : ''}`} />
                <span>REWRITE WITH AI</span>
              </button>

              <button
                onClick={handleCopy}
                className="px-4 py-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-mono text-xs font-bold uppercase rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-4 h-4" />
                <span>{copyFeedback ? 'COPIED!' : 'COPY'}</span>
              </button>
            </div>

          </div>
        </div>

        {/* Right 4 Cols: Company Intelligence & Signals Sidebar */}
        <div className="lg:col-span-4 space-y-6 font-mono text-xs">
          
          {/* Why Email Today */}
          <div className="bg-zinc-950 border border-cyan-500/30 p-5 rounded-2xl space-y-3 shadow-md">
            <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-xs">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span>WHY EMAIL {activeCompany.name.toUpperCase()} TODAY</span>
            </div>

            <div className="space-y-2">
              {activeCompany.whyNowSignals.map((sig, i) => (
                <div key={i} className="flex items-start gap-2 text-zinc-300 font-sans text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                  <span>{sig}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Target Technology Footprint */}
          <div className="bg-zinc-950 border border-zinc-850 p-5 rounded-2xl space-y-3">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider block">
              // ARCHITECTURAL FOOTPRINT
            </span>

            <div className="flex flex-wrap gap-1.5">
              {activeCompany.techStack.map(t => (
                <span key={t} className="px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded text-[10px] text-cyan-400 font-bold">
                  {t}
                </span>
              ))}
            </div>

            <div className="pt-2 text-xs text-zinc-400 font-sans border-t border-zinc-900">
              <strong>Notes:</strong> {activeCompany.architectureNotes}
            </div>
          </div>

          {/* Hiring Signals */}
          <div className="bg-zinc-950 border border-zinc-850 p-5 rounded-2xl space-y-3">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider block">
              // ACTIVE HIRING SIGNALS
            </span>

            <div className="space-y-1.5">
              {activeCompany.hiringSignals.map(h => (
                <div key={h} className="text-xs text-emerald-400 font-sans flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>{h}</span>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};
