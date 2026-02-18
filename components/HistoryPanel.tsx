
import React from 'react';
import { TranscriptionItem } from '../types';

interface HistoryPanelProps {
  history: TranscriptionItem[];
}

const HistoryPanel: React.FC<HistoryPanelProps> = ({ history }) => {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white/50 rounded-xl border border-green-100 shadow-inner max-h-[400px]">
      {history.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-2">
          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <p>No conversation yet. Tap "Start Session" and speak.</p>
        </div>
      ) : (
        history.map((item) => (
          <div
            key={item.id}
            className={`flex flex-col ${item.type === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[85%] px-4 py-3 rounded-2xl shadow-sm ${
                item.type === 'user'
                  ? 'bg-green-600 text-white rounded-br-none'
                  : 'bg-white text-gray-800 border border-green-200 rounded-bl-none'
              }`}
            >
              <p className="text-sm md:text-base leading-relaxed">{item.text}</p>
              <span className={`text-[10px] mt-1 block opacity-70 ${item.type === 'user' ? 'text-right' : 'text-left'}`}>
                {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default HistoryPanel;
