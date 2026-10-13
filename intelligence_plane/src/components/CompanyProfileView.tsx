import React, { useState } from 'react';
import { Building2, Search, Cpu, GitBranch, DollarSign, Calendar, FileText, CheckCircle2, ChevronRight, Layers, Users, Zap } from 'lucide-react';
import { TargetCompany } from '../data/mockData';

interface CompanyProfileViewProps {
  companies: TargetCompany[];
}

export const CompanyProfileView: React.FC<CompanyProfileViewProps> = ({ companies }) => {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(companies[0]?.id || '');
  const [searchFilter, setSearchFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'engineering' | 'timeline' | 'documents'>('overview');

  const selectedCompany = companies.find(c => c.id === selectedCompanyId) || companies[0];

  const filteredCompanies = companies.filter(c => 
    c.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
    c.sector.toLowerCase().includes(searchFilter.toLowerCase()) ||
    c.contactName.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="space-y-6 font-sans selection:bg-cyan-500 selection:text-black animate-fadeIn">
      
      {/* Top Header Bar */}
      <div className="flex items-center justify-between border-b border-zinc-900 pb-4 font-mono text-xs">
        <div className="flex items-center gap-3">
          <span className="text-purple-400 font-bold bg-purple-950/40 border border-purple-500/30 px-3 py-1 rounded uppercase flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5" />
            <span>COMPANY INTELLIGENCE DOSSIER</span>
          </span>
          <span className="text-zinc-500">DATABASE: 216 ENTERPRISE ACCOUNTS</span>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 font-mono text-xs">

        {/* Left 4 Cols: Company Directory List */}
        <div className="lg:col-span-4 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search companies, tech, CTOs..."
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-zinc-950 border border-zinc-850 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-purple-400"
            />
          </div>

          <div className="space-y-2 max-h-[620px] overflow-y-auto pr-1">
            {filteredCompanies.map(c => {
              const isSelected = c.id === selectedCompany.id;
              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedCompanyId(c.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#100720] border-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.18)]'
                      : 'bg-zinc-950 border-zinc-900 hover:border-zinc-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-white text-xs uppercase">{c.name}</span>
                    <span className="text-[10px] text-purple-400 font-bold bg-purple-950/60 border border-purple-500/30 px-2 py-0.5 rounded">
                      SCORE {c.priorityScore}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 font-sans">
                    {c.contactName} ({c.contactRole}) • <span className="text-zinc-500">{c.sector}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right 8 Cols: Comprehensive Company Profile & Visual Timeline */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-[#040817] border border-purple-500/40 p-6 sm:p-8 rounded-2xl space-y-6 shadow-[0_10px_50px_rgba(0,0,0,0.8)]">
            
            {/* Target Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-900 pb-5">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="font-display text-2xl font-bold text-white uppercase tracking-wide">
                    {selectedCompany.name}
                  </h2>
                  <span className="text-[10px] text-purple-400 bg-purple-950/60 border border-purple-500/40 px-2.5 py-0.5 rounded font-bold uppercase">
                    {selectedCompany.fundingStage} ({selectedCompany.totalRaised})
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-1 font-mono">
                  Primary Contact: <strong className="text-white">{selectedCompany.contactName}</strong> ({selectedCompany.contactRole}) &lt;{selectedCompany.contactEmail}&gt;
                </p>
              </div>

              <div className="text-right font-mono text-xs">
                <span className="text-cyan-400 font-bold bg-cyan-950/60 border border-cyan-500/30 px-3 py-1 rounded block uppercase">
                  {selectedCompany.currentStage}
                </span>
              </div>
            </div>

            {/* Profile Navigation Tabs */}
            <div className="flex border-b border-zinc-900 gap-4 text-xs font-mono font-bold uppercase">
              {['overview', 'engineering', 'timeline', 'documents'].map(t => (
                <button
                  key={t}
                  onClick={() => setActiveTab(t as any)}
                  className={`pb-2.5 transition-colors border-b-2 cursor-pointer ${
                    activeTab === t
                      ? 'border-purple-400 text-purple-400 font-bold'
                      : 'border-transparent text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  [ {t} ]
                </button>
              ))}
            </div>

            {/* Tab 1: Overview */}
            {activeTab === 'overview' && (
              <div className="space-y-5 animate-fadeIn">
                <div className="bg-black/80 border border-zinc-850 p-4 rounded-xl space-y-2">
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">// WHY NOW SIGNAL SUMMARY</span>
                  <div className="space-y-1.5 font-sans text-xs text-zinc-300">
                    {selectedCompany.whyNowSignals.map((s, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-black/80 border border-zinc-850 p-4 rounded-xl space-y-1">
                    <span className="text-[10px] text-zinc-500 uppercase font-bold block">HIRING SIGNALS</span>
                    <div className="space-y-1 text-xs font-sans text-emerald-400 font-bold">
                      {selectedCompany.hiringSignals.map(h => (
                        <div key={h}>✓ {h}</div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-black/80 border border-zinc-850 p-4 rounded-xl space-y-1">
                    <span className="text-[10px] text-zinc-500 uppercase font-bold block">GITHUB REPO ACTIVITY</span>
                    <p className="text-xs text-cyan-400 font-mono pt-1">
                      {selectedCompany.githubActivity}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Engineering & Tech Stack */}
            {activeTab === 'engineering' && (
              <div className="space-y-5 animate-fadeIn">
                <div className="bg-black/80 border border-zinc-850 p-4 rounded-xl space-y-2">
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">// ARCHITECTURAL BOTTLENECK NOTES</span>
                  <p className="text-xs text-zinc-200 font-sans leading-relaxed">
                    {selectedCompany.architectureNotes}
                  </p>
                </div>

                <div className="bg-black/80 border border-zinc-850 p-4 rounded-xl space-y-2">
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">// DETECTED TECH STACK</span>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {selectedCompany.techStack.map(t => (
                      <span key={t} className="px-3 py-1 bg-zinc-900 border border-zinc-800 rounded text-xs text-cyan-400 font-bold">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 3: Visual Company Timeline */}
            {activeTab === 'timeline' && (
              <div className="space-y-4 animate-fadeIn">
                <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest block">
                  // VISUAL ENGAGEMENT TIMELINE & LIFECYCLE
                </span>

                {/* Horizontal Progress Bar */}
                <div className="flex items-center justify-between bg-black/90 p-4 rounded-xl border border-zinc-850 text-[10px] font-mono text-zinc-400 overflow-x-auto">
                  {['Research', 'Email #1', 'Opened', 'Clicked', 'Follow Up', 'Reply', 'Meeting', 'Proposal', 'Client'].map((step, i) => (
                    <div key={step} className="flex items-center gap-2 shrink-0">
                      <span className={`px-2.5 py-1 rounded font-bold uppercase ${
                        i <= 3 ? 'bg-cyan-950 text-cyan-400 border border-cyan-500/40' : 'bg-zinc-900 text-zinc-600'
                      }`}>
                        {step}
                      </span>
                      {i < 8 && <ChevronRight className="w-3 h-3 text-zinc-700" />}
                    </div>
                  ))}
                </div>

                {/* Vertical Detailed Log */}
                <div className="space-y-3 pt-2">
                  {selectedCompany.timeline.map((item, i) => (
                    <div key={i} className="flex items-start gap-3 bg-black/80 p-3 rounded-lg border border-zinc-850">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                      <div className="flex-1 flex items-center justify-between text-xs">
                        <span className="text-white font-bold">{item.title}</span>
                        <span className="text-zinc-500 text-[10px]">{item.date}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 4: Documents */}
            {activeTab === 'documents' && (
              <div className="space-y-3 font-mono text-xs animate-fadeIn">
                <div className="p-3 bg-black/80 border border-zinc-850 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-cyan-400" />
                    <span>3-Page AST Threat Diagnostic Report ({selectedCompany.name}.pdf)</span>
                  </div>
                  <span className="text-cyan-400 font-bold cursor-pointer hover:underline">DOWNLOAD</span>
                </div>
                <div className="p-3 bg-black/80 border border-zinc-850 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-400" />
                    <span>5-Day Engineering Transformation Sprint Agreement (£25,000).pdf</span>
                  </div>
                  <span className="text-emerald-400 font-bold cursor-pointer hover:underline">DOWNLOAD</span>
                </div>
              </div>
            )}

          </div>
        </div>

      </div>

    </div>
  );
};
