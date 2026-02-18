
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import { ConnectionStatus, TranscriptionItem } from './types';
import { encode, decode, decodeAudioData } from './services/audioUtils';
import HistoryPanel from './components/HistoryPanel';

const API_KEY = process.env.API_KEY || '';

const SYSTEM_INSTRUCTION = `You are an expert agronomist. 
Your primary mission is to provide agricultural advice in Marathi, Hindi, or Kannada. 
Use straightforward, non-technical language that is easily understandable for farmers. 
Respond to queries about crop management, soil health, pests, weather impacts, and market prices.
Maintain a helpful, encouraging, and professional tone.
Automatically detect the language of the farmer and respond in that same language.`;

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [history, setHistory] = useState<TranscriptionItem[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const sessionRef = useRef<any>(null);
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  // Handle errors
  const handleError = useCallback((error: any) => {
    console.error('Gemini Live API Error:', error);
    setStatus(ConnectionStatus.ERROR);
    stopSession();
  }, []);

  const createPCMUnit8Blob = (data: Float32Array): Blob => {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      int16[i] = data[i] * 32768;
    }
    return {
      data: encode(new Uint8Array(int16.buffer)),
      mimeType: 'audio/pcm;rate=16000',
    };
  };

  const startSession = async () => {
    try {
      setStatus(ConnectionStatus.CONNECTING);
      
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      
      // Initialize Audio Contexts
      audioContextInRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextOutRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setStatus(ConnectionStatus.CONNECTED);
            
            // Start streaming microphone data
            const source = audioContextInRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextInRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPCMUnit8Blob(inputData);
              
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });

              // Simple visualization indicator
              const volume = inputData.reduce((a, b) => a + Math.abs(b), 0) / inputData.length;
              setIsListening(volume > 0.01);
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextInRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Audio Data Handling
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && audioContextOutRef.current) {
              setIsSpeaking(true);
              const ctx = audioContextOutRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              
              source.onended = () => {
                activeSourcesRef.current.delete(source);
                if (activeSourcesRef.current.size === 0) setIsSpeaking(false);
              };
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              activeSourcesRef.current.add(source);
            }

            // Interrupt Handling
            if (message.serverContent?.interrupted) {
              activeSourcesRef.current.forEach(s => s.stop());
              activeSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }

            // Transcription Handling
            if (message.serverContent?.inputTranscription) {
              currentInputTranscription.current += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscription.current += message.serverContent.outputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
              const userText = currentInputTranscription.current.trim();
              const modelText = currentOutputTranscription.current.trim();
              
              if (userText) {
                setHistory(prev => [
                  ...prev,
                  { id: crypto.randomUUID(), type: 'user', text: userText, timestamp: new Date() }
                ]);
              }
              if (modelText) {
                setHistory(prev => [
                  ...prev,
                  { id: crypto.randomUUID(), type: 'model', text: modelText, timestamp: new Date() }
                ]);
              }
              
              currentInputTranscription.current = '';
              currentOutputTranscription.current = '';
            }
          },
          onerror: (e) => handleError(e),
          onclose: () => setStatus(ConnectionStatus.DISCONNECTED),
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      handleError(err);
    }
  };

  const stopSession = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (audioContextInRef.current) {
      audioContextInRef.current.close();
      audioContextInRef.current = null;
    }
    if (audioContextOutRef.current) {
      audioContextOutRef.current.close();
      audioContextOutRef.current = null;
    }
    activeSourcesRef.current.forEach(s => s.stop());
    activeSourcesRef.current.clear();
    setStatus(ConnectionStatus.DISCONNECTED);
    setIsSpeaking(false);
    setIsListening(false);
  };

  return (
    <div className="min-h-screen bg-green-50 flex flex-col items-center p-4 md:p-8">
      {/* Branding */}
      <header className="w-full max-w-4xl flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="bg-green-600 p-2 rounded-lg shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-green-900">Agri-Expert Regional Advisor</h1>
        </div>
        <div className="hidden md:block text-green-700 font-medium">
          Expert advice in Marathi, Hindi & Kannada
        </div>
      </header>

      <main className="w-full max-w-4xl bg-white rounded-3xl shadow-xl overflow-hidden flex flex-col border border-green-100">
        {/* Status Bar */}
        <div className="bg-green-600 px-6 py-3 flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${status === ConnectionStatus.CONNECTED ? 'bg-green-300 animate-pulse' : 'bg-red-300'}`} />
            <span className="text-sm font-semibold uppercase tracking-wider">{status}</span>
          </div>
          {status === ConnectionStatus.CONNECTED && (
            <div className="flex gap-4">
              <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/20 transition-opacity ${isListening ? 'opacity-100' : 'opacity-40'}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                LISTENING
              </div>
              <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/20 transition-opacity ${isSpeaking ? 'opacity-100' : 'opacity-40'}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-green-300" />
                SPEAKING
              </div>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 p-6 flex flex-col">
          <HistoryPanel history={history} />
          
          {/* Action Center */}
          <div className="mt-8 flex flex-col items-center gap-6">
            <div className="relative">
              {/* Pulse effect for microphone */}
              {status === ConnectionStatus.CONNECTED && (
                <div className={`absolute inset-0 rounded-full bg-green-500 transition-transform duration-300 ${isListening ? 'scale-150 opacity-20' : 'scale-0'}`} />
              )}
              
              <button
                onClick={status === ConnectionStatus.CONNECTED ? stopSession : startSession}
                className={`relative z-10 w-24 h-24 md:w-32 md:h-32 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 transform active:scale-95 ${
                  status === ConnectionStatus.CONNECTED 
                  ? 'bg-red-500 hover:bg-red-600 ring-8 ring-red-100' 
                  : 'bg-green-600 hover:bg-green-700 ring-8 ring-green-100'
                }`}
              >
                {status === ConnectionStatus.CONNECTED ? (
                  <svg className="w-10 h-10 md:w-14 md:h-14 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H10a1 1 0 01-1-1v-4z" />
                  </svg>
                ) : (
                  <svg className="w-10 h-10 md:w-14 md:h-14 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
              </button>
            </div>

            <div className="text-center">
              <p className="text-gray-600 font-medium md:text-lg">
                {status === ConnectionStatus.CONNECTED 
                  ? "Speak freely! I'm listening to your agricultural questions." 
                  : "Tap to connect with your expert farming advisor."}
              </p>
              <p className="text-xs text-gray-400 mt-2">
                Marathi • Hindi • Kannada
              </p>
            </div>
          </div>
        </div>

        {/* Info Footer */}
        <div className="bg-gray-50 p-6 border-t border-green-100">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Sample Questions</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              "या हंगामात कोणते पीक घ्यावे? (Marathi)",
              "मिट्टी की उर्वरता कैसे सुधारें? (Hindi)",
              "ಈ ವರ್ಷ ಭತ್ತಕ್ಕೆ ಬೆಲೆ ಹೇಗಿರುತ್ತದೆ? (Kannada)",
              "कपाशीवरील रोगाचे नियंत्रण कसे करावे? (Marathi)"
            ].map((q, i) => (
              <div key={i} className="bg-white p-3 rounded-lg border border-green-200 text-sm text-green-800 shadow-sm cursor-pointer hover:bg-green-50 transition-colors">
                "{q}"
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="mt-8 text-green-700/60 text-sm font-medium">
        Powered by Gemini 2.5 Live Native Audio • Voice-to-Expert Agri AI
      </footer>
    </div>
  );
};

export default App;
