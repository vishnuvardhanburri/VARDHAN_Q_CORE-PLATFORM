import React from 'react';
import { Layers, ChevronRight, DollarSign, User, Building, CheckCircle2, AlertCircle } from 'lucide-react';
import { V2CompanyTarget } from '../../data/v2DataEngine';

interface VisualPipelineViewProps {
  targets: V2CompanyTarget[];
  onSelectTarget: (target: V2CompanyTarget) => void;
}

export const VisualPipelineView: React.FC<VisualPipelineViewProps> = ({ targets, onSelectTarget }) => {
  const stages: V2CompanyTarget['pipelineStage'][] = [
    'Research',
    'Email Generated',
    'Email Sent',
    'Opened',
    'Replied',
    'Technical Discussion',
    'Discovery Meeting',
    'Proposal',
    'Negotiation',
    'Won'
  ];

  return (
    <div className="space-y-6 font-sans">
      
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-900 pb-3 font-mono text-xs">
        <div className="flex items-center gap-3">
          <span className="text-purple-400 font-bold uppercase tracking-wider flex items-center gap-2 bg-purple-950/60 border border-purple-500/40 px-3 py-1 rounded">
            <Layers className="w-4 h-4 text-purple-400" />
            <span>VISUAL PIPELINE KANBAN BOARD • (£30,000+ STAGES)</span>
          </span>
          <span className="text-zinc-500">DATABASE: 216 ENTERPRISE ACCOUNTS</span>
        </div>
      </div>

      {/* Horizontal Pipeline Stage Columns (Kanban Board) */}
      <div className="flex gap-4 overflow-x-auto pb-6 font-mono text-xs">
        {stages.map((stage, sIdx) => {
          const stageTargets = targets.filter(t => t.pipelineStage === stage);
          const stageValue = stageTargets.length * 30000;

          return (
            <div
              key={stage}
              className="w-72 shrink-0 bg-zinc-950 border border-zinc-850 rounded-2xl p-4 flex flex-col space-y-3 min-h-[500px]"
            >
              {/* Stage Header */}
              <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                <div>
                  <span className="text-[10px] text-zinc-500 font-mono block">STAGE {sIdx + 1}</span>
                  <h4 className="font-bold text-white uppercase text-xs tracking-wider">{stage}</h4>
                </div>
                <span className="text-xs font-bold text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 px-2 py-0.5 rounded">
                  {stageTargets.length}
                </span>
              </div>

              {stageValue > 0 && (
                <div className="text-[10px] text-amber-400 font-bold flex items-center gap-1 bg-amber-950/40 border border-amber-500/30 px-2 py-1 rounded">
                  <DollarSign className="w-3 h-3 text-amber-400" />
                  <span>Est: £{stageValue.toLocaleString()}</span>
                </div>
              )}

              {/* Stage Items */}
              <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[480px] pr-1">
                {stageTargets.map(t => (
                  <div
                    key={t.slug}
                    onClick={() => onSelectTarget(t)}
                    className="p-3.5 bg-black border border-zinc-850 hover:border-cyan-500/50 rounded-xl space-y-2 cursor-pointer transition-all hover:shadow-[0_0_15px_rgba(6,182,212,0.15)] group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-xs uppercase group-hover:text-cyan-400 transition-colors">
                        {t.companyName}
                      </span>
                      <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.2 rounded">
                        {t.priorityScore}
                      </span>
                    </div>

                    <div className="text-[11px] text-zinc-400 font-sans">
                      {t.contactName} ({t.designation})
                    </div>

                    <div className="text-[9px] text-zinc-500 line-clamp-1 border-t border-zinc-900 pt-1.5">
                      Topic: <span className="text-zinc-300">{t.technicalDiscussionTopic}</span>
                    </div>
                  </div>
                ))}

                {stageTargets.length === 0 && (
                  <div className="text-center py-12 text-[10px] text-zinc-600 border border-dashed border-zinc-900 rounded-xl">
                    No accounts in stage
                  </div>
                )}
              </div>

            </div>
          );
        })}
      </div>

    </div>
  );
};
