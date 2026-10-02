import React from 'react';
import { Bell, Flame, Zap, CheckCircle2, TrendingUp, DollarSign, UserCheck, MessageSquare } from 'lucide-react';
import { V2Notification } from '../../data/v2DataEngine';

interface RealtimeNotificationsBarProps {
  notifications: V2Notification[];
}

export const RealtimeNotificationsBar: React.FC<RealtimeNotificationsBarProps> = ({ notifications }) => {
  return (
    <div className="bg-zinc-950 border border-zinc-850 px-4 py-2.5 rounded-xl flex items-center gap-4 overflow-hidden font-mono text-xs shadow-md">
      <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase shrink-0">
        <Bell className="w-4 h-4 text-cyan-400 animate-bounce" />
        <span>LIVE SIGNAL TICKER:</span>
      </div>

      <div className="flex items-center gap-6 overflow-x-auto whitespace-nowrap text-[11px] text-zinc-300 font-sans">
        {notifications.map(n => (
          <div key={n.id} className="flex items-center gap-2 shrink-0 bg-black/60 border border-zinc-900 px-3 py-1 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="font-bold text-white uppercase">{n.companyName}:</span>
            <span className="text-zinc-300">{n.message}</span>
            <span className="text-[9px] text-zinc-500 font-mono">({n.timestamp})</span>
          </div>
        ))}
      </div>
    </div>
  );
};
