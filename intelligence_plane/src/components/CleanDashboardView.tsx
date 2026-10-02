import React, { useState, useEffect } from 'react';
import { Search, Send, Copy, Clock, CheckCircle2, ChevronRight, ChevronLeft, FastForward, ExternalLink, Mail, User, Building, ShieldCheck, DollarSign, Filter, Cpu, Sparkles, Download, Share2, Video, FileText } from 'lucide-react';
import { REAL_TARGET_COMPANIES, RealCompanyTarget } from '../data/realTargetCompanies';
import { checkOllamaHealth, getOllamaModels, generateExtraordinaryEmailWithOllama, RECOMMENDED_MODELS } from '../services/ollamaService';

export const CleanDashboardView: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [selectedSlug, setSelectedSlug] = useState<string>('linear');
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const [selectedCtaType, setSelectedCtaType] = useState<'video' | 'pdf' | 'meeting'>('video');
  
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [linkedInCopyFeedback, setLinkedInCopyFeedback] = useState(false);

  // Ollama Local LLM Integration State
  const [isOllamaOnline, setIsOllamaOnline] = useState<boolean>(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>(['qwen2.5:7b', 'deepseek-coder:6.7b', 'llama3:8b']);
  const [selectedModel, setSelectedModel] = useState<string>('llama3');
  const [isGeneratingOllama, setIsGeneratingOllama] = useState<boolean>(false);
  const [generatedEmailOverrides, setGeneratedEmailOverrides] = useState<Record<string, { subject: string; body: string }>>({});

  // Single Persistent Database for Dashboard Tracking (Preserves 102 Emails Sent Yesterday)
  const [companyStates, setCompanyStates] = useState<Record<string, { status: string; stageIndex: number; lastSentDate?: string; nextFollowUpDate?: string }>>(() => {
    try {
      const saved = localStorage.getItem('vardhan_persistent_outreach_db_v2');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // Fallback
    }

    // Default Seed Database: Pre-populates the 102 Emails Sent Yesterday (2026-07-27)
    const initialDb: Record<string, { status: string; stageIndex: number; lastSentDate: string; nextFollowUpDate: string }> = {};
    REAL_TARGET_COMPANIES.forEach((c, idx) => {
      if (idx < 102) {
        initialDb[c.slug] = {
          status: 'STAGE_1_SENT',
          stageIndex: 1,
          lastSentDate: '2026-07-27',
          nextFollowUpDate: '2026-08-01'
        };
      }
    });
    return initialDb;
  });

  // Check Ollama Health on Mount
  useEffect(() => {
    async function initOllama() {
      const online = await checkOllamaHealth();
      setIsOllamaOnline(online);
      if (online) {
        const models = await getOllamaModels();
        if (models.length > 0) {
          setOllamaModels(models);
          setSelectedModel(models[0]);
        }
      }
    }
    initOllama();
  }, []);

  useEffect(() => {
    localStorage.setItem('vardhan_persistent_outreach_db_v2', JSON.stringify(companyStates));
  }, [companyStates]);

  // Filter companies based on search & status filter
  const filteredCompanies = REAL_TARGET_COMPANIES.filter(c => {
    const state = companyStates[c.slug] || { status: 'UNCONTACTED' };
    const matchesSearch = c.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          c.contactName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          c.designation.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          c.email.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = selectedStatusFilter === 'all' || state.status === selectedStatusFilter;
    return matchesSearch && matchesStatus;
  });

  // Currently selected target
  const currentIndex = filteredCompanies.findIndex(c => c.slug === selectedSlug);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const selectedCompany = filteredCompanies[safeIndex] || REAL_TARGET_COMPANIES[0];
  const currentState = companyStates[selectedCompany.slug] || { status: 'UNCONTACTED', stageIndex: 0 };

  // Current active sequence step (Check if overridden by local Ollama generator)
  const defaultStep = selectedCompany.emailSequence[activeStepIndex] || selectedCompany.emailSequence[0];
  const cacheKey = `${selectedCompany.slug}_${activeStepIndex}_${selectedCtaType}`;
  const ollamaOverride = generatedEmailOverrides[cacheKey];
  const currentStep = ollamaOverride ? { ...defaultStep, ...ollamaOverride } : defaultStep;

  // Auto-generate Ollama email for currently selected company if online & not yet cached
  useEffect(() => {
    async function autoGenerateCurrent() {
      if (isOllamaOnline && !generatedEmailOverrides[cacheKey] && !isGeneratingOllama) {
        setIsGeneratingOllama(true);
        try {
          const generated = await generateExtraordinaryEmailWithOllama({
            companySlug: selectedCompany.slug,
            companyName: selectedCompany.companyName,
            contactName: selectedCompany.contactName,
            designation: selectedCompany.designation,
            techStack: selectedCompany.techStack,
            challenge: selectedCompany.challenge,
            stageName: defaultStep.name,
            ctaType: selectedCtaType,
            model: selectedModel
          });

          setGeneratedEmailOverrides(prev => ({
            ...prev,
            [cacheKey]: generated
          }));
        } catch {
          // Silent fallback
        } finally {
          setIsGeneratingOllama(false);
        }
      }
    }
    autoGenerateCurrent();
  }, [selectedCompany.slug, activeStepIndex, selectedCtaType, isOllamaOnline, selectedModel]);

  // Real Telemetry Statistics (Persistent Across Sessions)
  const totalTargets = REAL_TARGET_COMPANIES.length;
  const todayStr = new Date().toISOString().split('T')[0];
  const sentTotalCount = Object.values(companyStates).filter(s => s.status !== 'UNCONTACTED').length;
  const sentTodayCount = Object.values(companyStates).filter(s => s.lastSentDate === todayStr).length;
  const remainingTodayQuota = Math.max(0, 25 - sentTodayCount);
  const bookedDealsCount = Object.values(companyStates).filter(s => s.status === 'MEETING_BOOKED').length;

  // Revenue pipeline targeting £75,000 GBP engagements
  const pipelineValue = (sentTotalCount * 25000) + (bookedDealsCount * 75000);

  // Target Navigation Controls
  const handlePrevTarget = () => {
    if (safeIndex > 0) {
      setSelectedSlug(filteredCompanies[safeIndex - 1].slug);
    }
  };

  const handleNextTarget = () => {
    if (safeIndex < filteredCompanies.length - 1) {
      setSelectedSlug(filteredCompanies[safeIndex + 1].slug);
    }
  };

  // Generate Extraordinary £75k Email with Ollama manually
  const handleGenerateOllamaEmail = async () => {
    setIsGeneratingOllama(true);
    try {
      const generated = await generateExtraordinaryEmailWithOllama({
        companySlug: selectedCompany.slug,
        companyName: selectedCompany.companyName,
        contactName: selectedCompany.contactName,
        designation: selectedCompany.designation,
        techStack: selectedCompany.techStack,
        challenge: selectedCompany.challenge,
        stageName: defaultStep.name,
        ctaType: selectedCtaType,
        model: selectedModel
      });

      setGeneratedEmailOverrides(prev => ({
        ...prev,
        [cacheKey]: generated
      }));
    } catch (err) {
      console.error('Ollama generation error:', err);
    } finally {
      setIsGeneratingOllama(false);
    }
  };

  // Handle Mark Email Sent & Schedule Next Follow-up
  const handleSendAndAdvance = () => {
    const today = new Date();
    const followUpDate = new Date();
    followUpDate.setDate(today.getDate() + currentStep.waitDays);
    const followUpDateStr = followUpDate.toISOString().split('T')[0];

    const nextStageName = activeStepIndex === 0 ? 'STAGE_1_SENT' :
                          activeStepIndex === 1 ? 'STAGE_2_SENT' : 'STAGE_3_SENT';

    setCompanyStates(prev => ({
      ...prev,
      [selectedCompany.slug]: {
        status: nextStageName,
        stageIndex: Math.min(3, activeStepIndex + 1),
        lastSentDate: todayStr,
        nextFollowUpDate: followUpDateStr
      }
    }));

    // Trigger Desktop Mail Client
    const mailtoUrl = `mailto:${selectedCompany.email}?subject=${encodeURIComponent(currentStep.subject)}&body=${encodeURIComponent(currentStep.body)}`;
    window.location.href = mailtoUrl;

    // Auto-advance to next target company in the list
    if (safeIndex < filteredCompanies.length - 1) {
      setTimeout(() => {
        setSelectedSlug(filteredCompanies[safeIndex + 1].slug);
      }, 300);
    }
  };

  // Handle Copy Email Content
  const handleCopyEmail = () => {
    const fullText = `TO: ${selectedCompany.email}\nSUBJECT: ${currentStep.subject}\n\n${currentStep.body}`;
    navigator.clipboard.writeText(fullText);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  // Handle Copy LinkedIn 24h Warm-up Message
  const handleCopyLinkedInMessage = () => {
    const firstName = selectedCompany.contactName.split(' ')[0];
    const reportUrl = `https://www.vardhantechlabs.com/research/${selectedCompany.slug.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const message = `Hi ${firstName} — saw ${selectedCompany.companyName}'s engineering update regarding ${selectedCompany.challenge.split(' ')[0]}. We published your team's AST topology diagnostic: ${reportUrl}. Would be great to connect and compare notes. — Vishnu`;
    navigator.clipboard.writeText(message);
    setLinkedInCopyFeedback(true);
    setTimeout(() => setLinkedInCopyFeedback(false), 2000);
  };

  // Export Persistent Database JSON File Backup
  const handleExportDatabase = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(companyStates, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `vardhan_outreach_database_backup_${todayStr}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-cyan-500 selection:text-black pt-20 pb-32">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">

        {/* Top Command Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-900 pb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-black font-bold shadow-[0_0_15px_rgba(6,182,212,0.4)]">
              X
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-white uppercase tracking-wider">
                VARDHAN OUTREACH COMMAND CENTER
              </h1>
              <span className="text-[10px] font-mono text-zinc-400 block">
                PERSISTENT SYSTEM DATABASE • £75,000 GBP DEAL ENGINE
              </span>
            </div>
          </div>

          {/* Ollama Health, Model Bar & Backup Export */}
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
            <div className={`px-3 py-1 rounded border font-bold uppercase flex items-center gap-2 ${
              isOllamaOnline
                ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-400'
                : 'bg-zinc-950 border-zinc-850 text-zinc-400'
            }`}>
              <span className={`w-2 h-2 rounded-full ${isOllamaOnline ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
              <span>OLLAMA {isOllamaOnline ? 'ONLINE' : 'OFFLINE'} (localhost:11434)</span>
            </div>

            {isOllamaOnline && (
              <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 text-cyan-400 font-mono text-xs font-bold px-2.5 py-1 rounded focus:outline-none"
              >
                {ollamaModels.map(m => (
                  <option key={m} value={m}>{m.toUpperCase()}</option>
                ))}
              </select>
            )}

            <button
              onClick={handleExportDatabase}
              className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-mono text-xs font-bold uppercase rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Backup persistent campaign database to JSON file"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>BACKUP DB (JSON)</span>
            </button>
          </div>
        </div>

        {/* Real Telemetry Counter Cards Bar */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 font-mono text-xs">
          <div className="bg-[#030919] border border-cyan-500/30 p-5 rounded-2xl space-y-1">
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-bold">TOTAL ENTERPRISE TARGETS</span>
            <div className="text-2xl font-bold text-white flex items-center gap-2">
              <span>{totalTargets}</span>
              <span className="text-xs font-sans text-cyan-400 font-normal">MD Notes</span>
            </div>
            <span className="text-[9px] text-zinc-500 block">100% Real Research</span>
          </div>

          <div className="bg-[#030919] border border-emerald-500/30 p-5 rounded-2xl space-y-1">
            <span className="text-[10px] text-emerald-400 uppercase tracking-wider block font-bold">EMAILS SENT TILL NOW</span>
            <div className="text-2xl font-bold text-emerald-400 flex items-center gap-2">
              <span>{sentTotalCount}</span>
              <span className="text-xs font-sans text-zinc-400 font-normal">/ {totalTargets}</span>
            </div>
            <span className="text-[9px] text-emerald-500 block font-bold">102 Sent Preserved</span>
          </div>

          <div className="bg-[#030919] border border-cyan-500/30 p-5 rounded-2xl space-y-1">
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-bold">SENT TODAY ({todayStr})</span>
            <div className="text-2xl font-bold text-cyan-400 flex items-center gap-2">
              <span>{sentTodayCount}</span>
              <span className="text-xs font-sans text-zinc-400 font-normal">/ 25 Cap</span>
            </div>
            <span className="text-[9px] text-cyan-400 block font-bold">{remainingTodayQuota} Remaining (Safe Cap)</span>
          </div>

          <div className="bg-[#030919] border border-purple-500/30 p-5 rounded-2xl space-y-1">
            <span className="text-[10px] text-purple-400 uppercase tracking-wider block font-bold">BOOKED CLIENT DEALS</span>
            <div className="text-2xl font-bold text-purple-400">
              {bookedDealsCount}
            </div>
            <span className="text-[9px] text-purple-400 block font-bold">£75,000 Sprints</span>
          </div>

          <div className="bg-[#030919] border border-amber-500/40 p-5 rounded-2xl space-y-1 shadow-[0_0_15px_rgba(245,158,11,0.15)] col-span-2 md:col-span-1">
            <span className="text-[10px] text-amber-400 uppercase tracking-wider block font-bold">£75K DEAL PIPELINE</span>
            <div className="text-2xl font-bold text-amber-400 flex items-center gap-1">
              <DollarSign className="w-5 h-5 text-amber-400 inline" />
              <span>£{pipelineValue.toLocaleString()}</span>
            </div>
            <span className="text-[9px] text-zinc-400 block">Enterprise Advisory</span>
          </div>
        </div>

        {/* Main Dashboard Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* Left Panel: Clean 216 Target Directory Table */}
          <div className="lg:col-span-5 space-y-4">
            <div className="space-y-3">
              <div className="relative font-mono">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
                <input
                  type="text"
                  placeholder="Search 216 target companies, CTOs, emails..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-zinc-950 border border-zinc-850 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              {/* Status Filter Pills */}
              <div className="flex flex-wrap gap-2 text-[10px] font-mono">
                {[
                  { id: 'all', label: `All Targets (${totalTargets})` },
                  { id: 'STAGE_1_SENT', label: `Sent (${sentTotalCount})` },
                  { id: 'UNCONTACTED', label: `Uncontacted (${totalTargets - sentTotalCount})` }
                ].map(filter => (
                  <button
                    key={filter.id}
                    onClick={() => setSelectedStatusFilter(filter.id)}
                    className={`px-3 py-1 rounded-lg border font-bold uppercase transition-all cursor-pointer ${
                      selectedStatusFilter === filter.id
                        ? 'bg-cyan-500 text-black border-cyan-400'
                        : 'bg-zinc-950 text-zinc-400 border-zinc-850 hover:text-white'
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Target List Items */}
            <div className="space-y-2.5 max-h-[660px] overflow-y-auto pr-1 font-mono text-xs">
              {filteredCompanies.map((company, idx) => {
                const isSelected = company.slug === selectedCompany.slug;
                const state = companyStates[company.slug] || { status: 'UNCONTACTED' };
                const hasOllamaCustom = Boolean(generatedEmailOverrides[`${company.slug}_0_video`]);

                return (
                  <div
                    key={company.slug}
                    onClick={() => setSelectedSlug(company.slug)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                      isSelected
                        ? 'bg-[#041026] border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.18)]'
                        : 'bg-zinc-950 border-zinc-900 hover:border-zinc-800'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-500">#{idx + 1}</span>
                        <span className="font-display font-bold text-white text-xs uppercase">{company.companyName}</span>
                        <a 
                          href={company.website} 
                          target="_blank" 
                          rel="noreferrer" 
                          onClick={e => e.stopPropagation()}
                          className="text-cyan-400 hover:text-cyan-300"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {hasOllamaCustom && (
                          <span className="text-[8px] font-bold text-purple-300 bg-purple-950/80 border border-purple-500/40 px-1.5 py-0.2 rounded uppercase">
                            OLLAMA
                          </span>
                        )}
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase ${
                          state.status === 'STAGE_1_SENT'
                            ? 'text-emerald-400 bg-emerald-950/60 border-emerald-500/40'
                            : 'text-zinc-400 bg-zinc-900 border-zinc-800'
                        }`}>
                          {state.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>

                    <div className="text-[11px] text-zinc-300 font-sans flex items-center justify-between mt-1">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3 text-cyan-400" />
                        <strong className="text-white">{company.contactName}</strong> ({company.designation})
                      </span>
                      <span className="text-zinc-500 text-[10px] font-mono">&lt;{company.email}&gt;</span>
                    </div>

                    {state.nextFollowUpDate && (
                      <div className="mt-2 text-[9px] font-mono text-amber-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>NEXT FOLLOW-UP DUE: {state.nextFollowUpDate}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Panel: Selected Company Execution & Email Composer */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-[#030815] border border-cyan-500/40 p-6 sm:p-8 rounded-2xl space-y-6 shadow-[0_4px_40px_rgba(0,0,0,0.8)]">
              
              {/* Target Header Info & Timezone Send Window Advice */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-900 pb-5">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="font-display text-xl font-bold text-white tracking-wide uppercase">
                      {selectedCompany.companyName}
                    </h2>
                    <a
                      href={selectedCompany.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-cyan-400 hover:underline flex items-center gap-1 font-mono"
                    >
                      <span>{selectedCompany.website.replace('https://', '')}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <p className="text-xs text-zinc-400 font-mono mt-1">
                    Contact: <strong className="text-white">{selectedCompany.contactName}</strong> ({selectedCompany.designation}) &lt;{selectedCompany.email}&gt;
                  </p>
                  <div className="text-[10px] text-cyan-400 font-mono pt-1.5 font-bold flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>PRIME SEND WINDOW: 08:30 AM - 10:15 AM LOCAL RECIPIENT TIME</span>
                    </span>
                    <a 
                      href={`https://www.vardhantechlabs.com/research/${selectedCompany.slug}`} 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-emerald-400 hover:underline font-mono bg-emerald-950/60 border border-emerald-500/40 px-2 py-0.5 rounded text-[9px]"
                    >
                      VIEW WEB REPORT →
                    </a>
                  </div>
                </div>

                {/* Navigation Buttons */}
                <div className="flex items-center gap-2 font-mono text-xs">
                  <button
                    onClick={handlePrevTarget}
                    disabled={safeIndex === 0}
                    className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-zinc-300 border border-zinc-800 rounded transition-colors flex items-center gap-1 cursor-pointer text-[11px]"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>PREV</span>
                  </button>

                  <button
                    onClick={handleNextTarget}
                    disabled={safeIndex === filteredCompanies.length - 1}
                    className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-zinc-300 border border-zinc-800 rounded transition-colors flex items-center gap-1 cursor-pointer text-[11px]"
                  >
                    <span>NEXT</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Architectural Challenge Signal & CTA Strategy Selector */}
              <div className="bg-black/90 border border-zinc-850 p-4 rounded-xl space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-cyan-400 uppercase font-bold tracking-wider block">
                    // VERIFIED MD ARCHITECTURAL BOTTLENECK:
                  </span>

                  <button
                    onClick={handleGenerateOllamaEmail}
                    disabled={isGeneratingOllama}
                    className="px-3 py-1 bg-purple-950/80 hover:bg-purple-900 border border-purple-500/40 text-purple-300 font-bold rounded flex items-center gap-1.5 cursor-pointer text-[10px] transition-colors"
                  >
                    <Cpu className={`w-3.5 h-3.5 text-purple-400 ${isGeneratingOllama ? 'animate-spin' : ''}`} />
                    <span>{isGeneratingOllama ? 'OLLAMA GENERATING...' : `RE-GENERATE WITH OLLAMA (${selectedModel.toUpperCase()})`}</span>
                  </button>
                </div>

                <p className="text-xs text-zinc-300 font-sans leading-relaxed italic">
                  "{selectedCompany.challenge}"
                </p>

                {/* Low Friction CTA Strategy Selector Bar */}
                <div className="pt-2 border-t border-zinc-900 flex flex-wrap items-center justify-between gap-2 text-[10px]">
                  <span className="text-zinc-500 uppercase font-bold">CTA STRATEGY:</span>
                  <div className="flex gap-1.5">
                    {[
                      { id: 'video', label: '3-Min Video CTA', icon: Video },
                      { id: 'pdf', label: '2-Page PDF Blueprint CTA', icon: FileText },
                      { id: 'meeting', label: '15-Min Meeting CTA', icon: User }
                    ].map(cta => {
                      const Icon = cta.icon;
                      const isActive = selectedCtaType === cta.id;
                      return (
                        <button
                          key={cta.id}
                          onClick={() => setSelectedCtaType(cta.id as any)}
                          className={`px-2.5 py-1 rounded font-bold uppercase transition-all flex items-center gap-1 cursor-pointer border ${
                            isActive
                              ? 'bg-cyan-500 text-black border-cyan-400'
                              : 'bg-zinc-950 text-zinc-400 border-zinc-850 hover:text-white'
                          }`}
                        >
                          <Icon className="w-3 h-3" />
                          <span>{cta.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* LinkedIn 24h Warm-up Quick Bar */}
              <div className="bg-zinc-950 border border-cyan-500/30 p-3 rounded-xl flex items-center justify-between gap-3 font-mono text-xs">
                <div className="flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-cyan-400" />
                  <span className="text-zinc-300 font-sans text-xs">
                    <strong>LinkedIn 24h Warm-Up:</strong> Connect 24h before email send to boost reply rate by 3x.
                  </span>
                </div>
                <button
                  onClick={handleCopyLinkedInMessage}
                  className="px-3 py-1.5 bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/40 text-cyan-300 font-bold uppercase rounded text-[10px] transition-colors shrink-0 cursor-pointer"
                >
                  {linkedInCopyFeedback ? 'LINKEDIN MSG COPIED!' : 'COPY LINKEDIN MSG'}
                </button>
              </div>

              {/* Sequence Stage Selector Tabs */}
              <div className="flex flex-wrap border-b border-zinc-900 gap-2 font-mono text-xs font-bold">
                {selectedCompany.emailSequence.map((seq, idx) => (
                  <button
                    key={seq.step}
                    onClick={() => setActiveStepIndex(idx)}
                    className={`pb-2.5 px-2 transition-all border-b-2 text-[11px] cursor-pointer ${
                      activeStepIndex === idx
                        ? 'border-cyan-400 text-cyan-400 font-bold'
                        : 'border-transparent text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {seq.name}
                  </button>
                ))}
              </div>

              {/* Email Content Box */}
              <div className="space-y-4 font-mono text-xs">
                <div className="space-y-1">
                  <label className="text-[10px] text-zinc-500 uppercase font-bold">RECIPIENT EMAIL:</label>
                  <input
                    type="text"
                    readOnly
                    value={selectedCompany.email}
                    className="w-full bg-zinc-950 border border-zinc-900 rounded p-2.5 text-zinc-300"
                  />
                </div>

                <div className="space-y-1 flex items-center justify-between">
                  <label className="text-[10px] text-zinc-500 uppercase font-bold">SUBJECT LINE:</label>
                  {ollamaOverride && (
                    <span className="text-[9px] font-mono text-emerald-400 font-bold">
                      OLLAMA TOP INDUSTRY-LEVEL EMAIL ACTIVE ({selectedCtaType.toUpperCase()} CTA)
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  readOnly
                  value={currentStep.subject}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded p-2.5 text-cyan-400 font-bold"
                />

                <div className="space-y-1">
                  <label className="text-[10px] text-zinc-500 uppercase font-bold">SUPERHUMAN EMAIL BODY (INCLUDES TARGET REPORT URL):</label>
                  <textarea
                    rows={10}
                    readOnly
                    value={currentStep.body}
                    className="w-full bg-zinc-950 border border-zinc-900 rounded p-3 text-zinc-200 leading-relaxed font-mono text-xs resize-none"
                  />
                </div>
              </div>

              {/* Primary Action Buttons */}
              <div className="pt-2 flex flex-wrap gap-3 font-mono text-xs">
                <button
                  onClick={handleSendAndAdvance}
                  className="flex-1 py-4 bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-500 hover:from-cyan-400 hover:to-blue-400 text-black font-bold uppercase rounded-xl transition-all shadow-[0_0_25px_rgba(6,182,212,0.35)] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>SEND EMAIL & SCHEDULE FOLLOW-UP ({currentStep.waitDays} DAYS)</span>
                  <FastForward className="w-4 h-4" />
                </button>

                <button
                  onClick={handleCopyEmail}
                  className="px-4 py-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 font-bold uppercase rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <Copy className="w-4 h-4" />
                  <span>{copyFeedback ? 'COPIED!' : 'COPY EMAIL'}</span>
                </button>
              </div>

            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
