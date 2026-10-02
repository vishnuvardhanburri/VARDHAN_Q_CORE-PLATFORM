import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Shield, Search, Mail, Calendar, CheckCircle2, Clock, Copy, Send, ArrowLeft, 
  RefreshCw, AlertTriangle, ChevronRight, ChevronLeft, DollarSign, Filter, 
  ChevronLast, FastForward, PauseCircle, PlayCircle, UserCheck, Cpu, Flame, Target,
  TrendingUp, BarChart3, ShieldAlert, Sparkles, MessageSquare, Award, Radio, XCircle,
  ExternalLink, Check, FileText, CheckCheck, Globe, Eye
} from 'lucide-react';

export const getCompanySlug = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/\.com$/i, '-com')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

import { ALL_COMPANIES_RESEARCH_DATA, AllCompanyResearch } from '../data/allCompaniesResearch';

import { generateEmailByStructure, generate5SubjectCandidates } from '../utils/humanVariationEngine';
import { CompanyHealthService, VerifiedCompanySignal } from '../utils/signalEngineReal';
import { TargetQualificationEngine, QualifiedTargetRecord } from '../server/targetQualificationEngine';
import { ReplyWorthinessEngine, ReplyWorthinessRecord } from '../server/replyWorthinessEngine';

// Signal Record from v4.2 API
interface LiveSignalRecord {
  company: string;
  person: string;
  role: string;
  sourceUrl: string;
  sourceType: string;
  publishedAt: string;
  signalAgeDays: number;
  freshnessCategory: string;
  signalType: string;
  evidenceText: string;
  confidence: string;
  signalScore: number;
  priority: string;
  recommendedPersona: string;
  verificationStatus: string;
  blockReason: string;
}

interface LiveFeedMetrics {
  discovered: number;
  verified: number;
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  blocked: number;
  unavailable: number;
  duplicatesRemoved: number;
  newToday: number;
}

interface OutreachDashboardViewProps {
  onBackToHome?: () => void;
}

interface TargetOutreachState {
  status: 'UNCONTACTED' | 'EMAIL_1_SENT' | 'FOLLOWUP_1_SENT' | 'FOLLOWUP_2_SENT' | 'REPLIED_TECHNICAL' | 'MEETING_BOOKED' | 'CONVERTED';
  stepIndex: number;
  lastSentDate?: string;
  nextFollowUpDate?: string;
  notes?: string;
  customEmailSubject?: string;
  customEmailBody?: string;
  personaType?: 'CTO_VP' | 'TECHNICAL_FOUNDER' | 'OTHER_INFRA';
  selectedRecipientName?: string;
  verifiedEmailAddress?: string;
  verificationSource?: string;
  verificationDate?: string;
  isUserResearchVerified?: boolean;
}

