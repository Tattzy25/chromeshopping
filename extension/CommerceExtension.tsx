/**
 * extension/CommerceExtension.tsx - Main Injected HUD Container
 *
 * Combines:
 *  1. LiveCommerce display shelf (dumb mailman)
 *  2. RealtimeVoiceBar (touchless hands-free audio wave with gpt-realtime-2.1)
 *  3. BYOK (OpenAI API key) management in chrome.storage.local
 */
import React, { useEffect, useRef, useState } from 'react';
import LiveCommerce from '../LiveCommerce';
import RealtimeVoiceBar, { type RealtimeVoiceBarHandle } from '../RealtimeVoiceBar';
import type { CommerceIntent, LiveCommerceHandle, Raw } from '../types';
import { Settings, X, Key } from 'lucide-react';

declare const __DEFAULT_OPENAI_KEY__: string | undefined;

const DEFAULT_MCP_URL = 'https://master-group-mcp.anigok.com/mcp';

export const CommerceExtension: React.FC = () => {
  const liveCommerceRef = useRef<LiveCommerceHandle>(null);
  const voiceBarRef = useRef<RealtimeVoiceBarHandle>(null);
  const [apiKey, setApiKey] = useState<string>(typeof __DEFAULT_OPENAI_KEY__ !== 'undefined' ? __DEFAULT_OPENAI_KEY__ : '');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [tempKey, setTempKey] = useState<string>('');

  // Load Settings and Copilot State from chrome.storage.local on mount
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['OPENAI_API_KEY', 'COPILOT_ENABLED'], (result) => {
        if (result.OPENAI_API_KEY) {
          setApiKey(result.OPENAI_API_KEY);
          setTempKey(result.OPENAI_API_KEY);
        } else if (typeof __DEFAULT_OPENAI_KEY__ !== 'undefined' && __DEFAULT_OPENAI_KEY__) {
          setApiKey(__DEFAULT_OPENAI_KEY__);
        }

        if (typeof result.COPILOT_ENABLED === 'boolean') {
          setIsOpen(result.COPILOT_ENABLED);
        }
      });

      // Listen for instant updates when saved from extension popup
      const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'local') {
          if (changes.OPENAI_API_KEY) {
            const newKey = changes.OPENAI_API_KEY.newValue || '';
            setApiKey(newKey);
            setTempKey(newKey);
          }
          if (changes.COPILOT_ENABLED !== undefined) {
            setIsOpen(changes.COPILOT_ENABLED.newValue ?? true);
          }
        }
      };

      chrome.storage.onChanged.addListener(listener);
      return () => {
        chrome.storage.onChanged.removeListener(listener);
      };
    }
  }, []);

  const saveApiKey = () => {
    const trimmedKey = tempKey.trim();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        OPENAI_API_KEY: trimmedKey,
        MCP_SERVER_URL: DEFAULT_MCP_URL,
      }, () => {
        setApiKey(trimmedKey);
        setShowSettings(false);
      });
    } else {
      setApiKey(trimmedKey);
      setShowSettings(false);
    }
  };

  // Handle intents from LiveCommerce UI (clicks on product cards or checkout)
  const handleCommerceIntent = (intent: CommerceIntent) => {
    if (intent.type === 'select_product' && intent.raw?.url) {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: intent.raw.url });
      } else {
        window.location.href = intent.raw.url;
      }
      return;
    }

    if (intent.type === 'checkout') {
      const continueUrl = intent.cartRaw?.continue_url 
        || intent.cartRaw?.checkout_url 
        || intent.cartRaw?.web_url
        || (intent.cartRaw?.order ? intent.cartRaw.order.checkout_url : null);
      if (continueUrl) {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: continueUrl });
        } else {
          window.location.href = continueUrl;
        }
      } else {
        const fallback = `${window.location.origin}/checkout`;
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: fallback });
        } else {
          window.location.href = fallback;
        }
      }
      return;
    }
  };

  // Ingest raw data into LiveCommerce
  const handlePayloadReceived = (payload: Raw) => {
    if (liveCommerceRef.current) {
      liveCommerceRef.current.ingest(payload);
    }
  };

  const handleNavigate = (url: string) => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url });
    } else {
      window.location.href = url;
    }
  };

  const handleTurnOff = () => {
    voiceBarRef.current?.stopSession();
    liveCommerceRef.current?.reset();
    setIsOpen(false);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ COPILOT_ENABLED: false });
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-8 z-[2147483647] flex flex-col items-center pointer-events-none font-sans select-none">
      {/* 1. LiveCommerce Display Shelf (Floats above voice bar) */}
      <div className="relative w-full">
        <LiveCommerce
          ref={liveCommerceRef}
          onIntent={handleCommerceIntent}
          sessionActive={true}
        />
      </div>

      {/* 2. Bottom Control Strip: Voice Bar + Settings Gear + Close / Turn Off Button */}
      <div className="pointer-events-auto flex items-center gap-2">
        <RealtimeVoiceBar
          ref={voiceBarRef}
          apiKey={apiKey}
          mcpServerUrl={DEFAULT_MCP_URL}
          onPayloadReceived={handlePayloadReceived}
          onNavigate={handleNavigate}
        />

        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className="grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/85 text-white/80 shadow-2xl backdrop-blur-xl transition-colors hover:bg-white/20 hover:text-white"
          title="BYOK Settings"
        >
          <Settings size={16} />
        </button>

        <button
          type="button"
          onClick={handleTurnOff}
          className="grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/85 text-white/70 shadow-2xl backdrop-blur-xl transition-colors hover:bg-white/20 hover:text-white"
          title="Close Copilot"
        >
          <X size={16} />
        </button>
      </div>

      {/* 3. Settings Modal for BYOK */}
      {showSettings && (
        <div className="pointer-events-auto fixed inset-0 grid place-items-center bg-black/60 p-4 backdrop-blur-sm z-[2147483648]">
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-3xl border border-white/20 bg-zinc-950 p-5 text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key size={18} className="text-amber-400" />
                <h3 className="text-sm font-extrabold uppercase tracking-wider">BYOK Settings</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="grid h-7 w-7 place-items-center rounded-full bg-white/10 hover:bg-white/20"
              >
                <X size={14} />
              </button>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              Default managed key is active. Optional: Enter your own OpenAI key (sk-... or ek-...) for BYOK mode.
            </p>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-zinc-300">OpenAI API Key</label>
              <input
                type="password"
                value={tempKey}
                onChange={(e) => setTempKey(e.target.value)}
                placeholder="sk-... or ek-..."
                className="rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-white focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="rounded-full px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveApiKey}
                className="rounded-full bg-white px-5 py-2 text-xs font-extrabold text-black hover:bg-zinc-200 active:scale-95"
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommerceExtension;
