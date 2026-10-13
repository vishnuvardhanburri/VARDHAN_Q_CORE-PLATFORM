import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, Fingerprint, Key, Lock, ChevronRight } from 'lucide-react';

interface LoginProps {
  onAuthenticate: (role: string) => void;
}

export default function Login({ onAuthenticate }: LoginProps) {
  const [authStage, setAuthStage] = useState<'idle' | 'verifying' | 'success'>('idle');
  const [selectedRole, setSelectedRole] = useState('SOC_OPERATOR');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthStage('verifying');
    
    // Simulate Cryptographic Quantum Verification
    setTimeout(() => {
      setAuthStage('success');
      setTimeout(() => {
        onAuthenticate(selectedRole);
      }, 800);
    }, 2000);
  };

  return (
    <div className="min-h-screen text-slate-300 font-mono flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background ambient light */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl h-[500px] bg-cyan-500/10 blur-[150px] rounded-full pointer-events-none" />

      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-panel w-full max-w-md p-8 rounded-2xl relative z-10 border border-cyan-500/20 shadow-[0_0_50px_rgba(6,182,212,0.1)]"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <div className={`absolute inset-0 blur-md opacity-50 rounded-full ${authStage === 'verifying' ? 'bg-amber-500 animate-pulse' : authStage === 'success' ? 'bg-emerald-500' : 'bg-cyan-500'}`} />
            <Shield className={`w-16 h-16 relative z-10 ${authStage === 'verifying' ? 'text-amber-400' : authStage === 'success' ? 'text-emerald-400' : 'text-cyan-400'}`} />
          </div>
          <h1 className="text-xl font-bold tracking-[0.2em] text-white uppercase text-center">
            Vardhan <span className="text-cyan-400 font-light">Identity v4.0</span>
          </h1>
          <div className="text-[10px] text-cyan-500/70 tracking-widest mt-2 uppercase">
            Zero-Trust Vardhan Perimeter
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-4">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="h-4 w-4 text-slate-500" />
              </div>
              <input 
                type="text" 
                disabled={authStage !== 'idle'}
                defaultValue="VARDHAN-ADMIN-993"
                className="w-full bg-black/50 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors disabled:opacity-50"
                placeholder="Hardware Identifier"
              />
            </div>

            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Key className="h-4 w-4 text-slate-500" />
              </div>
              <input 
                type="password" 
                disabled={authStage !== 'idle'}
                defaultValue="••••••••••••••••"
                className="w-full bg-black/50 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors disabled:opacity-50"
                placeholder="FIPS-204 Quantum Key"
              />
            </div>

            <div className="relative">
              <select 
                disabled={authStage !== 'idle'}
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded-lg py-3 px-4 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors appearance-none disabled:opacity-50"
              >
                <option value="SOC_OPERATOR">Role: SOC Operator (Read/Triange)</option>
                <option value="COMPLIANCE_AUDITOR">Role: Chief Auditor (Merkle Proofs)</option>
                <option value="ROOT_AUTHORITY">Role: Root Authority (Full Control)</option>
              </select>
            </div>
          </div>

          <button 
            type="submit"
            disabled={authStage !== 'idle'}
            className={`w-full py-3 rounded-lg flex items-center justify-center gap-2 text-sm font-bold tracking-widest transition-all ${
              authStage === 'idle' 
                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 hover:shadow-[0_0_20px_rgba(6,182,212,0.2)]'
                : authStage === 'verifying'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50'
                : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
            }`}
          >
            {authStage === 'idle' && <><Fingerprint className="w-4 h-4" /> INITIATE HANDSHAKE</>}
            {authStage === 'verifying' && <span className="animate-pulse">VERIFYING ML-DSA-87 SIGNATURE...</span>}
            {authStage === 'success' && <>ACCESS GRANTED</>}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
