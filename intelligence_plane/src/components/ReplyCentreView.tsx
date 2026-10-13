import React, { useState } from 'react';
import { MessageSquare, Send, CheckCircle2, AlertCircle, Clock, Sparkles, UserCheck, CornerDownLeft, Inbox } from 'lucide-react';
import { ProspectReply } from '../data/mockData';

interface ReplyCentreViewProps {
  replies: ProspectReply[];
  onMarkRead: (replyId: string) => void;
}

export const ReplyCentreView: React.FC<ReplyCentreViewProps> = ({ replies, onMarkRead }) => {
  const [selectedReplyId, setSelectedReplyId] = useState<string>(replies[0]?.id || '');
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>('all');
  const [replyDraft, setReplyDraft] = useState<string>('');

  const selectedReply = replies.find(r => r.id === selectedReplyId) || replies[0];

  React.useEffect(() => {
    if (selectedReply) {
      setReplyDraft(selectedReply.suggestedAiReply);
      onMarkRead(selectedReply.id);
    }
  }, [selectedReplyId]);

  const categories = [
    'all',
    'Meeting Requested',
    'Interested',
    'Question',
    'Referral',
    'Not Interested',
    'Out Of Office',
    'Spam'
  ];

  const filteredReplies = replies.filter(r => {
    if (activeCategoryFilter === 'all') return true;
    return r.category === activeCategoryFilter;
  });

  const categoryBadges: Record<string, string> = {
    'Meeting Requested': 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40',
    'Interested': 'bg-cyan-950/80 text-cyan-400 border-cyan-500/40',
    'Question': 'bg-blue-950/80 text-blue-400 border-blue-500/40',
    'Referral': 'bg-purple-950/80 text-purple-400 border-purple-500/40',
    'Not Interested': 'bg-zinc-900 text-zinc-400 border-zinc-800',
    'Out Of Office': 'bg-amber-950/80 text-amber-400 border-amber-500/40',
    'Spam': 'bg-red-950/80 text-red-400 border-red-500/40'
  };

  return (
    <div className="space-y-6 font-sans selection:bg-cyan-500 selection:text-black animate-fadeIn">
      
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-zinc-900 pb-4 font-mono text-xs">
        <div className="flex items-center gap-3">
          <span className="text-amber-400 font-bold bg-amber-950/40 border border-amber-500/30 px-3 py-1 rounded uppercase flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 fill-amber-400" />
            <span>AI REPLY CENTRE • AUTOMATED INTENT CATEGORIZATION</span>
          </span>
          <span className="text-zinc-500">INBOX: {replies.length} REPLIES</span>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex flex-wrap gap-2 pt-1 font-mono text-xs">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategoryFilter(cat)}
            className={`px-3 py-1.5 rounded-lg border font-bold uppercase transition-all cursor-pointer text-[11px] ${
              activeCategoryFilter === cat
                ? 'bg-amber-400 text-black border-amber-300 font-bold shadow-[0_0_12px_rgba(251,191,36,0.3)]'
                : 'bg-zinc-950 text-zinc-400 border-zinc-850 hover:text-white'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Reply Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 font-mono text-xs">

        {/* Left 5 Cols: Incoming Prospect List */}
        <div className="lg:col-span-5 space-y-3">
          <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold px-1 block">
            // INCOMING PROSPECT MESSAGES
          </span>

          <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
            {filteredReplies.map(rep => {
              const isSelected = rep.id === selectedReply.id;
              const badgeClass = categoryBadges[rep.category] || 'bg-zinc-900 text-zinc-400 border-zinc-800';

              return (
                <div
                  key={rep.id}
                  onClick={() => setSelectedReplyId(rep.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                    isSelected
                      ? 'bg-[#061226] border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.15)]'
                      : 'bg-zinc-950 border-zinc-900 hover:border-zinc-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-white text-xs uppercase">{rep.companyName}</span>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase ${badgeClass}`}>
                      {rep.category}
                    </span>
                  </div>

                  <div className="text-[11px] text-cyan-400 font-bold mb-1">
                    {rep.contactName} ({rep.contactRole})
                  </div>

                  <p className="text-xs text-zinc-300 font-sans line-clamp-2 italic">
                    "{rep.preview}"
                  </p>

                  <div className="mt-2 pt-2 border-t border-zinc-900 flex justify-between text-[10px] text-zinc-500">
                    <span>{rep.receivedTime}</span>
                    <span className="text-amber-400 font-bold">SELECT TO REPLY →</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right 7 Cols: Selected Message & AI Response Draft */}
        <div className="lg:col-span-7 space-y-6">
          {selectedReply && (
            <div className="bg-[#030815] border border-amber-500/40 p-6 sm:p-8 rounded-2xl space-y-6 shadow-[0_10px_40px_rgba(0,0,0,0.8)]">
              
              {/* Header */}
              <div className="flex items-center justify-between border-b border-zinc-900 pb-4">
                <div>
                  <h3 className="text-lg font-bold text-white uppercase">{selectedReply.companyName}</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    From: <strong className="text-white">{selectedReply.contactName}</strong> ({selectedReply.contactRole})
                  </p>
                </div>

                <span className={`text-xs font-bold px-3 py-1 rounded border uppercase ${categoryBadges[selectedReply.category]}`}>
                  {selectedReply.category}
                </span>
              </div>

              {/* Message Body */}
              <div className="bg-black/90 border border-zinc-850 p-4 rounded-xl space-y-2">
                <span className="text-[10px] text-zinc-500 uppercase font-bold block">RECEIVED EMAIL CONTENT:</span>
                <p className="text-xs text-zinc-200 font-sans leading-relaxed italic">
                  "{selectedReply.preview}"
                </p>
              </div>

              {/* AI Suggested Response Draft */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>AI SUGGESTED RESPONSE DRAFT (1-CLICK EXECUTION):</span>
                  </span>
                  <span className="text-[10px] text-zinc-500">Auto Generated</span>
                </div>

                <textarea
                  rows={6}
                  value={replyDraft}
                  onChange={e => setReplyDraft(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-850 rounded-xl p-4 text-zinc-200 leading-relaxed font-mono text-xs focus:outline-none focus:border-amber-400 resize-none"
                />
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    const mailtoUrl = `mailto:contact@${selectedReply.companyName.toLowerCase()}.com?subject=Re: ${encodeURIComponent(selectedReply.subject)}&body=${encodeURIComponent(replyDraft)}`;
                    window.location.href = mailtoUrl;
                  }}
                  className="flex-1 py-3.5 bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-black font-mono text-xs font-bold uppercase rounded-xl transition-all shadow-[0_0_20px_rgba(251,191,36,0.3)] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>SEND AI RESPONSE NOW</span>
                </button>
              </div>

            </div>
          )}
        </div>

      </div>

    </div>
  );
};