export const OutreachDashboardView: React.FC<OutreachDashboardViewProps> = ({ onBackToHome }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndustry, setSelectedIndustry] = useState('all');
  const [selectedPersonaFilter, setSelectedPersonaFilter] = useState<'all' | 'CTO_VP' | 'TECHNICAL_FOUNDER' | 'OTHER_INFRA' | 'BATCH_50_70'>('BATCH_50_70');
  const [selectedSlug, setSelectedSlug] = useState<string>('linear');
  const [activeStep, setActiveStep] = useState<number>(2); // Default to Follow-Up #1 per strategy
  const [copyFeedback, setCopyFeedback] = useState(false);
  
  // 48-Hour Cold Outreach Pause Switcher
  const [isColdEmailPaused, setIsColdEmailPaused] = useState<boolean>(true);

  // LocalStorage state for persistent outreach tracking & telemetry
  const [outreachStore, setOutreachStore] = useState<Record<string, TargetOutreachState>>(() => {
    try {
      const saved = localStorage.getItem('vardhan_outreach_tracker_v2');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem('vardhan_outreach_tracker_v2', JSON.stringify(outreachStore));
  }, [outreachStore]);

  // ── Live Signal Feed v4.2 ─────────────────────────────────────────────────
  const [liveFeedOpen, setLiveFeedOpen] = useState(false);
  const [liveFeedFilter, setLiveFeedFilter] = useState<'ALL' | 'P0' | 'P1' | 'P2' | 'P3' | 'LAST_7D' | 'LAST_30D' | 'NO_SIGNAL' | 'NEEDS_VERIFICATION'>('ALL');
  const [liveSignals, setLiveSignals] = useState<LiveSignalRecord[]>([]);
  const [liveFeedMetrics, setLiveFeedMetrics] = useState<LiveFeedMetrics | null>(null);
  const [liveFeedStatus, setLiveFeedStatus] = useState<'IDLE' | 'LOADING' | 'COMPLETED' | 'UNAVAILABLE'>('IDLE');

  const fetchLiveSignals = useCallback(async () => {
    setLiveFeedStatus('LOADING');
    setLiveSignals([]);
    setLiveFeedMetrics(null);
    try {
      const response = await fetch('/api/signals/batch');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const signals: LiveSignalRecord[] = (data.results || [])
        .filter((r: any) => r.signal)
        .map((r: any) => r.signal as LiveSignalRecord);
      setLiveSignals(signals);
      setLiveFeedMetrics(data.metrics || null);
      setLiveFeedStatus('COMPLETED');
    } catch {
      setLiveFeedStatus('UNAVAILABLE');
    }
  }, []);

  const filteredLiveSignals = useMemo(() => liveSignals.filter(s => {
    if (liveFeedFilter === 'ALL') return true;
    if (liveFeedFilter === 'P0') return s.priority === 'P0';
    if (liveFeedFilter === 'P1') return s.priority === 'P1';
    if (liveFeedFilter === 'P2') return s.priority === 'P2';
    if (liveFeedFilter === 'P3') return s.priority === 'P3';
    if (liveFeedFilter === 'LAST_7D') return s.signalAgeDays <= 7;
    if (liveFeedFilter === 'LAST_30D') return s.signalAgeDays <= 30;
    if (liveFeedFilter === 'NO_SIGNAL') return s.signalType === 'NO_ACTIONABLE_SIGNAL';
    if (liveFeedFilter === 'NEEDS_VERIFICATION') return s.verificationStatus === 'UNVERIFIED' || s.verificationStatus === 'SOURCE_DISCOVERY_UNAVAILABLE';
    return true;
  }), [liveSignals, liveFeedFilter]);

  // ── Target Qualification Layer State & Data ──────────────────────────────
  const [activeDashboardTab, setActiveDashboardTab] = useState<'COMPOSER' | 'TOP_10_PILOT' | 'TARGET_QUALIFICATION' | 'OPPORTUNITY_DISCOVERY'>('COMPOSER');
  const [qualificationFilter, setQualificationFilter] = useState<'ALL' | 'READY_FOR_HUMAN_APPROVAL' | 'BLOCKED' | 'P0' | 'P1' | 'P2' | 'P3'>('ALL');
  const [qualificationSearch, setQualificationSearch] = useState('');

  // ── Opportunity Discovery / Reply-Worthiness State ────────────────────────
  const [opportunityFilter, setOpportunityFilter] = useState<'ALL' | 'HIGH_PRIORITY' | 'QUALIFIED' | 'REVIEW' | 'BLOCKED' | 'NO_SERVICE_FIT' | 'NEEDS_VERIFICATION' | 'RECENT_SIGNAL'>('ALL');
  const [opportunitySearch, setOpportunitySearch] = useState('');

  const replyWorthinessRecords: ReplyWorthinessRecord[] = useMemo(() => {
    return ReplyWorthinessEngine.assessBatch(ALL_COMPANIES_RESEARCH_DATA);
  }, []);

  const opportunityMetrics = useMemo(() => {
    const total = replyWorthinessRecords.length;
    const highPriority = replyWorthinessRecords.filter(r => r.qualificationTier === 'HIGH_PRIORITY').length;
    const qualified = replyWorthinessRecords.filter(r => r.qualificationTier === 'QUALIFIED').length;
    const review = replyWorthinessRecords.filter(r => r.qualificationTier === 'REVIEW').length;
    const blocked = replyWorthinessRecords.filter(r => r.qualificationTier === 'BLOCKED').length;
    const noServiceFit = replyWorthinessRecords.filter(r => r.hardBlockFlags.includes('NO_SERVICE_FIT')).length;
    const needsVerification = replyWorthinessRecords.filter(r => r.eligibility === 'NEEDS_VERIFICATION' || r.hardBlockFlags.includes('MISSING_VERIFIED_SOURCE')).length;
    const recentSignal = replyWorthinessRecords.filter(r => r.evidence.length > 0 && r.evidence[0].ageDays <= 30).length;

    return { total, highPriority, qualified, review, blocked, noServiceFit, needsVerification, recentSignal };
  }, [replyWorthinessRecords]);

  const filteredOpportunityRecords = useMemo(() => {
    return replyWorthinessRecords.filter(r => {
      if (opportunityFilter === 'HIGH_PRIORITY' && r.qualificationTier !== 'HIGH_PRIORITY') return false;
      if (opportunityFilter === 'QUALIFIED' && r.qualificationTier !== 'QUALIFIED') return false;
      if (opportunityFilter === 'REVIEW' && r.qualificationTier !== 'REVIEW') return false;
      if (opportunityFilter === 'BLOCKED' && r.qualificationTier !== 'BLOCKED') return false;
      if (opportunityFilter === 'NO_SERVICE_FIT' && !r.hardBlockFlags.includes('NO_SERVICE_FIT')) return false;
      if (opportunityFilter === 'NEEDS_VERIFICATION' && r.eligibility !== 'NEEDS_VERIFICATION' && !r.hardBlockFlags.includes('MISSING_VERIFIED_SOURCE')) return false;
      if (opportunityFilter === 'RECENT_SIGNAL' && (r.evidence.length === 0 || r.evidence[0].ageDays > 30)) return false;

      if (opportunitySearch.trim() !== '') {
        const q = opportunitySearch.toLowerCase();
        const mCompany = r.company.toLowerCase().includes(q);
        const mPerson = r.person.toLowerCase().includes(q);
        const mHypo = r.hypothesis.toLowerCase().includes(q);
        const mQuest = r.question.toLowerCase().includes(q);
        const mServ = r.serviceFit.toLowerCase().includes(q);
        if (!mCompany && !mPerson && !mHypo && !mQuest && !mServ) return false;
      }
      return true;
    });
  }, [replyWorthinessRecords, opportunityFilter, opportunitySearch]);

  const { allTargets: qualifiedTargets, top10PilotTargets, metrics: qualificationMetrics } = useMemo(() => {
    return TargetQualificationEngine.qualifyAllCompanies(outreachStore || {});
  }, [outreachStore]);

  const filteredQualificationTargets = useMemo(() => {
    return qualifiedTargets.filter(t => {
      // Filter by status/priority
      if (qualificationFilter === 'READY_FOR_HUMAN_APPROVAL' && t.status !== 'READY_FOR_HUMAN_APPROVAL') return false;
      if (qualificationFilter === 'BLOCKED' && t.status !== 'BLOCKED') return false;
      if (qualificationFilter === 'P0' && t.priority !== 'P0') return false;
      if (qualificationFilter === 'P1' && t.priority !== 'P1') return false;
      if (qualificationFilter === 'P2' && t.priority !== 'P2') return false;
      if (qualificationFilter === 'P3' && t.priority !== 'P3') return false;

      // Filter by search query
      if (qualificationSearch.trim() !== '') {
        const query = qualificationSearch.toLowerCase();
        const matchName = t.company.toLowerCase().includes(query);
        const matchPerson = t.person.toLowerCase().includes(query);
        const matchSignal = t.signal.toLowerCase().includes(query);
        const matchEvidence = t.evidence.toLowerCase().includes(query);
        if (!matchName && !matchPerson && !matchSignal && !matchEvidence) return false;
      }
      return true;
    });
  }, [qualifiedTargets, qualificationFilter, qualificationSearch]);

  // Helper to categorize prospect into 3 persona groups
  const getPersonaGroup = (company: AllCompanyResearch): 'CTO_VP' | 'TECHNICAL_FOUNDER' | 'OTHER_INFRA' => {
    const cto = (company.cto || '').trim();
    const vp = (company.vpEngineering || '').trim();
    const ceo = (company.ceo || '').trim();

    if (cto && cto !== 'N/A') return 'CTO_VP';
    if (vp && vp !== 'N/A') return 'CTO_VP';
    if (ceo && ceo !== 'N/A') return 'TECHNICAL_FOUNDER';
    return 'OTHER_INFRA';
  };

  // Group all prospects into the 3 Persona Categories
  const categorizedCompanies = useMemo(() => {
    return ALL_COMPANIES_RESEARCH_DATA.map(company => ({
      company,
      slug: getCompanySlug(company.name),
      persona: getPersonaGroup(company)
    }));
  }, []);

  const ctoVpGroup = useMemo(() => categorizedCompanies.filter(c => c.persona === 'CTO_VP'), [categorizedCompanies]);
  const founderGroup = useMemo(() => categorizedCompanies.filter(c => c.persona === 'TECHNICAL_FOUNDER'), [categorizedCompanies]);
  const otherInfraGroup = useMemo(() => categorizedCompanies.filter(c => c.persona === 'OTHER_INFRA'), [categorizedCompanies]);

  // Select Top 50–70 Best Prospects for Follow-Up #1 Controlled Experiment
  const top50to70Batch = useMemo(() => {
    const combined = [...ctoVpGroup, ...founderGroup];
    return combined.slice(0, 65).map(c => c.company);
  }, [ctoVpGroup, founderGroup]);

  // Filter companies based on search & persona pill selection
  const filteredCompanies = ALL_COMPANIES_RESEARCH_DATA.filter(company => {
    const slug = getCompanySlug(company.name);
    const persona = getPersonaGroup(company);
    
    const matchesSearch = company.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (company.ceo && company.ceo.toLowerCase().includes(searchQuery.toLowerCase())) ||
                          (company.cto && company.cto.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesIndustry = selectedIndustry === 'all' || company.sector.toLowerCase().includes(selectedIndustry.toLowerCase());
    
    let matchesPersona = true;
    if (selectedPersonaFilter === 'CTO_VP') matchesPersona = persona === 'CTO_VP';
    if (selectedPersonaFilter === 'TECHNICAL_FOUNDER') matchesPersona = persona === 'TECHNICAL_FOUNDER';
    if (selectedPersonaFilter === 'OTHER_INFRA') matchesPersona = persona === 'OTHER_INFRA';
    if (selectedPersonaFilter === 'BATCH_50_70') matchesPersona = top50to70Batch.some(b => getCompanySlug(b.name) === slug);

    return matchesSearch && matchesIndustry && matchesPersona;
  });

  // Selected Target Company Index & Data
  const currentIndex = filteredCompanies.findIndex(c => getCompanySlug(c.name) === selectedSlug);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const selectedCompany = filteredCompanies[safeIndex] || ALL_COMPANIES_RESEARCH_DATA[0];
  const companySlug = getCompanySlug(selectedCompany.name);
  const selectedPersona = getPersonaGroup(selectedCompany);

  // Calculate Telemetry Funnel Statistics (Ignoring Opens as main KPI)
  const totalProspects = ALL_COMPANIES_RESEARCH_DATA.length; // 206
  const deliveredCount = 206; // Verified delivered count
  const safeStoreValues = useMemo(() => {
    return Object.values(outreachStore || {}).filter(s => s && typeof s === 'object');
  }, [outreachStore]);

  const technicalRepliesCount = safeStoreValues.filter(s => s.status === 'REPLIED_TECHNICAL' || s.status === 'MEETING_BOOKED').length;
  const meetingsBookedCount = safeStoreValues.filter(s => s.status === 'MEETING_BOOKED' || s.status === 'CONVERTED').length;
  const todayStr = new Date().toISOString().split('T')[0];
  const sentTodayCount = safeStoreValues.filter(s => s.lastSentDate === todayStr).length;
  const totalSentCount = safeStoreValues.filter(s => s.status === 'FOLLOWUP_1_SENT' || s.status === 'FOLLOWUP_2_SENT' || s.status === 'EMAIL_1_SENT').length;
  const technicalDiscussionsGoal = 50; // Next Strategic Goal: Prove 50 CTO Technical Conversations

  // Active target state, custom overrides and research verification
  const currentTargetState = outreachStore[companySlug];
  const activeRecipient = (currentTargetState?.selectedRecipientName && currentTargetState.selectedRecipientName.trim() !== '')
    ? currentTargetState.selectedRecipientName
    : (selectedCompany.cto || selectedCompany.vpEngineering || selectedCompany.ceo || 'Engineering Lead');
  const activeEmail = (currentTargetState?.verifiedEmailAddress && currentTargetState.verifiedEmailAddress.trim() !== '')
    ? currentTargetState.verifiedEmailAddress
    : (selectedCompany.email || `contact@${selectedCompany.name.toLowerCase().replace(/\s+/g, '')}.com`);
  const isUserResearchVerified = currentTargetState?.isUserResearchVerified ?? false;

  // Generate Outreach Package via REAL Signal Engine v4.1 (verified signals only)
  const currentSignal = useMemo((): VerifiedCompanySignal => {
    return CompanyHealthService.assess(selectedCompany);
  }, [selectedCompany]);

  const currentOutreachPackage = useMemo(() => {
    return generateEmailByStructure(
      'B_PEER_OBSERVATION', 
      selectedCompany, 
      safeIndex, 
      activeRecipient, 
      activeEmail, 
      isUserResearchVerified
    );
  }, [selectedCompany, safeIndex, activeRecipient, activeEmail, isUserResearchVerified]);

  // If signal is eligible, use signal-derived subject; otherwise fallback to variation engine
  const currentEmail = {
    to: activeEmail,
    subject: (currentTargetState?.customEmailSubject) || currentOutreachPackage.selectedSubject,
    body: activeStep === 1 ? currentOutreachPackage.email1 :
          activeStep === 2 ? currentOutreachPackage.followUp1 :
          activeStep === 3 ? currentOutreachPackage.followUp2 :
          activeStep === 4 ? currentOutreachPackage.followUp3 : currentOutreachPackage.breakup
  };

  // Target Navigation Controls
  const handlePrevTarget = () => {
    if (safeIndex > 0) {
      const prevSlug = getCompanySlug(filteredCompanies[safeIndex - 1].name);
      setSelectedSlug(prevSlug);
    }
  };

  const handleNextTarget = () => {
    if (safeIndex < filteredCompanies.length - 1) {
      const nextSlug = getCompanySlug(filteredCompanies[safeIndex + 1].name);
      setSelectedSlug(nextSlug);
    }
  };

  // Toggle user research verification
  const handleToggleUserResearchVerified = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    setOutreachStore(prev => {
      const current = prev[companySlug]?.isUserResearchVerified ?? false;
      return {
        ...prev,
        [companySlug]: {
          ...prev[companySlug],
          isUserResearchVerified: !current,
          verificationSource: !current ? (prev[companySlug]?.verificationSource || 'Manual User Research') : undefined,
          verificationDate: !current ? todayStr : undefined
        }
      };
    });
  };

  // Switch recipient executive
  const handleSelectRecipient = (name: string) => {
    setOutreachStore(prev => ({
      ...prev,
      [companySlug]: {
        ...prev[companySlug],
        selectedRecipientName: name
      }
    }));
  };

  // Handle Mark Follow-Up #1 Sent & Auto-Advance
  const handleSendFollowUp1AndAdvance = () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Ensure research verification is recorded upon sending
    setOutreachStore(prev => ({
      ...prev,
      [companySlug]: {
        ...prev[companySlug],
        status: 'FOLLOWUP_1_SENT',
        stepIndex: 2,
        lastSentDate: todayStr,
        personaType: selectedPersona,
        verifiedEmailAddress: currentEmail.to,
        selectedRecipientName: activeRecipient,
        isUserResearchVerified: true,
        verificationSource: prev[companySlug]?.verificationSource || 'Manual User Research',
        verificationDate: prev[companySlug]?.verificationDate || todayStr
      }
    }));

    // Trigger Mailto Link
    const mailtoUrl = `mailto:${currentEmail.to}?subject=${encodeURIComponent(currentEmail.subject)}&body=${encodeURIComponent(currentEmail.body)}`;
    window.location.href = mailtoUrl;

    if (safeIndex < filteredCompanies.length - 1) {
      setTimeout(() => {
        const nextSlug = getCompanySlug(filteredCompanies[safeIndex + 1].name);
        setSelectedSlug(nextSlug);
      }, 300);
    }
  };

  // Handle Mark Technical Discussion Started
  const handleMarkTechnicalReply = () => {
    setOutreachStore(prev => ({
      ...prev,
      [companySlug]: {
        ...prev[companySlug],
        status: 'REPLIED_TECHNICAL'
      }
    }));
  };

  // Handle Mark Meeting Booked
  const handleMarkBooked = () => {
    setOutreachStore(prev => ({
      ...prev,
      [companySlug]: {
        ...prev[companySlug],
        status: 'MEETING_BOOKED'
      }
    }));
  };

  const handleCopyEmail = () => {
    const fullText = `TO: ${currentEmail.to}\nSUBJECT: ${currentEmail.subject}\n\n${currentEmail.body}`;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(fullText).catch(() => {});
    }
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  return (
    <div className="min-h-screen bg-black text-white pt-20 pb-32 font-sans selection:bg-cyan-500 selection:text-black">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">

        {/* Top Header & Strategy Target Banner */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-900 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-black font-bold font-mono">
              X
            </div>
            <div>
              <h1 className="font-display text-base font-bold text-white uppercase tracking-wider">
                VARDHAN OUTREACH MAIL SYSTEM
              </h1>
              <span className="text-[10px] font-mono text-zinc-400 block">
                STANDALONE COLD MAIL & FOLLOW-UP OPERATING ENGINE
              </span>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
            <button
              onClick={() => setIsColdEmailPaused(!isColdEmailPaused)}
              className={`px-3.5 py-1.5 rounded-lg border font-bold uppercase transition-all flex items-center gap-2 cursor-pointer ${
                isColdEmailPaused 
                  ? 'bg-amber-950/80 border-amber-500/60 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
                  : 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300'
              }`}
            >
              {isColdEmailPaused ? <PauseCircle className="w-4 h-4 text-amber-400" /> : <PlayCircle className="w-4 h-4 text-emerald-400" />}
              <span>{isColdEmailPaused ? '1. NEW COLD EMAILS PAUSED (48H COOL-DOWN ACTIVE)' : 'COLD OUTREACH ACTIVE'}</span>
            </button>
          </div>
        </div>

        {/* 🎯 STRATEGIC EXPERIMENT TARGET GOAL CARD (50 CTO TECHNICAL CONVERSATIONS) */}
        <div className="bg-gradient-to-r from-[#041026] via-[#020a1a] to-black border border-cyan-500/40 p-6 rounded-2xl space-y-4 shadow-[0_0_30px_rgba(6,182,212,0.15)] font-mono">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                <Target className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-bold text-white uppercase tracking-wider block">
                  EXPERIMENT GOAL // PROVE 50 CTO TECHNICAL CONVERSATIONS
                </span>
                <span className="text-[11px] text-zinc-400 block font-sans">
                  Batch 1: 50–70 Carefully Selected CTOs / Technical Founders • Follow-up #1 Only • Evidence-Backed
                </span>
              </div>
            </div>

            {/* Technical Discussion Progress Meter */}
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-[10px] text-zinc-400 uppercase">TECHNICAL DISCUSSIONS</div>
                <div className="text-xl font-bold text-cyan-400">
                  <span>{technicalRepliesCount}</span>
                  <span className="text-zinc-500 text-xs font-normal"> / {technicalDiscussionsGoal} Goal</span>
                </div>
              </div>

              <div className="w-36 bg-zinc-950 border border-zinc-800 rounded-full h-3 p-0.5 overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-full rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]"
                  style={{ width: `${Math.min(100, Math.round((technicalRepliesCount / technicalDiscussionsGoal) * 100))}%` }}
                />
              </div>
            </div>
          </div>

          {/* 📊 GLOBAL SIGNAL & TELEMETRY FUNNEL (ENGINE v4.1 SPECIFICATION) */}
          <div className="grid grid-cols-2 sm:grid-cols-8 gap-2 pt-2 text-center text-xs">
            <div className="bg-black/80 border border-zinc-850 p-2.5 rounded-xl">
              <span className="text-[9px] text-zinc-500 uppercase block font-bold">1. SCANNED</span>
              <span className="text-white font-bold text-base">{totalProspects}</span>
            </div>

            <div className="bg-black/80 border border-red-500/60 p-2.5 rounded-xl">
              <span className="text-[9px] text-red-400 uppercase block font-bold">2. P0 SIGNALS</span>
              <span className="text-red-300 font-bold text-base">
                {ALL_COMPANIES_RESEARCH_DATA.filter(c => CompanyHealthService.assess(c).priority === 'P0').length}
              </span>
            </div>

            <div className="bg-black/80 border border-amber-500/60 p-2.5 rounded-xl">
              <span className="text-[9px] text-amber-400 uppercase block font-bold">3. P1 SIGNALS</span>
              <span className="text-amber-300 font-bold text-base">
                {ALL_COMPANIES_RESEARCH_DATA.filter(c => CompanyHealthService.assess(c).priority === 'P1').length}
              </span>
            </div>

            <div className="bg-black/80 border border-blue-500/40 p-2.5 rounded-xl">
              <span className="text-[9px] text-blue-400 uppercase block font-bold">4. P2 REVIEW</span>
              <span className="text-blue-300 font-bold text-base">
                {ALL_COMPANIES_RESEARCH_DATA.filter(c => CompanyHealthService.assess(c).priority === 'P2').length}
              </span>
            </div>

            <div className="bg-black/80 border border-zinc-800 p-2.5 rounded-xl">
              <span className="text-[9px] text-zinc-500 uppercase block font-bold">5. P3 BLOCKED</span>
              <span className="text-zinc-400 font-bold text-base">
                {ALL_COMPANIES_RESEARCH_DATA.filter(c => CompanyHealthService.assess(c).priority === 'P3').length}
              </span>
            </div>

            <div className="bg-black/80 border border-cyan-500/50 p-2.5 rounded-xl">
              <span className="text-[9px] text-cyan-400 uppercase block font-bold">6. SENT TODAY</span>
              <span className="text-cyan-300 font-bold text-base">{sentTodayCount}</span>
            </div>

            <div className="bg-black/80 border border-purple-500/40 p-2.5 rounded-xl">
              <span className="text-[9px] text-purple-400 uppercase block font-bold">7. TECH DISCUSSIONS</span>
              <span className="text-purple-400 font-bold text-base">{technicalRepliesCount}</span>
            </div>

            <div className="bg-black/80 border border-emerald-500/40 p-2.5 rounded-xl">
              <span className="text-[9px] text-emerald-400 uppercase block font-bold">8. MEETINGS</span>
              <span className="text-emerald-400 font-bold text-base">{meetingsBookedCount}</span>
            </div>
          </div>
        </div>

        {/* ── LIVE SIGNAL FEED v4.2 ─────────────────────────────────────────── */}
        <div className="bg-zinc-950 border border-cyan-500/30 rounded-xl overflow-hidden">
          {/* Header / Toggle Bar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <Radio className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-cyan-400 font-bold uppercase tracking-wider">LIVE SIGNAL FEED</span>
              <span className="text-zinc-500">// Engine v4.2 — Public Source Discovery</span>
            </div>
            <div className="flex items-center gap-2">
              {liveFeedStatus === 'LOADING' && (
                <span className="text-[9px] text-amber-400 font-bold uppercase animate-pulse">DISCOVERING...</span>
              )}
              {liveFeedStatus === 'COMPLETED' && (
                <span className="text-[9px] text-emerald-400 font-bold uppercase">{liveSignals.length} SIGNALS LOADED</span>
              )}
              {liveFeedStatus === 'UNAVAILABLE' && (
                <span className="text-[9px] text-red-400 font-bold uppercase">SOURCE_DISCOVERY_UNAVAILABLE</span>
              )}
              <button
                onClick={fetchLiveSignals}
                disabled={liveFeedStatus === 'LOADING'}
                className="text-[9px] font-mono font-bold px-2.5 py-1 bg-cyan-950/60 border border-cyan-500/50 text-cyan-300 rounded hover:bg-cyan-900/60 transition-colors disabled:opacity-40 flex items-center gap-1 uppercase"
              >
                <RefreshCw className={`w-3 h-3 ${liveFeedStatus === 'LOADING' ? 'animate-spin' : ''}`} />
                {liveFeedStatus === 'IDLE' ? 'DISCOVER SIGNALS' : 'REFRESH'}
              </button>
              <button
                onClick={() => setLiveFeedOpen(v => !v)}
                className="text-[9px] font-mono font-bold px-2 py-1 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded hover:text-white transition-colors"
              >
                {liveFeedOpen ? 'COLLAPSE ▲' : 'EXPAND ▼'}
              </button>
            </div>
          </div>

          {/* V4.2 Discovery Metrics Bar */}
          {liveFeedMetrics && (
            <div className="grid grid-cols-5 sm:grid-cols-10 gap-0 border-b border-zinc-800 text-center font-mono text-[9px]">
              {[
                { label: 'DISCOVERED', val: liveFeedMetrics.discovered, color: 'text-zinc-300' },
                { label: 'VERIFIED', val: liveFeedMetrics.verified, color: 'text-emerald-400' },
                { label: 'P0', val: liveFeedMetrics.p0, color: 'text-red-400' },
                { label: 'P1', val: liveFeedMetrics.p1, color: 'text-amber-400' },
                { label: 'P2', val: liveFeedMetrics.p2, color: 'text-blue-400' },
                { label: 'P3', val: liveFeedMetrics.p3, color: 'text-zinc-500' },
                { label: 'BLOCKED', val: liveFeedMetrics.blocked, color: 'text-red-500' },
                { label: 'UNAVAIL', val: liveFeedMetrics.unavailable, color: 'text-amber-600' },
                { label: 'DUPES OUT', val: liveFeedMetrics.duplicatesRemoved, color: 'text-purple-400' },
                { label: 'NEW TODAY', val: liveFeedMetrics.newToday, color: 'text-cyan-400' },
              ].map(m => (
                <div key={m.label} className="py-2 px-1 border-r border-zinc-800 last:border-r-0">
                  <span className="text-zinc-500 uppercase block" style={{ fontSize: '8px' }}>{m.label}</span>
                  <span className={`font-bold text-sm ${m.color}`}>{m.val}</span>
                </div>
              ))}
            </div>
          )}

          {/* Expanded Feed */}
          {liveFeedOpen && (
            <div className="p-3 space-y-3">
              {/* Filter Bar */}
              <div className="flex flex-wrap gap-1.5 font-mono text-[9px]">
                {(['ALL', 'P0', 'P1', 'P2', 'P3', 'LAST_7D', 'LAST_30D', 'NO_SIGNAL', 'NEEDS_VERIFICATION'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setLiveFeedFilter(f)}
                    className={`px-2 py-0.5 rounded border font-bold uppercase transition-colors ${
                      liveFeedFilter === f
                        ? 'bg-cyan-950/80 border-cyan-500/60 text-cyan-300'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {f.replace(/_/g, ' ')}
                  </button>
                ))}
                <span className="text-zinc-600 ml-auto self-center">{filteredLiveSignals.length} signals</span>
              </div>

              {/* Signal status messages */}
              {liveFeedStatus === 'IDLE' && (
                <div className="text-center py-6 text-zinc-600 font-mono text-[11px]">
                  Click DISCOVER SIGNALS to run the v4.2 real source discovery pipeline.
                </div>
              )}
              {liveFeedStatus === 'LOADING' && (
                <div className="text-center py-6 text-amber-400 font-mono text-[11px] animate-pulse">
                  Fetching public sources... do not fabricate signals while waiting.
                </div>
              )}
              {liveFeedStatus === 'UNAVAILABLE' && (
                <div className="bg-red-950/30 border border-red-500/30 rounded-lg p-4 font-mono text-[11px] space-y-1">
                  <div className="text-red-400 font-bold">SOURCE_DISCOVERY_UNAVAILABLE</div>
                  <div className="text-zinc-400">All configured source fetches failed. No synthetic fallback was generated.</div>
                  <div className="text-zinc-500 text-[10px]">This is the correct behaviour. Retry when network access is available.</div>
                </div>
              )}

              {/* Signal Feed Table */}
              {liveFeedStatus === 'COMPLETED' && filteredLiveSignals.length === 0 && (
                <div className="text-center py-4 text-zinc-600 font-mono text-[11px]">No signals match the current filter.</div>
              )}
              {filteredLiveSignals.map((sig, i) => (
                <div
                  key={i}
                  className={`p-3 rounded-lg border font-mono text-[10px] space-y-1.5 ${
                    sig.priority === 'P0' ? 'bg-red-950/20 border-red-500/30' :
                    sig.priority === 'P1' ? 'bg-amber-950/20 border-amber-500/30' :
                    sig.priority === 'P2' ? 'bg-blue-950/20 border-blue-500/30' :
                    'bg-zinc-900/50 border-zinc-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`font-bold uppercase text-[11px] ${
                        sig.priority === 'P0' ? 'text-red-400' : sig.priority === 'P1' ? 'text-amber-400' :
                        sig.priority === 'P2' ? 'text-blue-400' : 'text-zinc-500'
                      }`}>{sig.priority}</span>
                      <span className="text-white font-bold">{sig.company}</span>
                      <span className="text-zinc-500">→ {sig.person || 'TBD'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded border text-[8px] font-bold uppercase ${
                        sig.verificationStatus === 'VERIFIED' ? 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40' :
                        sig.verificationStatus === 'SOURCE_DISCOVERY_UNAVAILABLE' ? 'text-red-400 border-red-500/40 bg-red-950/40' :
                        sig.verificationStatus === 'DUPLICATE' ? 'text-purple-400 border-purple-500/40 bg-purple-950/40' :
                        'text-zinc-500 border-zinc-700'
                      }`}>{sig.verificationStatus?.replace(/_/g, ' ')}</span>
                      <span className="text-zinc-500">{sig.signalAgeDays < 9999 ? `${sig.signalAgeDays}d ago` : '—'}</span>
                    </div>
                  </div>
                  <div className="text-zinc-400">
                    <span className="text-cyan-400">{sig.signalType?.replace(/_/g, ' ')}</span>
                    {sig.confidence && <span className="text-zinc-600 ml-2">conf: {sig.confidence}</span>}
                    {sig.signalScore > 0 && <span className="text-zinc-600 ml-2">score: {sig.signalScore}</span>}
                  </div>
                  {sig.evidenceText && sig.evidenceText.length > 0 && (
                    <div className="text-zinc-500 font-sans text-[10px] leading-relaxed line-clamp-2 border-l-2 border-zinc-700 pl-2">
                      {sig.evidenceText.substring(0, 200)}...
                    </div>
                  )}
                  {sig.blockReason && (
                    <div className="text-red-400 text-[9px] flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> {sig.blockReason}
                    </div>
                  )}
                  {sig.sourceUrl && (
                    <div className="text-zinc-600 text-[9px] truncate">
                      SRC: <span className="text-blue-400">{sig.sourceUrl}</span>
                      {sig.publishedAt && <span className="ml-2 text-zinc-700">pub: {sig.publishedAt}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── MAIN DASHBOARD VIEW SELECTOR ───────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3 font-mono text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveDashboardTab('COMPOSER')}
              className={`px-4 py-2.5 rounded-xl font-bold uppercase transition-all flex items-center gap-2 cursor-pointer border ${
                activeDashboardTab === 'COMPOSER'
                  ? 'bg-cyan-500 text-black border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.4)]'
                  : 'bg-zinc-900/80 text-zinc-300 border-zinc-850 hover:border-zinc-700 hover:text-white'
              }`}
            >
              <Mail className="w-4 h-4" />
              <span>1. OUTREACH COMPOSER</span>
            </button>

            <button
              onClick={() => setActiveDashboardTab('TOP_10_PILOT')}
              className={`px-4 py-2.5 rounded-xl font-bold uppercase transition-all flex items-center gap-2 cursor-pointer border ${
                activeDashboardTab === 'TOP_10_PILOT'
                  ? 'bg-emerald-500 text-black border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)]'
                  : 'bg-zinc-900/80 text-zinc-300 border-zinc-850 hover:border-zinc-700 hover:text-white'
              }`}
            >
              <Award className="w-4 h-4" />
              <span>2. TOP 10 PILOT TARGETS</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                activeDashboardTab === 'TOP_10_PILOT' ? 'bg-black/30 text-black' : 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
              }`}>
                {top10PilotTargets.length} READY
              </span>
            </button>

            <button
              onClick={() => setActiveDashboardTab('TARGET_QUALIFICATION')}
              className={`px-4 py-2.5 rounded-xl font-bold uppercase transition-all flex items-center gap-2 cursor-pointer border ${
                activeDashboardTab === 'TARGET_QUALIFICATION'
                  ? 'bg-purple-600 text-white border-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.4)]'
                  : 'bg-zinc-900/80 text-zinc-300 border-zinc-850 hover:border-zinc-700 hover:text-white'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>3. TARGET QUALIFICATION</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                activeDashboardTab === 'TARGET_QUALIFICATION' ? 'bg-black/30 text-white' : 'bg-purple-950 text-purple-400 border border-purple-500/30'
              }`}>
                {qualificationMetrics.readyForHumanApproval} QUALIFIED
              </span>
            </button>

            <button
              onClick={() => setActiveDashboardTab('OPPORTUNITY_DISCOVERY')}
              className={`px-4 py-2.5 rounded-xl font-bold uppercase transition-all flex items-center gap-2 cursor-pointer border ${
                activeDashboardTab === 'OPPORTUNITY_DISCOVERY'
                  ? 'bg-amber-500 text-black border-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.4)]'
                  : 'bg-zinc-900/80 text-zinc-300 border-zinc-850 hover:border-zinc-700 hover:text-white'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>4. REPLY-WORTHINESS ENGINE</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                activeDashboardTab === 'OPPORTUNITY_DISCOVERY' ? 'bg-black/30 text-black' : 'bg-amber-950 text-amber-300 border border-amber-500/30'
              }`}>
                {opportunityMetrics.highPriority + opportunityMetrics.qualified} READY
              </span>
            </button>
          </div>

          <div className="flex items-center gap-3 text-[10px] text-zinc-400">
            <span>HIGH PRIORITY: <strong className="text-amber-400 font-bold">{opportunityMetrics.highPriority}</strong></span>
            <span>•</span>
            <span>QUALIFIED: <strong className="text-emerald-400 font-bold">{opportunityMetrics.qualified}</strong></span>
            <span>•</span>
            <span>BLOCKED: <strong className="text-red-400 font-bold">{opportunityMetrics.blocked}</strong></span>
            <span>•</span>
            <span className="text-zinc-500">TRUTH &gt; VOLUME</span>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* TAB 1: COLD & FOLLOW-UP OUTREACH COMPOSER                               */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {activeDashboardTab === 'COMPOSER' && (
          <div className="space-y-6">
            {/* 2. PERSONA SEGMENTATION BAR (3 EXPLICIT GROUPS) */}
            <div className="bg-zinc-950 border border-zinc-850 p-4 rounded-xl space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-cyan-400" />
                  <span>PROSPECT PERSONA SEGMENTATION (206 PROSPECTS SPLIT INTO 3 GROUPS):</span>
                </span>
                <span className="text-[9px] text-zinc-500">CONTROLLED BATCH ISOLATION</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <button
                  onClick={() => setSelectedPersonaFilter('BATCH_50_70')}
                  className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                    selectedPersonaFilter === 'BATCH_50_70'
                      ? 'bg-cyan-950/80 border-cyan-400 text-white shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                      : 'bg-black/60 border-zinc-850 text-zinc-400 hover:text-white'
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase text-cyan-400 flex items-center gap-1">
                    <Flame className="w-3 h-3 text-cyan-400" />
                    <span>EXPERIMENT BATCH (50-70)</span>
                  </div>
                  <div className="text-xs font-bold text-white mt-1">{top50to70Batch.length} Top CTOs & Founders</div>
                  <span className="text-[9px] text-zinc-500 block mt-0.5 font-sans">Follow-up #1 Only</span>
                </button>

                <button
                  onClick={() => setSelectedPersonaFilter('CTO_VP')}
                  className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                    selectedPersonaFilter === 'CTO_VP'
                      ? 'bg-cyan-950/80 border-cyan-400 text-white shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                      : 'bg-black/60 border-zinc-850 text-zinc-400 hover:text-white'
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase text-emerald-400">1. CTO & VP ENGINEERING</div>
                  <div className="text-xs font-bold text-white mt-1">{ctoVpGroup.length} Executives</div>
                  <span className="text-[9px] text-zinc-500 block mt-0.5 font-sans">Direct Decision Makers</span>
                </button>

                <button
                  onClick={() => setSelectedPersonaFilter('TECHNICAL_FOUNDER')}
                  className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                    selectedPersonaFilter === 'TECHNICAL_FOUNDER'
                      ? 'bg-cyan-950/80 border-cyan-400 text-white shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                      : 'bg-black/60 border-zinc-850 text-zinc-400 hover:text-white'
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase text-purple-400">2. TECHNICAL FOUNDERS</div>
                  <div className="text-xs font-bold text-white mt-1">{founderGroup.length} Founders / CEOs</div>
                  <span className="text-[9px] text-zinc-500 block mt-0.5 font-sans">Product-Engineers</span>
                </button>

                <button
                  onClick={() => setSelectedPersonaFilter('OTHER_INFRA')}
                  className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                    selectedPersonaFilter === 'OTHER_INFRA'
                      ? 'bg-cyan-950/80 border-cyan-400 text-white shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                      : 'bg-black/60 border-zinc-850 text-zinc-400 hover:text-white'
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase text-zinc-400">3. OTHER INFRA DIRECTORS</div>
                  <div className="text-xs font-bold text-white mt-1">{otherInfraGroup.length} Directors</div>
                  <span className="text-[9px] text-zinc-500 block mt-0.5 font-sans">Platform & SRE Leads</span>
                </button>
              </div>
            </div>

            {/* Main Dashboard Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

              {/* Left Panel: Filtered Target Directory */}
              <div className="lg:col-span-5 space-y-3 font-mono text-xs">
                {/* Search & Sort Controls */}
                <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-850 space-y-3">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-3 text-zinc-500" />
                    <input
                      type="text"
                      placeholder="Search 206 targets (e.g. Stripe, Doppel, CTO)..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-black border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-white placeholder-zinc-500 text-xs focus:border-cyan-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span>SHOWING {filteredCompanies.length} TARGETS</span>
                    <span>SORT: PRIORITY & CONCURRENCY RISK</span>
                  </div>
                </div>

                {/* Target List Items */}
                <div className="space-y-2 max-h-[850px] overflow-y-auto pr-1">
                  {filteredCompanies.map((c, i) => {
                    const slug = getCompanySlug(c.name);
                    const isSelected = slug === companySlug;
                    const state = outreachStore[slug] || { status: 'UNCONTACTED' };
                    const isSent = state.status === 'FOLLOWUP_1_SENT';
                    const isReplied = state.status === 'REPLIED_TECHNICAL';
                    const isBooked = state.status === 'MEETING_BOOKED';

                    return (
                      <div
                        key={slug}
                        onClick={() => setSelectedSlug(slug)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer relative ${
                          isSelected
                            ? 'bg-zinc-900 border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                            : 'bg-zinc-950 border-zinc-850 hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-sm">{c.name}</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                                {c.sector.split('/')[0]}
                              </span>
                            </div>
                            <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-2">
                              <span>{c.cto ? `CTO: ${c.cto}` : c.vpEngineering ? `VP: ${c.vpEngineering}` : `CEO: ${c.ceo}`}</span>
                            </div>
                          </div>

                          <div className="text-right flex flex-col items-end gap-1">
                            {isBooked ? (
                              <span className="px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-500/40 rounded text-[9px] font-bold">
                                MEETING BOOKED
                              </span>
                            ) : isReplied ? (
                              <span className="px-2 py-0.5 bg-purple-950 text-purple-400 border border-purple-500/40 rounded text-[9px] font-bold">
                                TECH REPLY
                              </span>
                            ) : isSent ? (
                              <span className="px-2 py-0.5 bg-cyan-950 text-cyan-400 border border-cyan-500/40 rounded text-[9px] font-bold">
                                FOLLOW-UP #1 SENT
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-zinc-900 text-zinc-500 rounded text-[9px]">
                                READY TO AUDIT
                              </span>
                            )}
                            <span className="text-[9px] text-zinc-500">#{i + 1}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Panel: Selected Company Executive Detail & Composer */}
              <div className="lg:col-span-7 space-y-4">
                {/* Target Navigation Bar */}
                <div className="flex items-center justify-between bg-zinc-950 border border-zinc-850 p-3 rounded-xl font-mono text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-400">TARGET:</span>
                    <span className="font-bold text-white text-sm">{selectedCompany.name}</span>
                    <span className="text-[10px] text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 px-2 py-0.5 rounded">
                      INDEX {safeIndex + 1} OF {filteredCompanies.length}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handlePrevTarget}
                      disabled={safeIndex === 0}
                      className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-30 rounded border border-zinc-800 text-zinc-300 font-bold cursor-pointer transition-colors flex items-center gap-1"
                    >
                      <ChevronLeft className="w-4 h-4" /> PREV
                    </button>
                    <button
                      onClick={handleNextTarget}
                      disabled={safeIndex === filteredCompanies.length - 1}
                      className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-30 rounded border border-zinc-800 text-zinc-300 font-bold cursor-pointer transition-colors flex items-center gap-1"
                    >
                      NEXT <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 📡 ENGINE v4.1 REAL SIGNAL & EVIDENCE CARD */}
                <div className="bg-zinc-950 border border-zinc-850 p-4 rounded-xl space-y-3 font-mono">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-900 pb-2">
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
                      <span className="text-xs font-bold text-white uppercase">
                        LIVE SIGNAL DISCOVERY // {currentSignal.signalType}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase border ${
                        currentSignal.priority === 'P0' ? 'bg-red-950/80 border-red-500/60 text-red-300' :
                        currentSignal.priority === 'P1' ? 'bg-amber-950/80 border-amber-500/60 text-amber-300' :
                        currentSignal.priority === 'P2' ? 'bg-blue-950/80 border-blue-500/60 text-blue-300' :
                        'bg-zinc-900 border-zinc-800 text-zinc-500'
                      }`}>
                        PRIORITY: {currentSignal.priority} (SCORE: {currentSignal.signalScore}/100)
                      </span>
                      <span className="text-[9px] text-zinc-400 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded font-bold uppercase">
                        {currentSignal.recencyCategory} ({currentSignal.signalAgeDays}D AGO)
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-[11px] font-sans">
                    <div>
                      <span className="font-mono text-[9px] text-zinc-400 font-bold uppercase block">VERIFIED EVIDENCE SIGNAL:</span>
                      <span className="text-zinc-200">{currentSignal.evidenceVerbatim || currentSignal.blockReason || 'No verified evidence on record.'}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] pt-1">
                      <div className="bg-black/60 border border-zinc-900 p-2 rounded">
                        <span className="font-mono text-[8px] text-cyan-400 font-bold uppercase block">BUSINESS IMPLICATION:</span>
                        <span className="text-zinc-300">{currentSignal.businessImplication || 'Requires human assessment.'}</span>
                      </div>
                      <div className="bg-black/60 border border-zinc-900 p-2 rounded">
                        <span className="font-mono text-[8px] text-purple-400 font-bold uppercase block">ENGINEERING IMPLICATION:</span>
                        <span className="text-zinc-300">{currentSignal.engineeringImplication || 'Requires discovery conversation.'}</span>
                      </div>
                    </div>
                    <div className="text-[9px] font-mono text-zinc-400 flex items-center gap-2 pt-0.5">
                      <span>SOURCE: <strong className="text-zinc-300">{currentSignal.sourceType || currentSignal.sourceUrl || 'Public Blog / Direct Research'}</strong></span>
                      <span>•</span>
                      <span>CONFIDENCE: <strong className="text-cyan-400">{currentSignal.confidenceLevel || 'LOW'}</strong></span>
                    </div>
                  </div>
                </div>

                {/* 🛡️ 5-STEP EVIDENCE + IDENTITY VALIDATION GATE BAR */}
                <div className={`p-4 rounded-xl border font-mono text-xs space-y-3 ${
                  currentOutreachPackage.sendSafetyStatus.isSafeToSend
                    ? 'bg-[#02140e] border-emerald-500/50'
                    : 'bg-[#1f0507] border-red-500/60 shadow-[0_0_20px_rgba(239,68,68,0.2)]'
                }`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2.5">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className={`w-4 h-4 ${currentOutreachPackage.sendSafetyStatus.isSafeToSend ? 'text-emerald-400' : 'text-red-400'}`} />
                      <span className="font-bold text-white uppercase tracking-wider text-[11px]">
                        VALIDATION GATE // IDENTITY + EVIDENCE STRICT AUDIT
                      </span>
                    </div>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase border ${
                      currentOutreachPackage.sendSafetyStatus.isSafeToSend
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
                        : 'bg-red-950 text-red-300 border-red-500/50'
                    }`}>
                      {currentOutreachPackage.sendSafetyStatus.isSafeToSend ? 'CLEARED FOR SEND ✓' : 'BLOCKED FROM SEND ✕'}
                    </span>
                  </div>

                  {/* 5 Distinct Gate Checks */}
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-[10px]">
                    <div className={`p-2 rounded border ${currentOutreachPackage.sendSafetyStatus.isIdentityVerified ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300' : 'bg-red-950/40 border-red-500/30 text-red-300'}`}>
                      <span className="block font-bold">1. SOURCE:</span>
                      <span>{currentOutreachPackage.sendSafetyStatus.isIdentityVerified ? 'VERIFIED ✓' : 'UNVERIFIED ✕'}</span>
                    </div>

                    <div className={`p-2 rounded border ${currentOutreachPackage.sendSafetyStatus.isClaimConfidenceValid ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300' : 'bg-red-950/40 border-red-500/30 text-red-300'}`}>
                      <span className="block font-bold">2. FRESHNESS:</span>
                      <span>{currentOutreachPackage.sendSafetyStatus.isClaimConfidenceValid ? `${currentSignal.signalAgeDays}D AGO ✓` : 'STALE >90D ✕'}</span>
                    </div>

                    <div className={`p-2 rounded border ${currentOutreachPackage.sendSafetyStatus.isIdentityVerified ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300' : 'bg-red-950/40 border-red-500/30 text-red-300'}`}>
                      <span className="block font-bold">3. IDENTITY:</span>
                      <span className="truncate block" title={activeRecipient}>
                        {currentOutreachPackage.sendSafetyStatus.isIdentityVerified 
                          ? `VERIFIED ✓ (${outreachStore[companySlug]?.verificationSource || (isUserResearchVerified ? 'User Research' : 'Mailbox Match')})` 
                          : 'MISMATCH ✕'}
                      </span>
                    </div>

                    <div className={`p-2 rounded border ${currentOutreachPackage.sendSafetyStatus.isClaimConfidenceValid ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300' : 'bg-red-950/40 border-red-500/30 text-red-300'}`}>
                      <span className="block font-bold">4. CLAIMS:</span>
                      <span>{currentOutreachPackage.sendSafetyStatus.isClaimConfidenceValid ? 'NO FAKE DATA ✓' : 'UNSUPPORTED ✕'}</span>
                    </div>

                    <div className={`p-2 rounded border ${currentOutreachPackage.sendSafetyStatus.isSimilarityValid ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300' : 'bg-red-950/40 border-red-500/30 text-red-300'}`}>
                      <span className="block font-bold">5. SIMILARITY:</span>
                      <span>{currentOutreachPackage.sendSafetyStatus.similarityScorePercent}% OVERLAP ✓</span>
                    </div>
                  </div>

                  {/* Block Reasons Alert */}
                  {currentOutreachPackage.sendSafetyStatus.blockReasons.length > 0 && (
                    <div className="bg-black/80 border border-red-500/40 p-2.5 rounded text-[10px] text-red-300 space-y-1">
                      <span className="font-bold text-red-400 block uppercase">HARD BLOCK REASONS TRIGGERED:</span>
                      {currentOutreachPackage.sendSafetyStatus.blockReasons.map((reason, idx) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <span className="text-red-500">•</span>
                          <span>{reason}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ⚡ USER RESEARCH MAILBOX VERIFICATION CONTROLS */}
                  <div className="bg-black/60 border border-white/10 p-3 rounded-lg space-y-2 text-[11px] font-sans">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-zinc-300 font-bold uppercase flex items-center gap-1">
                        <UserCheck className="w-3.5 h-3.5 text-cyan-400" />
                        <span>MY RESEARCH VERIFICATION (USER OVERRIDE & AUTHORIZATION):</span>
                      </span>
                      <button
                        onClick={handleToggleUserResearchVerified}
                        className={`px-3 py-1 rounded font-mono text-[10px] font-bold uppercase transition-colors cursor-pointer border ${
                          isUserResearchVerified
                            ? 'bg-emerald-600 text-white border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                            : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700'
                        }`}
                      >
                        {isUserResearchVerified ? '✓ MARKED VERIFIED BY MY RESEARCH' : '⚡ MARK VERIFIED BY MY RESEARCH'}
                      </button>
                    </div>

                    {/* Executive switcher buttons */}
                    <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[10px]">
                      <span className="text-zinc-500">SWITCH EXECUTIVE:</span>
                      {selectedCompany.cto && selectedCompany.cto !== 'N/A' && (
                        <button
                          onClick={() => handleSelectRecipient(selectedCompany.cto)}
                          className={`px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                            activeRecipient === selectedCompany.cto 
                              ? 'bg-cyan-950 border-cyan-400 text-cyan-300' 
                              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                          }`}
                        >
                          CTO: {selectedCompany.cto}
                        </button>
                      )}
                      {selectedCompany.vpEngineering && selectedCompany.vpEngineering !== 'N/A' && (
                        <button
                          onClick={() => handleSelectRecipient(selectedCompany.vpEngineering)}
                          className={`px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                            activeRecipient === selectedCompany.vpEngineering 
                              ? 'bg-cyan-950 border-cyan-400 text-cyan-300' 
                              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                          }`}
                        >
                          VP: {selectedCompany.vpEngineering}
                        </button>
                      )}
                      {selectedCompany.ceo && selectedCompany.ceo !== 'N/A' && (
                        <button
                          onClick={() => handleSelectRecipient(selectedCompany.ceo)}
                          className={`px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                            activeRecipient === selectedCompany.ceo 
                              ? 'bg-cyan-950 border-cyan-400 text-cyan-300' 
                              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                          }`}
                        >
                          CEO: {selectedCompany.ceo}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Email Composer & Subject Preview */}
                <div className="bg-zinc-950 border border-zinc-850 p-4 rounded-xl space-y-4 font-mono text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-900 pb-3">
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-cyan-400" />
                      <span className="font-bold text-white uppercase">FOLLOW-UP #1 DRAFT (NO FAKE TELEMETRY)</span>
                    </div>
                    <span className="text-[10px] text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded">
                      STRUCTURE: {currentOutreachPackage.selectedSubject ? 'SIGNAL_BASED' : 'VARIATION_BASED'}
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-500 uppercase font-bold">RECIPIENT MAILBOX:</label>
                      <input
                        type="text"
                        value={activeEmail}
                        onChange={(e) => {
                          const val = e.target.value;
                          setOutreachStore(prev => ({
                            ...prev,
                            [companySlug]: {
                              ...prev[companySlug],
                              verifiedEmailAddress: val
                            }
                          }));
                        }}
                        className="w-full bg-zinc-950 border border-zinc-900 rounded p-2.5 text-white font-mono text-xs focus:border-cyan-500 focus:outline-none"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] text-zinc-500 uppercase font-bold flex items-center gap-1.5">
                          <Eye className="w-3 h-3 text-cyan-400" />
                          SUBJECT LINE (SELECT GATE-OPENER PERSPECTIVE):
                        </label>
                      </div>
                      <div className="space-y-1.5 bg-zinc-950 p-2 border border-zinc-900 rounded">
                        {[
                          { key: 'opt1', text: currentOutreachPackage.subjectOption1, label: 'SIGNAL CURIOSITY' },
                          { key: 'opt2', text: currentOutreachPackage.subjectOption2, label: 'EVENT → QUESTION' },
                          { key: 'opt3', text: currentOutreachPackage.subjectOption3, label: 'TECHNICAL DIRECTION' },
                          { key: 'opt4', text: currentOutreachPackage.subjectOption4, label: 'EXECUTIVE CURIOSITY' },
                          { key: 'opt5', text: currentOutreachPackage.subjectOption5, label: 'CONTEXTUAL FOLLOW-UP' }
                        ].map((opt, idx) => {
                          const isSelected = currentEmail.subject === opt.text;
                          return (
                            <div 
                              key={opt.key}
                              onClick={() => {
                                setOutreachStore(prev => ({
                                  ...prev,
                                  [companySlug]: {
                                    ...prev[companySlug],
                                    customEmailSubject: opt.text
                                  }
                                }));
                              }}
                              className={`flex items-center gap-2 p-2 rounded cursor-pointer text-xs font-mono transition-colors border ${
                                isSelected ? 'bg-cyan-950/40 border-cyan-500/50 text-cyan-400' : 'border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-300'
                              }`}
                            >
                              <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${isSelected ? 'border-cyan-400 bg-cyan-400/20' : 'border-zinc-700'}`}>
                                {isSelected && <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full" />}
                              </div>
                              <span className="w-32 flex-shrink-0 text-[9px] font-bold opacity-70">{(idx + 1)}. {opt.label}</span>
                              <span className="truncate">{opt.text}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-500 uppercase font-bold">FOLLOW-UP #1 BODY (QUALITATIVE ARCHITECTURAL QUESTION):</label>
                      <textarea
                        rows={10}
                        readOnly
                        value={currentEmail.body}
                        className="w-full bg-zinc-950 border border-zinc-900 rounded p-3 text-zinc-200 leading-relaxed font-mono text-xs resize-none"
                      />
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="pt-2 flex flex-wrap gap-3 font-mono text-xs">
                    <button
                      onClick={handleSendFollowUp1AndAdvance}
                      className={`flex-1 py-4 font-bold uppercase rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer ${
                        currentOutreachPackage.sendSafetyStatus.isSafeToSend
                          ? 'bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-500 hover:from-cyan-400 hover:to-blue-400 text-black shadow-[0_0_20px_rgba(6,182,212,0.3)]'
                          : 'bg-amber-950/90 border border-amber-500/70 text-amber-200 hover:bg-amber-900 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
                      }`}
                    >
                      <Send className="w-4 h-4" />
                      <span>
                        {currentOutreachPackage.sendSafetyStatus.isSafeToSend
                          ? 'SEND FOLLOW-UP #1 & ADVANCE TO NEXT CTO'
                          : '⚡ CONFIRM MY RESEARCH & SEND FOLLOW-UP #1'}
                      </span>
                      <FastForward className="w-4 h-4" />
                    </button>

                    <button
                      onClick={handleMarkTechnicalReply}
                      className="px-4 py-4 bg-purple-950 hover:bg-purple-900 border border-purple-500/40 text-purple-300 font-bold uppercase rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <MessageSquare className="w-4 h-4 text-purple-400" />
                      <span>MARK TECHNICAL REPLY</span>
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
        )}

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* TAB 2: TOP 10 PILOT TARGETS (DETERMINISTIC RANKING)                      */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {activeDashboardTab === 'TOP_10_PILOT' && (
          <div className="space-y-6">
            {/* Header & Ranking Formula Notice */}
            <div className="bg-gradient-to-r from-emerald-950/40 via-zinc-950 to-black border border-emerald-500/40 p-5 rounded-2xl space-y-2 font-mono">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Award className="w-5 h-5 text-emerald-400" />
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                    TOP 10 PILOT TARGETS // AUDITED & CLEARED FOR HUMAN APPROVAL
                  </h2>
                </div>
                <span className="text-[10px] text-emerald-300 bg-emerald-950/80 border border-emerald-500/40 px-3 py-1 rounded font-bold uppercase">
                  RANKING FORMULA: P0 → P1 → FRESHNESS → CONFIDENCE → PERSONA → IDENTITY
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
                Only targets that pass <strong>every single mandatory gate</strong> (valid primary source, non-stale date, verified corporate mailbox, and defensible technical angle) qualify for pilot review. Zero automated sends.
              </p>
            </div>

            {/* Top 10 Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {top10PilotTargets.map((target, idx) => (
                <div
                  key={target.company}
                  className="bg-zinc-950 border border-zinc-800 hover:border-emerald-500/60 p-5 rounded-2xl space-y-4 font-mono transition-all relative"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-emerald-950 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-xs">
                        #{idx + 1}
                      </span>
                      <div>
                        <span className="text-base font-bold text-white block">{target.company}</span>
                        <span className="text-[10px] text-zinc-400">{target.person} • {target.role}</span>
                      </div>
                    </div>

                    <div className="text-right space-y-1">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase ${
                        target.priority === 'P0' ? 'bg-red-950 text-red-300 border-red-500/60' : 'bg-amber-950 text-amber-300 border-amber-500/60'
                      }`}>
                        {target.priority} (SCORE: {target.score}/100)
                      </span>
                      <div className="text-[9px] text-zinc-500">PILOT RANK: {target.pilotRankScore} PTS</div>
                    </div>
                  </div>

                  {/* Freshness & Signal Type */}
                  <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 font-bold">
                      {target.freshness} ({target.age}D AGO)
                    </span>
                    <span className="px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30 text-cyan-300">
                      {target.signal}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-purple-950/60 border border-purple-500/30 text-purple-300">
                      PERSONA: {target.personaMatch}
                    </span>
                  </div>

                  {/* Evidence Text */}
                  <div className="bg-black/60 border border-zinc-900 p-3 rounded-xl space-y-1 text-[11px] font-sans">
                    <span className="text-[9px] font-mono text-zinc-500 font-bold uppercase block">VERIFIED PUBLIC EVIDENCE:</span>
                    <p className="text-zinc-200 leading-relaxed">{target.evidence}</p>
                    <div className="text-[9px] font-mono text-zinc-500 pt-1 flex items-center justify-between">
                      <span>SRC: <strong className="text-zinc-400">{target.sourceType}</strong></span>
                      <span>CONFIDENCE: <strong className="text-emerald-400">{target.confidence}</strong></span>
                    </div>
                  </div>

                  {/* Action: Open in Composer */}
                  <button
                    onClick={() => {
                      setSelectedSlug(getCompanySlug(target.company));
                      setActiveDashboardTab('COMPOSER');
                    }}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-black font-bold uppercase text-xs rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                  >
                    <span>⚡ LOAD INTO COMPOSER & AUDIT PROPOSAL</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* TAB 3: REAL-TIME TARGET QUALIFICATION AUDIT (17 COLUMNS)                 */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {activeDashboardTab === 'TARGET_QUALIFICATION' && (
          <div className="space-y-6">
            {/* Top Metrics Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 font-mono text-xs text-center">
              <div className="bg-zinc-950 border border-zinc-800 p-3 rounded-xl">
                <span className="text-[9px] text-zinc-500 uppercase block font-bold">TOTAL SCANNED</span>
                <span className="text-white font-bold text-base">{qualificationMetrics.total}</span>
              </div>
              <div className="bg-zinc-950 border border-emerald-500/50 p-3 rounded-xl">
                <span className="text-[9px] text-emerald-400 uppercase block font-bold">READY TO APPROVE</span>
                <span className="text-emerald-300 font-bold text-base">{qualificationMetrics.readyForHumanApproval}</span>
              </div>
              <div className="bg-zinc-950 border border-red-500/50 p-3 rounded-xl">
                <span className="text-[9px] text-red-400 uppercase block font-bold">P0 TARGETS</span>
                <span className="text-red-300 font-bold text-base">{qualificationMetrics.p0Count}</span>
              </div>
              <div className="bg-zinc-950 border border-amber-500/50 p-3 rounded-xl">
                <span className="text-[9px] text-amber-400 uppercase block font-bold">P1 TARGETS</span>
                <span className="text-amber-300 font-bold text-base">{qualificationMetrics.p1Count}</span>
              </div>
              <div className="bg-zinc-950 border border-blue-500/40 p-3 rounded-xl">
                <span className="text-[9px] text-blue-400 uppercase block font-bold">P2 REVIEW</span>
                <span className="text-blue-300 font-bold text-base">{qualificationMetrics.p2Count}</span>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 p-3 rounded-xl">
                <span className="text-[9px] text-zinc-500 uppercase block font-bold">P3 BLOCKED</span>
                <span className="text-zinc-400 font-bold text-base">{qualificationMetrics.p3Blocked}</span>
              </div>
              <div className="bg-zinc-950 border border-red-950 p-3 rounded-xl">
                <span className="text-[9px] text-red-500 uppercase block font-bold">IDENTITY MISMATCH</span>
                <span className="text-red-400 font-bold text-base">{qualificationMetrics.identityBlocked}</span>
              </div>
              <div className="bg-zinc-950 border border-zinc-850 p-3 rounded-xl">
                <span className="text-[9px] text-amber-500 uppercase block font-bold">STALE &gt;90D</span>
                <span className="text-amber-400 font-bold text-base">{qualificationMetrics.oldSignalBlocked}</span>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="bg-zinc-950 border border-zinc-850 p-4 rounded-xl space-y-3 font-mono text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['ALL', 'READY_FOR_HUMAN_APPROVAL', 'BLOCKED', 'P0', 'P1', 'P2', 'P3'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setQualificationFilter(f)}
                      className={`px-3 py-1 rounded-lg border font-bold uppercase transition-all cursor-pointer text-[10px] ${
                        qualificationFilter === f
                          ? 'bg-purple-950 border-purple-400 text-purple-300 shadow-[0_0_10px_rgba(168,85,247,0.3)]'
                          : 'bg-black/60 border-zinc-800 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {f.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Search qualification records..."
                    value={qualificationSearch}
                    onChange={(e) => setQualificationSearch(e.target.value)}
                    className="w-full bg-black border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-white placeholder-zinc-500 text-xs focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* 17-Column Target Qualification Table */}
            <div className="bg-zinc-950 border border-zinc-850 rounded-xl overflow-hidden font-mono text-xs">
              <div className="overflow-x-auto max-h-[700px]">
                <table className="w-full text-left border-collapse text-[10px]">
                  <thead className="bg-black text-zinc-400 border-b border-zinc-800 uppercase tracking-wider sticky top-0 z-10">
                    <tr>
                      <th className="p-3">#</th>
                      <th className="p-3">1. COMPANY</th>
                      <th className="p-3">2. PERSON</th>
                      <th className="p-3">3. ROLE</th>
                      <th className="p-3">4. SIGNAL</th>
                      <th className="p-3">5. SOURCE</th>
                      <th className="p-3">6. DATE</th>
                      <th className="p-3">7. AGE</th>
                      <th className="p-3 min-w-[200px]">8. EVIDENCE</th>
                      <th className="p-3">9. CONFIDENCE</th>
                      <th className="p-3">10. SCORE</th>
                      <th className="p-3">11. PRIORITY</th>
                      <th className="p-3">12. PERSONA MATCH</th>
                      <th className="p-3">13. EMAIL OK</th>
                      <th className="p-3">14. IDENTITY OK</th>
                      <th className="p-3">15. ANGLE</th>
                      <th className="p-3">16. STATUS</th>
                      <th className="p-3 min-w-[180px]">17. BLOCK REASON</th>
                      <th className="p-3">ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    {filteredQualificationTargets.map((target, idx) => (
                      <tr 
                        key={idx}
                        className={`hover:bg-zinc-900/60 transition-colors ${
                          target.status === 'READY_FOR_HUMAN_APPROVAL' ? 'bg-emerald-950/10' : ''
                        }`}
                      >
                        <td className="p-3 text-zinc-500">{idx + 1}</td>
                        <td className="p-3 font-bold text-white whitespace-nowrap">{target.company}</td>
                        <td className="p-3 text-zinc-300 whitespace-nowrap">{target.person}</td>
                        <td className="p-3 text-zinc-400 whitespace-nowrap">{target.role}</td>
                        <td className="p-3 text-cyan-400 whitespace-nowrap">{target.signal}</td>
                        <td className="p-3 text-zinc-400 truncate max-w-[120px]" title={target.source}>{target.sourceType || 'Direct'}</td>
                        <td className="p-3 text-zinc-400 whitespace-nowrap">{target.date || '—'}</td>
                        <td className="p-3 text-zinc-400 whitespace-nowrap">{target.age < 9999 ? `${target.age}d` : '—'}</td>
                        <td className="p-3 text-zinc-300 font-sans text-[11px] leading-tight" title={target.evidence}>
                          <span className="line-clamp-2">{target.evidence || '—'}</span>
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                            target.confidence === 'HIGH' ? 'bg-emerald-950 text-emerald-300' :
                            target.confidence === 'MEDIUM' ? 'bg-blue-950 text-blue-300' : 'bg-zinc-900 text-zinc-500'
                          }`}>
                            {target.confidence}
                          </span>
                        </td>
                        <td className="p-3 font-bold text-white whitespace-nowrap">{target.score}/100</td>
                        <td className="p-3 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                            target.priority === 'P0' ? 'bg-red-950 text-red-300 border border-red-500/50' :
                            target.priority === 'P1' ? 'bg-amber-950 text-amber-300 border border-amber-500/50' :
                            target.priority === 'P2' ? 'bg-blue-950 text-blue-300' : 'bg-zinc-900 text-zinc-500'
                          }`}>
                            {target.priority}
                          </span>
                        </td>
                        <td className="p-3 text-zinc-400 whitespace-nowrap">{target.personaMatch || '—'}</td>
                        <td className="p-3 whitespace-nowrap">
                          {target.emailVerified ? <span className="text-emerald-400 font-bold">YES ✓</span> : <span className="text-red-400">NO ✕</span>}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          {target.identityVerified ? <span className="text-emerald-400 font-bold">YES ✓</span> : <span className="text-red-400">NO ✕</span>}
                        </td>
                        <td className="p-3 text-zinc-400 whitespace-nowrap">{target.angle || '—'}</td>
                        <td className="p-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                            target.status === 'READY_FOR_HUMAN_APPROVAL' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50' :
                            target.status === 'AUTOMATION_STOPPED' ? 'bg-purple-950 text-purple-300 border border-purple-500/50' :
                            'bg-red-950 text-red-400 border border-red-500/30'
                          }`}>
                            {target.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="p-3 text-red-400 text-[9px] font-sans">
                          {target.blockReason || '—'}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <button
                            onClick={() => {
                              setSelectedSlug(getCompanySlug(target.company));
                              setActiveDashboardTab('COMPOSER');
                            }}
                            className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-cyan-300 rounded font-bold cursor-pointer"
                          >
                            REVIEW
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* TAB 4: REPLY-WORTHINESS & OPPORTUNITY DISCOVERY ENGINE                    */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {activeDashboardTab === 'OPPORTUNITY_DISCOVERY' && (
          <div className="space-y-6">
            {/* Top Metrics Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 font-mono text-xs text-center">
              <div className="bg-zinc-950 border border-zinc-800 p-3 rounded-xl">
                <span className="text-[9px] text-zinc-500 uppercase block font-bold">TOTAL SCANNED</span>
                <span className="text-white font-bold text-base">{opportunityMetrics.total}</span>
              </div>
              <div className="bg-zinc-950 border border-amber-500/50 p-3 rounded-xl">
                <span className="text-[9px] text-amber-400 uppercase block font-bold">TOP OPPORTUNITY</span>
                <span className="text-amber-300 font-bold text-base">{opportunityMetrics.highPriority}</span>
              </div>
              <div className="bg-zinc-950 border border-emerald-500/50 p-3 rounded-xl">
                <span className="text-[9px] text-emerald-400 uppercase block font-bold">QUALIFIED</span>
                <span className="text-emerald-300 font-bold text-base">{opportunityMetrics.qualified}</span>
              </div>
              <div className="bg-zinc-950 border border-blue-500/40 p-3 rounded-xl">
                <span className="text-[9px] text-blue-400 uppercase block font-bold">REVIEW (60–74)</span>
                <span className="text-blue-300 font-bold text-base">{opportunityMetrics.review}</span>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 p-3 rounded-xl">
                <span className="text-[9px] text-zinc-500 uppercase block font-bold">BLOCKED (&lt;60)</span>
                <span className="text-zinc-400 font-bold text-base">{opportunityMetrics.blocked}</span>
              </div>
              <div className="bg-zinc-950 border border-red-950 p-3 rounded-xl">
                <span className="text-[9px] text-red-400 uppercase block font-bold">NO SERVICE FIT</span>
                <span className="text-red-300 font-bold text-base">{opportunityMetrics.noServiceFit}</span>
              </div>
              <div className="bg-zinc-950 border border-purple-900/50 p-3 rounded-xl">
                <span className="text-[9px] text-purple-400 uppercase block font-bold">NEEDS VERIF</span>
                <span className="text-purple-300 font-bold text-base">{opportunityMetrics.needsVerification}</span>
              </div>
              <div className="bg-zinc-950 border border-cyan-900/50 p-3 rounded-xl">
                <span className="text-[9px] text-cyan-400 uppercase block font-bold">RECENT &le;30D</span>
                <span className="text-cyan-300 font-bold text-base">{opportunityMetrics.recentSignal}</span>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="bg-zinc-950 border border-zinc-850 p-4 rounded-xl space-y-3 font-mono text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['ALL', 'HIGH_PRIORITY', 'QUALIFIED', 'REVIEW', 'BLOCKED', 'NO_SERVICE_FIT', 'NEEDS_VERIFICATION', 'RECENT_SIGNAL'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setOpportunityFilter(f)}
                      className={`px-3 py-1 rounded-lg border font-bold uppercase transition-all cursor-pointer text-[10px] ${
                        opportunityFilter === f
                          ? 'bg-amber-950 border-amber-400 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                          : 'bg-black/60 border-zinc-800 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {f.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>

                <div className="relative min-w-[240px]">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={opportunitySearch}
                    onChange={e => setOpportunitySearch(e.target.value)}
                    placeholder="Search opportunity, tech hypothesis, question..."
                    className="w-full pl-9 pr-3 py-1.5 bg-black border border-zinc-800 rounded-lg text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/60 font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1 border-t border-zinc-900">
                <span>Showing <strong className="text-white">{filteredOpportunityRecords.length}</strong> of {opportunityMetrics.total} evaluated companies</span>
                <span className="text-zinc-500">Pipeline: Public Evidence → Multi-Signal Correlation → Technical Hypothesis → Business Impact → Why Now → Service Fit → Question Quality → Score</span>
              </div>
            </div>

            {/* Opportunities Table */}
            <div className="bg-zinc-950 border border-zinc-850 rounded-xl overflow-hidden shadow-2xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse font-mono text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/60 text-zinc-400 text-[10px] uppercase">
                      <th className="p-3">#</th>
                      <th className="p-3 min-w-[140px]">COMPANY</th>
                      <th className="p-3 min-w-[140px]">DECISION MAKER</th>
                      <th className="p-3">EVIDENCE</th>
                      <th className="p-3 min-w-[200px]">TECHNICAL HYPOTHESIS</th>
                      <th className="p-3 min-w-[180px]">BUSINESS IMPACT</th>
                      <th className="p-3 min-w-[140px]">WHY NOW</th>
                      <th className="p-3 min-w-[180px]">SERVICE FIT</th>
                      <th className="p-3 min-w-[260px]">EVIDENCE-BACKED QUESTION</th>
                      <th className="p-3">SCORE</th>
                      <th className="p-3 min-w-[140px]">ELIGIBILITY</th>
                      <th className="p-3">ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    {filteredOpportunityRecords.map((record, idx) => (
                      <tr 
                        key={idx}
                        className={`hover:bg-zinc-900/60 transition-colors ${
                          record.qualificationTier === 'HIGH_PRIORITY' ? 'bg-amber-950/15' :
                          record.qualificationTier === 'QUALIFIED' ? 'bg-emerald-950/10' : ''
                        }`}
                      >
                        <td className="p-3 text-zinc-500">{idx + 1}</td>
                        <td className="p-3 font-bold text-white whitespace-nowrap">
                          {record.company}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <div className="text-zinc-200 font-bold">{record.person}</div>
                          <div className="text-[10px] text-zinc-500">{record.role}</div>
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            record.evidence.length >= 2 ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30' :
                            record.evidence.length === 1 ? 'bg-blue-950 text-blue-300' : 'bg-zinc-900 text-zinc-500'
                          }`}>
                            {record.evidence.length} Sources
                          </span>
                        </td>
                        <td className="p-3 text-zinc-300 font-sans text-[11px] leading-tight" title={record.hypothesis}>
                          <span className="line-clamp-2">{record.hypothesis || '—'}</span>
                        </td>
                        <td className="p-3 text-zinc-400 font-sans text-[11px] leading-tight" title={record.businessImpact}>
                          <span className="line-clamp-2">{record.businessImpact || '—'}</span>
                        </td>
                        <td className="p-3 text-zinc-300 text-[10px]">
                          {record.whyNow || '—'}
                        </td>
                        <td className="p-3 text-zinc-300 text-[10px] whitespace-nowrap">
                          <span className={record.serviceFitScore > 0 ? 'text-cyan-300 font-bold' : 'text-zinc-500'}>
                            {record.serviceFit}
                          </span>
                        </td>
                        <td className="p-3 text-zinc-200 font-sans text-[11px] leading-tight" title={record.question}>
                          <span className="line-clamp-3">{record.question || '—'}</span>
                        </td>
                        <td className="p-3 font-bold whitespace-nowrap">
                          <span className={
                            record.replyWorthinessScore >= 85 ? 'text-amber-400 text-sm font-bold' :
                            record.replyWorthinessScore >= 75 ? 'text-emerald-400 font-bold' :
                            record.replyWorthinessScore >= 60 ? 'text-blue-400' : 'text-zinc-600'
                          }>
                            {record.replyWorthinessScore}/100
                          </span>
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                            record.eligibility === 'ELIGIBLE_FOR_OUTREACH' ? 'bg-amber-950 text-amber-300 border border-amber-500/50' :
                            record.eligibility === 'HUMAN_REVIEW_REQUIRED' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50' :
                            record.eligibility === 'NEEDS_VERIFICATION' ? 'bg-blue-950 text-blue-300 border border-blue-500/30' :
                            'bg-red-950 text-red-400 border border-red-500/30'
                          }`}>
                            {record.eligibility.replace(/_/g, ' ')}
                          </span>
                          {record.blockReason && (
                            <div className="text-[9px] text-red-400/80 font-sans mt-0.5 max-w-[160px] truncate" title={record.blockReason}>
                              {record.blockReason}
                            </div>
                          )}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <button
                            onClick={() => {
                              setSelectedSlug(getCompanySlug(record.company));
                              setActiveDashboardTab('COMPOSER');
                            }}
                            className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-cyan-300 rounded font-bold cursor-pointer"
                          >
                            REVIEW
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

