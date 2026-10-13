import React, { useState, useEffect } from 'react';
import { Cpu, Sparkles, Send, Copy, MessageSquare, Terminal, ChevronRight, CheckCircle2, Shield, RefreshCw } from 'lucide-react';
import { V2CompanyTarget, TECHNICAL_DISCUSSION_TOPICS } from '../../data/v2DataEngine';
import { checkOllamaHealth, getOllamaModels, generateObjectionHandlingWithOllama } from '../../services/ollamaService';

interface TechnicalDiscussionEngineProps {
  targets: V2CompanyTarget[];
  onSendEmail: (companySlug: string) => void;
}

const OBJECTIONS = [
  "Already have internal team",
  "No budget for £75k engagements right now",
  "Not a priority this quarter",
  "Send me some case studies"
];

export const TechnicalDiscussionEngine: React.FC<TechnicalDiscussionEngineProps> = ({ targets, onSendEmail }) => {
  const [selectedSlug, setSelectedSlug] = useState<string>(targets[0]?.slug || 'wiz');
  const [engineMode, setEngineMode] = useState<'initiate' | 'objection'>('initiate');
  const [activeTopic, setActiveTopic] = useState<string>(TECHNICAL_DISCUSSION_TOPICS[0]);
  const [activeObjection, setActiveObjection] = useState<string>(OBJECTIONS[0]);
  const [copyFeedback, setCopyFeedback] = useState(false);
  
  // Ollama State
  const [isOllamaOnline, setIsOllamaOnline] = useState(false);
  const [selectedModel, setSelectedModel] = useState('llama3');
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Cache for generated objection copies
  const [generatedObjections, setGeneratedObjections] = useState<Record<string, { subject: string; body: string }>>({});

  const selectedTarget = targets.find(t => t.slug === selectedSlug) || targets[0];

  useEffect(() => {
    async function initOllama() {
      const online = await checkOllamaHealth();
      setIsOllamaOnline(online);
      if (online) {
        const models = await getOllamaModels();
        if (models.length > 0) setSelectedModel(models[0]);
      }
    }
    initOllama();
  }, []);

  // Initiate Mode Static Generation
  const generateDiscussionCopy = (topic: string, target: V2CompanyTarget) => {
    const contactFirstName = target.contactName.split(' ')[0];
    return {
      subject: `Engineering Peer Note: ${topic} (${target.companyName})`,
      body: `Hi ${contactFirstName} —\n\nReviewed ${target.companyName}'s engineering footprint regarding ${topic.toLowerCase()}.\n\nWhen scaling past 100k daily operations, unoptimized connection pool locks and worker thread memory degradation often create silent SLA penalties during peak traffic.\n\nWe recently benchmarked a lockless async architecture that decoupled persistence worker threads from control-plane coordination, dropping p99 latencies from 4.8s to 1.42ms under 10x traffic surge.\n\nNo sales pitch — just wanted to share the architectural blueprint with your platform lead. Mind if I send over the technical breakdown?\n\nBest,\n\nVishnu Vardhan Burri\nPrincipal Architect | VARDHAN Technologies\nhttps://www.vardhantechlabs.com`
    };
  };

  // Generate Objection Handling with Ollama (or fallback)
  const handleGenerateObjection = async () => {
    const cacheKey = `${selectedTarget.slug}_${activeObjection}`;
    if (generatedObjections[cacheKey]) return; // already generated

    setIsGenerating(true);
    try {
      const generated = await generateObjectionHandlingWithOllama({
        companySlug: selectedTarget.slug,
        companyName: selectedTarget.companyName,
        contactName: selectedTarget.contactName,
        objectionType: activeObjection,
        challenge: selectedTarget.icpSector === 'DevTools' ? 'telemetry backpressure' : 'connection lock contention', // mock challenge if missing
        model: selectedModel
      });
      setGeneratedObjections(prev => ({ ...prev, [cacheKey]: generated }));
    } catch (e) {
      console.error(e);
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (engineMode === 'objection') {
      const cacheKey = `${selectedTarget.slug}_${activeObjection}`;
      if (!generatedObjections[cacheKey]) {
        handleGenerateObjection();
      }
    }
  }, [engineMode, selectedTarget.slug, activeObjection]);

  const currentInitiateCopy = generateDiscussionCopy(activeTopic, selectedTarget);
  const objectionCacheKey = `${selectedTarget.slug}_${activeObjection}`;
  const currentObjectionCopy = generatedObjections[objectionCacheKey] || { subject: 'Generating...', body: 'Generating highly technical authoritative response...' };

  const currentCopy = engineMode === 'initiate' ? currentInitiateCopy : currentObjectionCopy;

  const handleCopy = () => {
    navigator.clipboard.writeText(`TO: ${selectedTarget.email}\nSUBJECT: ${currentCopy.subject}\n\n${currentCopy.body}`);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  return (
    <div className="space-y-6 font-sans">
      
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between border-b border-zinc-900 pb-3 font-mono text-xs gap-4">
        <div className="flex items-center gap-3">
          <span className="text-cyan-400 font-bold uppercase tracking-wider flex items-center gap-2 bg-cyan-950/60 border border-cyan-500/40 px-3 py-1 rounded">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <span>TECHNICAL DISCUSSION ENGINE • ZERO-SALES PEER ARCHITECTURE</span>
          </span>
          <span className="text-zinc-500">OBJECTIVE: TECHNICAL ALIGNMENT</span>
        </div>

        {/* Engine Mode Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEngineMode('initiate')}
            className={`px-4 py-1.5 rounded-lg border font-bold uppercase transition-all cursor-pointer ${
              engineMode === 'initiate'
                ? 'bg-cyan-500 text-black border-cyan-400'
                : 'bg-zinc-950 text-zinc-400 border-zinc-850 hover:text-white'
            }`}
          >
            Initiate Peer Note
          </button>
          <button
            onClick={() => setEngineMode('objection')}
            className={`px-4 py-1.5 rounded-lg border font-bold uppercase transition-all cursor-pointer flex items-center gap-1.5 ${
              engineMode === 'objection'
                ? 'bg-amber-500 text-black border-amber-400'
                : 'bg-zinc-950 text-amber-500/50 border-zinc-850 hover:text-amber-400'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Handle Objection</span>
          </button>
        </div>
      </div>

      {/* Selectors */}
      <div className="space-y-2 font-mono text-xs">
        <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest block">
          // SELECT {engineMode === 'initiate' ? 'RECOMMENDED DISCUSSION ANGLE' : 'INBOUND OBJECTION TO HANDLE'}
        </span>

        <div className="flex flex-wrap gap-2">
          {engineMode === 'initiate' ? (
            TECHNICAL_DISCUSSION_TOPICS.map(topic => (
              <button
                key={topic}
                onClick={() => setActiveTopic(topic)}
                className={`px-3 py-2 rounded-xl border text-xs font-bold uppercase transition-all cursor-pointer ${
                  activeTopic === topic
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-black border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                    : 'bg-zinc-950 text-zinc-400 border-zinc-850 hover:text-white'
                }`}
              >
                {topic}
              </button>
            ))
          ) : (
            OBJECTIONS.map(objection => (
              <button
                key={objection}
                onClick={() => setActiveObjection(objection)}
                className={`px-3 py-2 rounded-xl border text-xs font-bold uppercase transition-all cursor-pointer ${
                  activeObjection === objection
                    ? 'bg-amber-500 text-black border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                    : 'bg-zinc-950 text-amber-500/50 border-zinc-850 hover:text-amber-400'
                }`}
              >
                {objection}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Execution Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 font-mono text-xs">

        {/* Left 4 Cols: Target List */}
        <div className="lg:col-span-4 space-y-3">
          <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest block">
            // TARGET ACCOUNTS ({targets.length})
          </span>

          <div className="space-y-2 max-h-[580px] overflow-y-auto pr-1">
            {targets.slice(0, 30).map(t => {
              const isSelected = t.slug === selectedTarget.slug;
              return (
                <div
                  key={t.slug}
                  onClick={() => setSelectedSlug(t.slug)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#041026] border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.18)]'
                      : 'bg-zinc-950 border-zinc-900 hover:border-zinc-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-display font-bold text-white text-xs uppercase">{t.companyName}</span>
                    <span className="text-[9px] font-bold text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 px-2 py-0.5 rounded">
                      {t.icpSector}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 font-sans">
                    {t.contactName} ({t.designation})
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right 8 Cols: Peer Discussion Copy Generator */}
        <div className="lg:col-span-8 space-y-6">
          <div className={`bg-[#030815] border p-6 sm:p-8 rounded-2xl space-y-6 shadow-[0_10px_50px_rgba(0,0,0,0.8)] ${
            engineMode === 'initiate' ? 'border-cyan-500/40' : 'border-amber-500/40'
          }`}>
            
            {/* Target Brief */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-900 pb-5">
              <div>
                <h3 className="font-display text-xl font-bold text-white uppercase">{selectedTarget.companyName}</h3>
                <p className="text-xs text-zinc-400 font-mono mt-1">
                  Recipient: <strong className="text-white">{selectedTarget.contactName}</strong> ({selectedTarget.designation}) &lt;{selectedTarget.email}&gt;
                </p>
              </div>

              {engineMode === 'objection' && (
                <button
                  onClick={handleGenerateObjection}
                  disabled={isGenerating || !isOllamaOnline}
                  className="text-xs font-bold text-amber-400 bg-amber-950/60 border border-amber-500/40 px-3 py-1.5 rounded uppercase flex items-center gap-2 transition-all hover:bg-amber-900 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
                  {isGenerating ? 'GENERATING WITH OLLAMA...' : isOllamaOnline ? `REGENERATE (${selectedModel})` : 'OLLAMA OFFLINE (USING FALLBACK)'}
                </button>
              )}
            </div>

            {/* Generated Discussion Email */}
            <div className="space-y-4 font-mono text-xs relative">
              {isGenerating && (
                 <div className="absolute inset-0 bg-[#030815]/80 backdrop-blur-sm z-10 flex items-center justify-center border border-amber-500/20 rounded-lg">
                    <div className="text-amber-400 flex flex-col items-center gap-3">
                      <RefreshCw className="w-8 h-8 animate-spin" />
                      <span className="font-bold uppercase tracking-widest text-[10px]">OLLAMA SYNTHESIZING ARCHITECTURE PIVOT...</span>
                    </div>
                 </div>
              )}
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 uppercase font-bold">
                  {engineMode === 'initiate' ? 'PEER SUBJECT LINE:' : 'OBJECTION SUBJECT LINE:'}
                </label>
                <input
                  type="text"
                  readOnly
                  value={currentCopy.subject}
                  className={`w-full bg-zinc-950 border border-zinc-900 rounded p-2.5 font-bold ${
                    engineMode === 'initiate' ? 'text-cyan-400' : 'text-amber-400'
                  }`}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 uppercase font-bold">
                  {engineMode === 'initiate' ? 'ZERO-SALES TECHNICAL PEER EMAIL BODY:' : 'AUTHORITATIVE OBJECTION PIVOT BODY:'}
                </label>
                <textarea
                  rows={11}
                  readOnly
                  value={currentCopy.body}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded p-3 text-zinc-200 leading-relaxed font-mono text-xs resize-none"
                />
              </div>
            </div>

            {/* Action Bar */}
            <div className="pt-2 flex flex-wrap gap-3">
              <button
                onClick={() => onSendEmail(selectedTarget.slug)}
                className={`flex-1 py-4 text-black font-bold uppercase rounded-xl transition-all shadow-[0_0_25px_rgba(6,182,212,0.35)] flex items-center justify-center gap-2 cursor-pointer ${
                  engineMode === 'initiate'
                    ? 'bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-500 hover:from-cyan-400 hover:to-blue-400'
                    : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 shadow-[0_0_25px_rgba(245,158,11,0.35)]'
                }`}
              >
                <Send className="w-4 h-4" />
                <span>{engineMode === 'initiate' ? 'START TECHNICAL DISCUSSION NOW' : 'SEND OBJECTION PIVOT NOW'}</span>
              </button>

              <button
                onClick={handleCopy}
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
  );
};
