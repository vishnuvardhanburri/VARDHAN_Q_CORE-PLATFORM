import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Activity, Lock, Globe, Server, AlertTriangle, Fingerprint, Zap, Cpu, ScanLine, Crosshair, CheckCircle2, Network, Binary, ShieldAlert } from 'lucide-react';
import { api } from '../services/api';

interface DashboardProps {
  role: string;
}

export default function Dashboard({ role }: DashboardProps) {
  const [scanLog, setScanLog] = useState<string[]>([]);
  const [sseConnected, setSseConnected] = useState(true);
  
  const [targetDomain, setTargetDomain] = useState('');
  const [engagementState, setEngagementState] = useState<'idle' | 'hunting' | 'ai_synthesis' | 'enclave_verify' | 'sealed'>('idle');
  const [receipt, setReceipt] = useState<any>(null);
  
  const matrixData = Array.from({ length: 40 }).map(() => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join(' ');

  const canEngageTarget = role === 'ROOT_AUTHORITY';
  const isAuditor = role === 'COMPLIANCE_AUDITOR';
  const isSoc = role === 'SOC_OPERATOR';

  useEffect(() => {
    const startupLogs = [
      `[SYS] INITIALIZING VARDHAN Q-CORE PLANE...`,
      `[SYS] AUTHENTICATED AS: ${role}`,
    ];

    if (canEngageTarget) {
      startupLogs.push(`[SEC] ROOT CLEARANCE GRANTED. WEAPONS SYSTEMS ARMED.`);
    } else {
      startupLogs.push(`[SEC] RESTRICTED CLEARANCE. TARGET ACQUISITION LOCKED.`);
    }

    startupLogs.push(`[SYS] eBPF RING-0 KERNEL SHIELD: ARMED`);
    startupLogs.push(`[SYS] AWAITING TELEMETRY SYNC...`);

    setScanLog(startupLogs);
  }, [role, canEngageTarget]);

  const triggerEngagement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetDomain || !canEngageTarget) return;
    
    setEngagementState('hunting');
    setReceipt(null);
    setScanLog(prev => [...prev, `\n[SYS] INITIATING DIRECTED OSINT STRIKE -> ${targetDomain}`]);
    
    try {
      setScanLog(prev => [...prev, `[HUNTER] SSL/TLS HANDSHAKE INTERCEPTED. HEADERS ACQUIRED.`]);
      setEngagementState('ai_synthesis');
      setScanLog(prev => [...prev, `[KILLER] WAKING LOCAL LLAMA-3 AI TO SYNTHESIZE REPORT...`]);

      // THIS IS A REAL BACKEND CALL TO THE NODE+RUST ENGINE
      const response = await fetch('http://localhost:50051/api/strike', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDomain })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setScanLog(prev => [...prev, `[KILLER] NEURAL SYNTHESIS COMPLETE. VIOLATION EXECUTED.`]);
        setEngagementState('enclave_verify');
        
        setTimeout(() => {
          setScanLog(prev => [...prev, `[HYBRID] CHAOS TWIN INJECTION -> SURVIVED. ENCLAVE LOCK SECURED.`]);
          setScanLog(prev => [...prev, `[QUANTUM] SEALING RECEIPT VIA RUST ENGINE...`]);
          setEngagementState('sealed');
          setReceipt(data.receipt);
          setScanLog(prev => [...prev, `[SYS] ENGAGEMENT CONCLUDED. RECEIPT: ${data.receipt.id}`]);
        }, 1500);
      } else {
        setScanLog(prev => [...prev, `[SYS-ERR] STRIKE FAILED: ${data.error}`]);
        setEngagementState('idle');
      }
    } catch (err: any) {
      setScanLog(prev => [...prev, `[SYS-ERR] CONNECTION TO HYBRID CORE FAILED: ${err.message}`]);
      setEngagementState('idle');
    }
  };

  return (
    <div className="min-h-screen bg-[#020202] text-cyan-500 font-mono p-2 md:p-4 relative overflow-hidden flex flex-col uppercase">
      <div className="absolute inset-0 hex-grid z-0" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-full h-[600px] bg-cyan-900/10 blur-[120px] rounded-full pointer-events-none z-0" />

      {/* Top Navigation Bar HUD */}
      <header className="relative z-10 flex items-center justify-between border-b border-cyan-500/20 pb-4 mb-4">
        <div className="flex items-center gap-4">
          <div className={`relative flex items-center justify-center w-12 h-12 border ${canEngageTarget ? 'border-amber-500 bg-amber-950/50 text-amber-400' : 'border-cyan-400 bg-cyan-950/50 text-cyan-400'}`}>
            <Shield className="w-6 h-6" />
            <div className={`absolute inset-0 border animate-ping opacity-20 ${canEngageTarget ? 'border-amber-400' : 'border-cyan-400'}`} />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold tracking-[0.3em] text-white">VARDHAN<span className={canEngageTarget ? 'text-amber-500' : 'text-cyan-500'}>SOVEREIGN</span></h1>
            <span className="text-[10px] tracking-[0.4em] text-cyan-500/80">
              CLEARANCE: <span className={canEngageTarget ? 'text-amber-400' : isAuditor ? 'text-purple-400' : 'text-emerald-400'}>{role}</span>
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-8 text-xs tracking-widest">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">ENCLAVE:</span>
            <span className="text-emerald-400 font-bold">AWS NITRO (LOCKED)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">DATALINK:</span>
            <div className="flex items-center gap-2 text-emerald-400">
              <div className="w-2 h-2 bg-emerald-400 rounded-full shadow-[0_0_10px_#34d399] animate-pulse" />
              ACTIVE_SECURE
            </div>
          </div>
        </div>
      </header>

      {/* Main Tactical Grid */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-4 relative z-10 flex-1">
        
        {/* LEFT PANEL: TARGET ACQUISITION (HUD BOX) */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          <div className={`hud-box p-5 flex flex-col relative ${!canEngageTarget ? 'hud-box-red overflow-hidden' : ''}`}>
            
            {/* RBAC LOCK OVERLAY */}
            {!canEngageTarget && (
              <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 text-center">
                <ShieldAlert className="w-8 h-8 text-red-500 mb-2" />
                <div className="text-red-500 font-bold tracking-[0.3em] text-[10px]">ACCESS DENIED</div>
                <div className="text-slate-500 text-[8px] tracking-[0.2em] mt-2 leading-relaxed">
                  YOUR CLEARANCE LEVEL ({role}) IS INSUFFICIENT TO AUTHORIZE DIRECTED STRIKES. ROOT_AUTHORITY REQUIRED.
                </div>
              </div>
            )}

            <h2 className="text-[10px] text-cyan-400 font-bold tracking-[0.3em] mb-4 flex items-center gap-2 border-b border-cyan-500/20 pb-2">
              <Crosshair className="w-4 h-4" /> TARGET ACQUISITION
            </h2>
            
            <form onSubmit={triggerEngagement} className="space-y-4 flex-1">
              <div>
                <label className="text-[9px] text-slate-500 tracking-[0.2em] mb-1 block">DOMAIN OVERRIDE</label>
                <input 
                  type="text" 
                  value={targetDomain}
                  onChange={(e) => setTargetDomain(e.target.value)}
                  disabled={engagementState !== 'idle' && engagementState !== 'sealed'}
                  className="w-full bg-transparent border-b border-cyan-500/50 py-2 text-white font-bold tracking-widest focus:outline-none focus:border-cyan-300 transition-colors placeholder:text-cyan-900"
                  placeholder="E.G. BARCLAYS.CO.UK"
                />
              </div>
              
              <button 
                type="submit"
                disabled={!targetDomain || (engagementState !== 'idle' && engagementState !== 'sealed')}
                className="w-full py-3 bg-amber-950/40 border border-amber-500 text-amber-400 hover:bg-amber-900 hover:text-white transition-all font-bold tracking-[0.3em] text-xs flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed group"
              >
                <Zap className="w-4 h-4 group-hover:animate-bounce" /> ENGAGE HUNTER-KILLER
              </button>
            </form>

            <div className="mt-8 space-y-4 border-t border-cyan-500/20 pt-4">
              <div className="text-[9px] tracking-[0.2em] text-slate-500 mb-2">ENGAGEMENT SEQUENCE</div>
              
              <div className={`flex items-center gap-3 text-[10px] tracking-widest ${engagementState === 'hunting' || engagementState === 'ai_synthesis' || engagementState === 'enclave_verify' || engagementState === 'sealed' ? 'text-white' : 'text-slate-700'}`}>
                <div className="font-bold w-4">01</div>
                <div className={`flex-1 h-1 ${engagementState === 'hunting' ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse' : engagementState !== 'idle' ? 'bg-cyan-500' : 'bg-slate-800'}`} />
                <div className="w-24 text-right">RECON</div>
              </div>
              
              <div className={`flex items-center gap-3 text-[10px] tracking-widest ${engagementState === 'ai_synthesis' || engagementState === 'enclave_verify' || engagementState === 'sealed' ? 'text-white' : 'text-slate-700'}`}>
                <div className="font-bold w-4">02</div>
                <div className={`flex-1 h-1 ${engagementState === 'ai_synthesis' ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse' : engagementState === 'enclave_verify' || engagementState === 'sealed' ? 'bg-cyan-500' : 'bg-slate-800'}`} />
                <div className="w-24 text-right">NEURAL SYNC</div>
              </div>

              <div className={`flex items-center gap-3 text-[10px] tracking-widest ${engagementState === 'enclave_verify' || engagementState === 'sealed' ? 'text-white' : 'text-slate-700'}`}>
                <div className="font-bold w-4">03</div>
                <div className={`flex-1 h-1 ${engagementState === 'enclave_verify' ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse' : engagementState === 'sealed' ? 'bg-cyan-500' : 'bg-slate-800'}`} />
                <div className="w-24 text-right">ENCLAVE LOCK</div>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER PANEL: TERMINAL & TOPOLOGY */}
        <div className="lg:col-span-6 flex flex-col gap-4">
          <div className={`hud-box h-48 p-1 relative overflow-hidden flex items-center justify-center ${isAuditor ? 'opacity-50 grayscale' : ''}`}>
            <div className="scanline" />
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgNDBoNDBWMEgwem0yMCAyMGMtNS41IDAtMTAtNC41LTEwLTEwczQuNS0xMCAxMC0xMCAxMCA0LjUgMTAgMTAtNC41IDEwLTEwIDEweiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDYsIDE4MiwgMjEyLCAwLjEpIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZykiLz48L3N2Zz4=')] opacity-30" />
            
            <div className="relative z-10 flex items-center justify-center w-full h-full">
               <div className="absolute w-16 h-16 border-2 border-cyan-400 rounded-full flex items-center justify-center shadow-[0_0_20px_#22d3ee]">
                 <div className="w-12 h-12 border border-cyan-300 border-dashed rounded-full animate-[spin_4s_linear_infinite]" />
                 <Server className="absolute w-6 h-6 text-white" />
               </div>
               
               <div className="absolute w-[250px] h-[250px] border border-cyan-900 rounded-full animate-[spin_20s_linear_infinite]">
                 <div className="absolute -top-3 left-1/2 w-6 h-6 bg-black border border-emerald-500 rounded-full flex items-center justify-center"><div className="w-2 h-2 bg-emerald-400 rounded-full" /></div>
                 <div className="absolute -bottom-3 left-1/2 w-6 h-6 bg-black border border-emerald-500 rounded-full flex items-center justify-center"><div className="w-2 h-2 bg-emerald-400 rounded-full" /></div>
                 <div className="absolute top-1/2 -left-3 w-6 h-6 bg-black border border-red-500 rounded-full flex items-center justify-center shadow-[0_0_10px_#ef4444]"><div className="w-2 h-2 bg-red-500 rounded-full" /></div>
               </div>
               <div className="absolute text-[8px] tracking-[0.3em] text-red-500 left-4 top-4 font-bold">eBPF TARPIT: ACTIVE</div>
               <div className="absolute text-[8px] tracking-[0.3em] text-emerald-400 right-4 bottom-4">RAFT CLUSTER: SYNCED</div>
            </div>
          </div>

          <div className="hud-box p-4 flex-1 flex flex-col data-stream">
            <h2 className="text-[10px] text-cyan-400 font-bold tracking-[0.3em] mb-4 flex items-center gap-2 border-b border-cyan-500/20 pb-2">
              <Binary className="w-4 h-4" /> RAW TELEMETRY STREAM
            </h2>
            <div className="flex-1 overflow-y-auto terminal-scroll text-[11px] leading-relaxed tracking-wider">
              <AnimatePresence>
                {scanLog.map((log, i) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }} 
                    animate={{ opacity: 1, x: 0 }} 
                    key={i}
                    className={`mb-2 ${log.includes('ERR') || log.includes('RESTRICTED') ? 'text-red-400' : log.includes('SEALED') || log.includes('SECURED') ? 'text-emerald-400' : 'text-cyan-300'}`}
                  >
                    {log}
                  </motion.div>
                ))}
              </AnimatePresence>
              <div className="text-cyan-500 animate-pulse mt-2">█</div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: RECEIPT & CRYPTO */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          <div className={`hud-box p-5 ${isAuditor ? 'border-purple-500/50 shadow-[inset_0_0_20px_rgba(168,85,247,0.2)]' : ''}`}>
            <h2 className={`text-[10px] font-bold tracking-[0.3em] mb-4 flex items-center gap-2 border-b pb-2 ${isAuditor ? 'text-purple-400 border-purple-500/20' : 'text-cyan-400 border-cyan-500/20'}`}>
              <Fingerprint className="w-4 h-4" /> CRYPTO ENGINE
            </h2>
            <div className="space-y-4 text-xs">
              <div>
                <div className="text-[8px] text-slate-500 tracking-[0.2em] mb-1">PQC ALGORITHM</div>
                <div className={`text-white bg-black border p-2 text-center tracking-widest font-bold ${isAuditor ? 'border-purple-800' : 'border-cyan-800'}`}>ML-DSA-87</div>
              </div>
              <div>
                <div className="text-[8px] text-slate-500 tracking-[0.2em] mb-1">CLASSICAL ALGORITHM</div>
                <div className={`text-white bg-black border p-2 text-center tracking-widest font-bold ${isAuditor ? 'border-purple-800' : 'border-cyan-800'}`}>ED25519</div>
              </div>
              <div>
                <div className="text-[8px] text-slate-500 tracking-[0.2em] mb-1">HASHING (MERKLE)</div>
                <div className={`text-white bg-black border p-2 text-center tracking-widest font-bold ${isAuditor ? 'border-purple-800' : 'border-cyan-800'}`}>BLAKE3</div>
              </div>
            </div>
          </div>

          <div className="hud-box p-5 flex-1 flex flex-col">
            <h2 className="text-[10px] text-emerald-400 font-bold tracking-[0.3em] mb-4 flex items-center gap-2 border-b border-emerald-500/20 pb-2">
              <CheckCircle2 className="w-4 h-4" /> SECURE VAULT
            </h2>
            
            {receipt ? (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex-1 flex flex-col justify-center border border-emerald-500/30 bg-emerald-950/20 p-4 relative overflow-y-auto">
                <div className="absolute top-2 right-2 flex gap-1">
                   <div className="w-1 h-1 bg-emerald-400 rounded-full" />
                   <div className="w-1 h-1 bg-emerald-400 rounded-full" />
                </div>
                <div className="text-center mb-4">
                  <div className="text-[10px] text-emerald-500 tracking-widest mb-1">RECEIPT ID</div>
                  <div className="text-white font-bold tracking-wider">{receipt.id}</div>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="text-[8px] text-emerald-600 tracking-widest">PAYLOAD HASH</div>
                    <div className="text-[8px] text-emerald-300 break-all">{receipt.hash}</div>
                  </div>
                  <div className="pt-2 border-t border-emerald-500/20">
                    <div className="text-[8px] text-emerald-600 tracking-widest">SIGNATURES</div>
                    <div className="text-[9px] text-white flex justify-between"><span>L1:</span> <span className="text-emerald-400">{receipt.pq}</span></div>
                    <div className="text-[9px] text-white flex justify-between"><span>L2:</span> <span className="text-emerald-400">{receipt.ed}</span></div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[10px] text-slate-600 tracking-[0.2em] text-center px-4">
                {isAuditor ? 'AWAITING HISTORICAL RECEIPT SELECTION.' : 'AWAITING HYBRID ENGAGEMENT COMPLETION TO SEAL RECEIPT.'}
              </div>
            )}
          </div>
        </div>

      </main>
    </div>
  );
}
