import React, { useState, useEffect } from 'react';
import { Search, Zap, Building2, Mail, MessageSquare, BarChart2, Shield, X, ArrowRight, CornerDownLeft } from 'lucide-react';
import { TargetCompany, ProspectReply } from '../data/mockData';

interface CommandBarProps {
  isOpen: boolean;
  onClose: () => void;
  companies: TargetCompany[];
  replies: ProspectReply[];
  onSelectCompany: (company: TargetCompany) => void;
  onSelectTab: (tab: string) => void;
}

export const CommandBar: React.FC<CommandBarProps> = ({
  isOpen,
  onClose,
  companies,
  replies,
  onSelectCompany,
  onSelectTab
}) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        isOpen ? onClose() : undefined;
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const matchingCompanies = companies.filter(c => 
    c.name.toLowerCase().includes(query.toLowerCase()) || 
    c.sector.toLowerCase().includes(query.toLowerCase()) ||
    c.contactName.toLowerCase().includes(query.toLowerCase())
  );

  const matchingReplies = replies.filter(r =>
    r.companyName.toLowerCase().includes(query.toLowerCase()) ||
    r.contactName.toLowerCase().includes(query.toLowerCase()) ||
    r.subject.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-start justify-center pt-24 px-4 font-sans animate-fadeIn">
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col">
        
        {/* Search Input Bar */}
        <div className="relative flex items-center border-b border-zinc-850 px-4 py-3.5">
          <Search className="w-5 h-5 text-cyan-400 mr-3 shrink-0" />
          <input
            type="text"
            autoFocus
            placeholder="Search anything (Companies, CTOs, AI Scores, Replies, Research)..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none font-mono"
          />
          <button 
            onClick={onClose} 
            className="text-zinc-500 hover:text-zinc-300 p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Command Options List */}
        <div className="max-h-[420px] overflow-y-auto p-3 space-y-4 font-mono text-xs">

          {/* System Quick Commands */}
          {!query && (
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold px-2 block mb-1">
                // MISSION SHORTCUTS
              </span>

              <div 
                onClick={() => { onSelectTab('mission'); onClose(); }}
                className="flex items-center justify-between p-2.5 rounded-lg hover:bg-zinc-900 text-zinc-300 hover:text-cyan-400 cursor-pointer group"
              >
                <div className="flex items-center gap-2.5">
                  <Zap className="w-4 h-4 text-cyan-400" />
                  <span>Go to Daily Mission Control</span>
                </div>
                <span className="text-[10px] text-zinc-500 group-hover:text-zinc-300">⌘1</span>
              </div>

              <div 
                onClick={() => { onSelectTab('queue'); onClose(); }}
                className="flex items-center justify-between p-2.5 rounded-lg hover:bg-zinc-900 text-zinc-300 hover:text-cyan-400 cursor-pointer group"
              >
                <div className="flex items-center gap-2.5">
                  <Mail className="w-4 h-4 text-emerald-400" />
                  <span>Open Live Action Queue & Composer</span>
                </div>
                <span className="text-[10px] text-zinc-500 group-hover:text-zinc-300">⌘2</span>
              </div>

              <div 
                onClick={() => { onSelectTab('replies'); onClose(); }}
                className="flex items-center justify-between p-2.5 rounded-lg hover:bg-zinc-900 text-zinc-300 hover:text-cyan-400 cursor-pointer group"
              >
                <div className="flex items-center gap-2.5">
                  <MessageSquare className="w-4 h-4 text-amber-400" />
                  <span>View Prospect Reply Centre</span>
                </div>
                <span className="text-[10px] text-zinc-500 group-hover:text-zinc-300">⌘3</span>
              </div>

              <div 
                onClick={() => { onSelectTab('dossiers'); onClose(); }}
                className="flex items-center justify-between p-2.5 rounded-lg hover:bg-zinc-900 text-zinc-300 hover:text-cyan-400 cursor-pointer group"
              >
                <div className="flex items-center gap-2.5">
                  <Building2 className="w-4 h-4 text-purple-400" />
                  <span>Company Intelligence Profiles</span>
                </div>
                <span className="text-[10px] text-zinc-500 group-hover:text-zinc-300">⌘4</span>
              </div>
            </div>
          )}

          {/* Companies Match Section */}
          {matchingCompanies.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold px-2 block mb-1">
                // MATCHING TARGET ACCOUNTS ({matchingCompanies.length})
              </span>

              {matchingCompanies.map(c => (
                <div
                  key={c.id}
                  onClick={() => {
                    onSelectCompany(c);
                    onSelectTab('queue');
                    onClose();
                  }}
                  className="flex items-center justify-between p-2.5 rounded-lg hover:bg-zinc-900 hover:border-cyan-500/40 border border-transparent cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded bg-cyan-950/80 text-cyan-400 flex items-center justify-center text-[10px] font-bold border border-cyan-500/30">
                      {c.priorityScore}
                    </span>
                    <div>
                      <span className="font-bold text-white group-hover:text-cyan-400 block">{c.name}</span>
                      <span className="text-[10px] text-zinc-400 font-sans">{c.contactName} ({c.contactRole}) • {c.sector}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                    <span className="px-2 py-0.5 rounded bg-zinc-900 text-cyan-400 border border-zinc-800">{c.currentStage}</span>
                    <CornerDownLeft className="w-3 h-3 text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Prospect Replies Match Section */}
          {matchingReplies.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold px-2 block mb-1">
                // PROSPECT REPLIES ({matchingReplies.length})
              </span>

              {matchingReplies.map(r => (
                <div
                  key={r.id}
                  onClick={() => {
                    onSelectTab('replies');
                    onClose();
                  }}
                  className="flex items-center justify-between p-2.5 rounded-lg hover:bg-zinc-900 hover:border-emerald-500/40 border border-transparent cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <div>
                      <span className="font-bold text-white group-hover:text-emerald-400 block">{r.companyName} — {r.contactName}</span>
                      <span className="text-[10px] text-zinc-400 font-sans line-clamp-1">{r.subject}</span>
                    </div>
                  </div>

                  <span className="text-[10px] text-emerald-400 font-mono font-bold bg-emerald-950/60 border border-emerald-500/40 px-2 py-0.5 rounded">
                    {r.category}
                  </span>
                </div>
              ))}
            </div>
          )}

        </div>

        {/* Command Footer */}
        <div className="border-t border-zinc-900 px-4 py-2 bg-zinc-950 flex items-center justify-between text-[10px] font-mono text-zinc-500">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
          <span className="text-cyan-400 font-bold">VARDHAN OPERATING SYSTEM V2.4</span>
        </div>

      </div>
    </div>
  );
};
