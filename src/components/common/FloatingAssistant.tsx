import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Send,
  Loader2,
  Bot,
  User,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { apiClient } from '../../services/api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  isError?: boolean;
}

const CHIPS = [
  'How do I create a post?',
  'Why was my post flagged?',
  'How do I fix a review issue?',
  'How do I connect my social account?'
];

interface FloatingAssistantProps {
  onFocusHelpPage?: () => void;
  isCurrentTabHelp?: boolean;
}

export const FloatingAssistant: React.FC<FloatingAssistantProps> = ({
  onFocusHelpPage,
  isCurrentTabHelp = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'fa-welcome',
      role: 'assistant',
      content: 'Hi! Need quick help with your draft, review issues, or publishing?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Position state (persisted in sessionStorage)
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = sessionStorage.getItem('brandlens_assistant_pos');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return parsed;
        }
      }
    } catch {
      // fallback
    }
    return { x: -1, y: -1 }; // -1 indicates default bottom-right
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number; moved: boolean }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    moved: false
  });

  const buttonRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Default position resolution
  useEffect(() => {
    if (position.x === -1 || position.y === -1) {
      const defaultX = Math.max(16, window.innerWidth - 76);
      const defaultY = Math.max(16, window.innerHeight - 84);
      setPosition({ x: defaultX, y: defaultY });
    }
  }, [position]);

  // Keep within viewport on resize
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        if (prev.x === -1) return prev;
        const maxX = window.innerWidth - 60;
        const maxY = window.innerHeight - 60;
        return {
          x: Math.min(Math.max(16, prev.x), maxX),
          y: Math.min(Math.max(16, prev.y), maxY)
        };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages, isLoading]);

  // Dragging logic
  const handlePointerDown = (e: React.PointerEvent) => {
    // Only drag with primary mouse button or touch
    if (e.button !== 0) return;

    const el = buttonRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: rect.left,
      initialY: rect.top,
      moved: false
    };

    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;

    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;

    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      dragStartRef.current.moved = true;
    }

    if (dragStartRef.current.moved) {
      const newX = dragStartRef.current.initialX + dx;
      const newY = dragStartRef.current.initialY + dy;

      const maxX = window.innerWidth - 56;
      const maxY = window.innerHeight - 56;

      const clampedX = Math.min(Math.max(12, newX), maxX);
      const clampedY = Math.min(Math.max(12, newY), maxY);

      setPosition({ x: clampedX, y: clampedY });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);

    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}

    // If it was barely moved, treat as a tap/click
    if (!dragStartRef.current.moved) {
      handleClickToggle();
    } else {
      // Save position
      try {
        sessionStorage.setItem('brandlens_assistant_pos', JSON.stringify(position));
      } catch {}
    }
  };

  const handleClickToggle = () => {
    if (isCurrentTabHelp && onFocusHelpPage && !isOpen) {
      onFocusHelpPage();
      return;
    }
    setIsOpen((prev) => !prev);
  };

  const handleSendMessage = async (textToSend?: string) => {
    const rawText = (textToSend !== undefined ? textToSend : input).trim();
    if (!rawText || isLoading) return;

    setErrorMessage(null);

    // Check for WhatsApp command /help {message}
    const isExactHelpCommand = /^\/help(\s+.*)?$/i.test(rawText);

    if (isExactHelpCommand) {
      const afterHelp = rawText.replace(/^\/help\s*/i, '').trim();

      if (!afterHelp) {
        setErrorMessage('Please add a message after /help');
        return;
      }

      try {
        const supportConfig = await apiClient.fetchSupportConfig();
        if (!supportConfig.whatsappConfigured || !supportConfig.whatsappSupportNumber) {
          setErrorMessage('WhatsApp support has not been configured yet.');
          return;
        }

        const cleanNumber = supportConfig.whatsappSupportNumber.replace(/\D/g, '');
        const waUrl = `https://wa.me/${cleanNumber}?text=${encodeURIComponent(afterHelp)}`;

        const userMsg: ChatMessage = {
          id: `fa-msg-${Date.now()}-user`,
          role: 'user',
          content: rawText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        const sysMsg: ChatMessage = {
          id: `fa-msg-${Date.now()}-sys`,
          role: 'system',
          content: `Opening WhatsApp for: "${afterHelp}"`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setMessages((prev) => [...prev, userMsg, sysMsg]);
        setInput('');
        window.open(waUrl, '_blank', 'noopener,noreferrer');
        return;
      } catch {
        setErrorMessage('Failed to resolve support routing.');
        return;
      }
    }

    // Normal AI Question Flow
    const userMsg: ChatMessage = {
      id: `fa-msg-${Date.now()}-user`,
      role: 'user',
      content: rawText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const history = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const res = await apiClient.askHelpQuestion({
        message: rawText,
        history
      });

      if (res.success && res.answer) {
        const assistantMsg: ChatMessage = {
          id: `fa-msg-${Date.now()}-assistant`,
          role: 'assistant',
          content: res.answer,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        throw new Error(res.error || 'Failed to get answer.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Help service unavailable.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const currentX = position.x === -1 ? window.innerWidth - 76 : position.x;
  const currentY = position.y === -1 ? window.innerHeight - 84 : position.y;

  // Compute flyout panel position so it stays inside screen
  const panelWidth = Math.min(360, window.innerWidth - 24);
  const panelHeight = 460;
  const panelLeft = Math.min(Math.max(12, currentX - panelWidth + 48), window.innerWidth - panelWidth - 12);
  const panelTop = Math.max(12, Math.min(currentY - panelHeight - 12, window.innerHeight - panelHeight - 12));

  return (
    <>
      {/* Floating Flyout Chat Panel */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            left: `${panelLeft}px`,
            top: `${panelTop}px`,
            width: `${panelWidth}px`,
            height: `${panelHeight}px`,
            zIndex: 60
          }}
          className="rounded-xl border border-white/15 bg-[#0b0c14]/98 shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_30px_rgba(166,139,255,0.15)] backdrop-blur-2xl flex flex-col overflow-hidden page-enter"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-[rgba(166,139,255,0.2)] border border-[rgba(166,139,255,0.4)] flex items-center justify-center text-[#c9beff]">
                <Bot size={12} />
              </div>
              <div>
                <h4 className="text-xs font-mono font-medium text-white leading-tight">
                  BrandLens AI Assistant
                </h4>
                <p className="text-[10px] text-[#828392] leading-none">Quick workspace answers</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-[#92939f] hover:text-white p-1 rounded transition-colors cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>

          {/* Quick Example Chips */}
          <div className="px-3 py-1.5 border-b border-white/5 bg-white/[0.01] overflow-x-auto no-scrollbar flex items-center gap-1.5 whitespace-nowrap text-[10px] font-mono">
            {CHIPS.map((chip, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendMessage(chip)}
                disabled={isLoading}
                className="px-2 py-0.5 rounded bg-white/[0.03] hover:bg-white/[0.08] text-[#a0a0b2] hover:text-white border border-white/10 transition-colors shrink-0 cursor-pointer"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              const isSystem = msg.role === 'system';

              if (isSystem) {
                return (
                  <div
                    key={msg.id}
                    className="p-2 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[11px] font-mono flex items-center gap-1.5"
                  >
                    <CheckCircle2 size={12} className="shrink-0" />
                    <span>{msg.content}</span>
                  </div>
                );
              }

              return (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <div
                    className={`w-5 h-5 rounded flex items-center justify-center shrink-0 text-[10px] ${
                      isUser
                        ? 'bg-[rgba(156,236,255,0.15)] text-[#9cecff] border border-[rgba(156,236,255,0.3)]'
                        : 'bg-[rgba(166,139,255,0.15)] text-[#c9beff] border border-[rgba(166,139,255,0.3)]'
                    }`}
                  >
                    {isUser ? <User size={10} /> : <Bot size={10} />}
                  </div>

                  <div
                    className={`max-w-[85%] rounded-lg p-2.5 text-xs leading-relaxed ${
                      isUser
                        ? 'bg-[rgba(166,139,255,0.2)] border border-[rgba(166,139,255,0.4)] text-white'
                        : msg.isError
                        ? 'bg-rose-500/10 border border-rose-500/25 text-rose-200'
                        : 'bg-white/[0.03] border border-white/10 text-[#d0d0df]'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                </div>
              );
            })}

            {isLoading && (
              <div className="flex items-center gap-2 text-[11px] font-mono text-[#8a8a9a] p-2">
                <Loader2 size={12} className="animate-spin text-[#a68bff]" />
                <span>Generating answer...</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="mx-3 mb-1 p-2 bg-rose-500/10 border border-rose-500/25 rounded text-rose-300 text-[11px] font-mono flex items-center gap-1.5">
              <AlertCircle size={12} className="shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Footer Input */}
          <div className="p-2.5 border-t border-white/10 bg-black/40">
            <div className="flex items-end gap-1.5">
              <textarea
                ref={textareaRef}
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask assistant or type /help..."
                disabled={isLoading}
                className="flex-1 bg-white/[0.04] border border-white/10 focus:border-[rgba(166,139,255,0.6)] text-white text-xs rounded-md p-2 outline-none font-mono placeholder:text-[#6a6a7a] resize-none"
              />
              <button
                type="button"
                onClick={() => handleSendMessage()}
                disabled={!input.trim() || isLoading}
                className="p-2.5 rounded-md bg-[rgba(166,139,255,0.3)] hover:bg-[rgba(166,139,255,0.5)] border border-[rgba(166,139,255,0.6)] text-white disabled:opacity-40 transition-colors cursor-pointer h-[46px] flex items-center justify-center"
              >
                {isLoading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Movable Button */}
      <div
        ref={buttonRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          position: 'fixed',
          left: `${currentX}px`,
          top: `${currentY}px`,
          zIndex: 55,
          touchAction: 'none'
        }}
        className={`w-12 h-12 rounded-full flex items-center justify-center select-none transition-transform active:scale-95 ${
          isDragging ? 'cursor-grabbing scale-105' : 'cursor-grab hover:scale-105'
        }`}
        title="BrandLens AI Assistant (Click to open, drag to move)"
      >
        {/* Animated Breathing Halo */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-[rgba(166,139,255,0.4)] to-[rgba(156,236,255,0.3)] filter blur-md animate-pulse" />

        {/* Outer Lens Ring */}
        <div className="absolute inset-0 rounded-full border border-[rgba(195,183,255,0.6)] shadow-[0_0_20px_rgba(166,139,255,0.35),inset_0_0_12px_rgba(156,236,255,0.2)] bg-[#0c0d16]/90 backdrop-blur-xl" />

        {/* Inner Lens Caustic Refraction */}
        <div className="relative z-10 w-6 h-6 rounded-full border border-[rgba(156,236,255,0.85)] flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-white shadow-[0_0_8px_#ffffff]" />
        </div>

        {/* Active Processing Indicator */}
        {isLoading && (
          <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[#9cecff] shadow-[0_0_8px_#9cecff] animate-ping" />
        )}
      </div>
    </>
  );
};
