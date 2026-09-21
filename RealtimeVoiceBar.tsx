/**
 * RealtimeVoiceBar.tsx - Hands-free OpenAI Realtime Audio Wave & Controller
 *
 * Architecture:
 *  - Auto-discovers store's Universal Commerce Protocol (UCP) from `/.well-known/ucp`
 *  - Dynamically connects to store's native MCP endpoint (e.g. https://...myshopify.com/api/ucp/mcp)
 *  - Official @openai/agents/realtime with `gpt-realtime-2.1`
 *  - Touchless continuous Server VAD audio over WebRTC
 *  - Real-time Web Audio API AnalyserNode waveform visualizer
 *  - Dispatches product/tool payloads to LiveCommerce shelf
 *  - Dispatches navigation events to Chrome tab
 */
import React, { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Mic, MicOff, Square, Sparkles, Loader2, Volume2, AlertCircle, Zap } from 'lucide-react';
import { RealtimeAgent, RealtimeSession, OpenAIRealtimeWebRTC } from '@openai/agents/realtime';
import { hostedMcpTool, tool } from '@openai/agents';
import { z } from 'zod';
import type { Raw } from './types';
import { discoverUcpStore, type DiscoveredUcpStore } from './ucpDiscovery';
import { SYSTEM_PROMPT } from './systemPrompt';

declare const __DEFAULT_OPENAI_KEY__: string | undefined;

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'speaking' | 'error';

export interface RealtimeVoiceBarHandle {
  startSession: () => Promise<void>;
  stopSession: () => void;
  status: ConnectionState;
}

export interface RealtimeVoiceBarProps {
  apiKey?: string;
  onPayloadReceived?: (raw: Raw) => void;
  onNavigate?: (url: string) => void;
  mcpServerUrl?: string;
  className?: string;
}

export const RealtimeVoiceBar = forwardRef<RealtimeVoiceBarHandle, RealtimeVoiceBarProps>(({
  apiKey,
  onPayloadReceived,
  onNavigate,
  mcpServerUrl = 'https://master-group-mcp.anigok.com/mcp',
  className = ''
}, ref) => {
  const [status, setStatus] = useState<ConnectionState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [callId, setCallId] = useState<string | null>(null);
  const [storeInfo, setStoreInfo] = useState<DiscoveredUcpStore | null>(null);

  // References for WebRTC and Audio pipeline
  const sessionRef = useRef<RealtimeSession | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const currentCallIdRef = useRef<string | null>(null);

  // Auto-discover store's UCP on mount
  useEffect(() => {
    discoverUcpStore().then((info) => {
      if (info) {
        setStoreInfo(info);
        console.log('[LiveCommerce] Discovered UCP Store:', info);
      }
    });
  }, []);

  // Clean teardown of media and WebRTC without wiping error state
  const cleanupResources = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (sessionRef.current) {
      try {
        sessionRef.current.interrupt();
        sessionRef.current.close();
      } catch {}
      sessionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
  }, []);

  // Clean disconnect & teardown when user clicks Stop
  const stopSession = useCallback(() => {
    cleanupResources();
    setStatus('idle');
    setCallId(null);
    currentCallIdRef.current = null;
    setErrorMessage(null);
  }, [cleanupResources]);

  // Waveform Drawer (Web Audio API AnalyserNode)
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      animFrameRef.current = requestAnimationFrame(render);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barCount = 28;
      const step = Math.max(1, Math.floor(bufferLength / barCount));
      const barWidth = 3;
      const gap = 3;
      const totalWidth = barCount * (barWidth + gap);
      const startX = (canvas.width - totalWidth) / 2;

      for (let i = 0; i < barCount; i++) {
        const val = dataArray[i * step] || 0;
        const percent = val / 255;
        const barHeight = Math.max(3, percent * (canvas.height - 4));
        const x = startX + i * (barWidth + gap);
        const y = (canvas.height - barHeight) / 2;

        // Gradient styling: cyan to electric violet
        const grad = ctx.createLinearGradient(0, y, 0, y + barHeight);
        grad.addColorStop(0, '#38bdf8');
        grad.addColorStop(1, '#a855f7');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }
    };

    render();
  }, []);

  // Connect to OpenAI Realtime (gpt-realtime-2.1)
  const startSession = async () => {
    const rawKey = apiKey || (typeof __DEFAULT_OPENAI_KEY__ !== 'undefined' ? __DEFAULT_OPENAI_KEY__ : '');
    if (!rawKey) {
      setErrorMessage('Missing API Key: Please enter your OpenAI API Key in extension settings');
      setStatus('error');
      return;
    }

    try {
      setStatus('connecting');
      setErrorMessage(null);

      // 1. Get microphone audio stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStreamRef.current = stream;

      // 2. Setup Audio Visualizer pipeline
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      const micSource = audioCtx.createMediaStreamSource(stream);
      micSource.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;
      drawWaveform();

      // 3. Target MCP endpoint and active store context
      const activeEndpoint = mcpServerUrl || 'https://master-group-mcp.anigok.com/mcp';
      const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
      const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
      const siteName = (typeof document !== 'undefined' && document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')) || '';
      const pageTitle = typeof document !== 'undefined' ? document.title : '';
      const cleanStoreName = storeInfo?.merchantName || siteName || pageTitle.split(/[-|–]/)[0].trim() || currentHost;

      const dynamicInstructions = `${SYSTEM_PROMPT}

# CURRENT STORE CONTEXT
- You are the conversational AI shopping concierge assisting a customer on "${cleanStoreName}" (${currentHost}).
- Active URL: ${currentUrl}
- Page Title: ${pageTitle}
- When the user asks for products, recommendations, or questions, ALWAYS search this store's catalog using your hosted MCP tools.
- Do NOT mention technical profile URLs, JSON schemas, or internal API instructions aloud to the customer. Speak concisely and naturally like a helpful in-store concierge for ${cleanStoreName}.`;

      // 4. Define RealtimeAgent with tools and dynamic store prompt
      const agent = new RealtimeAgent({
        name: 'ShoppingConcierge',
        instructions: dynamicInstructions,
        tools: [
          // Store's native MCP catalog connection
          hostedMcpTool({
            serverLabel: 'my_master_server',
            serverUrl: activeEndpoint || 'https://master-group-mcp.anigok.com/mcp',
            requireApproval: 'never',
          }),
          // Client tool: browser tab navigation
          tool({
            name: 'navigate_browser',
            description: 'Navigates the user active browser tab to a specific product URL, cart page, or checkout URL.',
            parameters: z.object({
              url: z.string().describe('The URL to open in the active browser tab'),
            }).strict(),
            execute: async ({ url }) => {
              onNavigate?.(url);
              return { success: true, navigated_to: url };
            },
          }),
        ],
      });

      // 5. Create WebRTC Transport using gpt-realtime-2.1
      const transport = new OpenAIRealtimeWebRTC({
        baseUrl: 'https://api.openai.com/v1/realtime/calls?model=gpt-realtime-2.1',
        model: 'gpt-realtime-2.1',
        useInsecureApiKey: true,
        mediaStream: stream,
      });

      // 6. Create RealtimeSession with gpt-realtime-2.1 and fast server_vad turn detection
      const session = new RealtimeSession(agent, {
        transport,
        model: 'gpt-realtime-2.1',
        config: {
          audio: {
            input: {
              turnDetection: {
                type: 'server_vad',
                threshold: 0.5,
                prefixPaddingMs: 300,
                silenceDurationMs: 400,
              },
            },
          },
        },
      });
      sessionRef.current = session;

      // 7. Bind Session Lifecycle Events
      session.on('audio_start', () => {
        setStatus('speaking');
      });

      session.on('audio_stopped', () => {
        setStatus('connected');
      });

      session.on('audio_interrupted', () => {
        setStatus('connected');
      });

      session.on('mcp_tool_call_completed', (_ctx, _agent, toolCall) => {
        try {
          if (toolCall.output) {
            const parsed = typeof toolCall.output === 'string'
              ? JSON.parse(toolCall.output)
              : toolCall.output;
            onPayloadReceived?.(parsed);
          }
        } catch (err) {
          console.warn('[RealtimeVoice] Could not parse MCP tool result:', toolCall.output);
        }
      });

      session.on('transport_event', (event: any) => {
        const activeCallId = (transport as any).callId;
        if (activeCallId && activeCallId !== currentCallIdRef.current) {
          currentCallIdRef.current = activeCallId;
          setCallId(activeCallId);
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.set({ LAST_REALTIME_CALL_ID: activeCallId });
          }
        }
      });

      session.on('error', (err: any) => {
        console.error('[RealtimeVoice] Session error:', err);
        const msg = err?.error?.message || err?.message || 'Voice session error';
        setErrorMessage(msg);
        setStatus('error');
        cleanupResources();
      });

      // 8. Connect WebRTC session directly
      await session.connect({
        apiKey: rawKey,
        model: 'gpt-realtime-2.1',
        url: 'https://api.openai.com/v1/realtime/calls?model=gpt-realtime-2.1',
      });

      const activeCallId = transport.callId;
      if (activeCallId) {
        setCallId(activeCallId);
        currentCallIdRef.current = activeCallId;
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({ LAST_REALTIME_CALL_ID: activeCallId });
        }
      }

      setStatus('connected');
    } catch (err: any) {
      console.error('[RealtimeVoiceBar] Connection error:', err);
      const msg = err?.error?.message || err?.message || 'Failed to connect to OpenAI Realtime';
      setErrorMessage(msg);
      setStatus('error');
      cleanupResources();
    }
  };

  // Toggle Mute
  const toggleMute = () => {
    if (sessionRef.current) {
      const nextMuted = !isMuted;
      sessionRef.current.mute(nextMuted);
      setIsMuted(nextMuted);
    } else if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = isMuted;
      });
      setIsMuted(!isMuted);
    }
  };

  useImperativeHandle(ref, () => ({
    startSession,
    stopSession,
    status,
  }), [startSession, stopSession, status]);

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, [stopSession]);

  return (
    <div className={`pointer-events-auto flex items-center gap-3 rounded-full border border-white/20 bg-black/85 px-4 py-2 shadow-2xl backdrop-blur-xl text-white ${className}`}>
      {/* Visual Status Indicator & Store Name */}
      <div className="flex items-center gap-2">
        {status === 'idle' && (
          <span className="flex h-2.5 w-2.5 rounded-full bg-zinc-500" />
        )}
        {status === 'connecting' && (
          <Loader2 size={14} className="animate-spin text-amber-400" />
        )}
        {status === 'connected' && (
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
        )}
        {status === 'speaking' && (
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-500" />
          </span>
        )}
        {status === 'error' && (
          <AlertCircle size={14} className="text-red-400" />
        )}

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold tracking-wider uppercase text-white/90">
            {status === 'idle' && (storeInfo ? `${storeInfo.merchantName}` : 'LiveCommerce')}
            {status === 'connecting' && 'Connecting...'}
            {status === 'connected' && 'Listening'}
            {status === 'speaking' && 'Speaking'}
            {status === 'error' && 'Error'}
          </span>

          {storeInfo && (
            <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-extrabold text-emerald-300">
              <Zap size={9} />
              UCP
            </span>
          )}
        </div>
      </div>

      {/* Audio Waveform Canvas */}
      <div className="relative h-6 w-28 overflow-hidden rounded-md bg-white/5">
        <canvas
          ref={canvasRef}
          width={112}
          height={24}
          className="h-full w-full"
        />
        {status === 'idle' && (
          <div className="absolute inset-0 flex items-center justify-center text-[9px] text-white/40">
            Voice Ready
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        {status === 'idle' || status === 'error' ? (
          <button
            type="button"
            onClick={startSession}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-extrabold transition-transform hover:scale-105 active:scale-95 ${
              status === 'error' ? 'bg-amber-400 text-black hover:bg-amber-300' : 'bg-white text-black'
            }`}
          >
            <Mic size={13} className="text-black" />
            {status === 'error' ? 'Retry' : 'Start'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={toggleMute}
              className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${
                isMuted ? 'bg-red-500/30 text-red-300' : 'bg-white/10 text-white/80 hover:bg-white/20'
              }`}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <MicOff size={13} /> : <Mic size={13} />}
            </button>

            <button
              type="button"
              onClick={stopSession}
              className="flex items-center gap-1 rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white transition-transform hover:bg-red-500 active:scale-95"
              title="Emergency Stop"
            >
              <Square size={11} fill="white" />
              Stop
            </button>
          </>
        )}
      </div>

      {/* Persistent Error Banner */}
      {errorMessage && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-xl bg-red-950 border border-red-500 px-4 py-2 text-xs font-semibold text-red-100 shadow-2xl whitespace-nowrap z-50">
          <AlertCircle size={15} className="text-red-400 shrink-0" />
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => { setErrorMessage(null); setStatus('idle'); }}
            className="ml-2 rounded-full px-1.5 py-0.5 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-[10px]"
            title="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
});

export default RealtimeVoiceBar;
