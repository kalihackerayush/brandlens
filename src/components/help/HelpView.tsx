import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Loader2,
  RotateCcw,
  Bot,
  User,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { apiClient } from '../../services/api';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  isError?: boolean;
}

const SUGGESTED_QUESTIONS = [
  'How do I create a post?',
  'Why was my post flagged?',
  'How do I fix a review issue?',
  'How do I connect my social account?'
];

export const HelpView: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'assistant',
      content:
        'Hello! I can answer questions about creating posts, understanding review findings, applying corrections, and publishing. What would you like to know?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string>('');
  const [supportConfig, setSupportConfig] = useState<{
    whatsappConfigured: boolean;
    whatsappSupportNumber: string;
  }>({ whatsappConfigured: false, whatsappSupportNumber: '' });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    apiClient.fetchSupportConfig().then(setSupportConfig).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSendMessage = async (textToSend?: string) => {
    const rawText = (textToSend !== undefined ? textToSend : input).trim();
    if (!rawText || isLoading) return;

    setErrorMessage(null);
    setLastQuestion(rawText);

    // Check for WhatsApp command /help {message}
    // Only detect when /help is the first token
    const isExactHelpCommand = /^\/help(\s+.*)?$/i.test(rawText);

    if (isExactHelpCommand) {
      const afterHelp = rawText.replace(/^\/help\s*/i, '').trim();

      if (!afterHelp) {
        setErrorMessage('Please add a short message after /help (e.g. /help sir i need help).');
        return;
      }

      if (!supportConfig.whatsappConfigured || !supportConfig.whatsappSupportNumber) {
        setErrorMessage(
          'WhatsApp support has not been configured yet.'
        );
        return;
      }

      const cleanNumber = supportConfig.whatsappSupportNumber.replace(/\D/g, '');
      const encodedMsg = encodeURIComponent(afterHelp);
      const waUrl = `https://wa.me/${cleanNumber}?text=${encodedMsg}`;

      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}-user`,
        role: 'user',
        content: rawText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      const systemMsg: ChatMessage = {
        id: `msg-${Date.now()}-sys`,
        role: 'system',
        content: `Opening WhatsApp with pre-filled message: "${afterHelp}"`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages((prev) => [...prev, userMsg, systemMsg]);
      setInput('');

      try {
        window.open(waUrl, '_blank', 'noopener,noreferrer');
      } catch (err) {
        console.error('Failed to open WhatsApp window:', err);
      }
      return;
    }

    // Normal AI Question Flow
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-user`,
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
          id: `msg-${Date.now()}-assistant`,
          role: 'assistant',
          content: res.answer,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        throw new Error(res.error || 'Unable to retrieve answer.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Help service is temporarily unavailable.');
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-err`,
        role: 'assistant',
        content:
          err.message ||
          'Unable to reach the assistant right now. Please check your connection or retry your question.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isError: true
      };
      setMessages((prev) => [...prev, errorMsg]);
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

  const handleClearConversation = () => {
    setMessages([
      {
        id: 'welcome-reset',
        role: 'assistant',
        content:
          'Conversation cleared. Ask any question about BrandLens.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]);
    setErrorMessage(null);
    textareaRef.current?.focus();
  };

  return (
    <div className="max-w-2xl mx-auto py-4 px-2 space-y-6 page-enter">
      {/* Minimal Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
        <div>
          <h1 className="text-xl sm:text-2xl font-medium tracking-tight text-white font-mono">
            How can we help?
          </h1>
          <p className="text-xs text-[#8c8e9e] mt-1 font-light">
            Ask anything about your BrandLens workspace.
          </p>
        </div>

        <button
          type="button"
          onClick={handleClearConversation}
          className="text-[#8c8e9e] hover:text-white text-xs font-mono p-1.5 rounded transition-colors flex items-center gap-1 cursor-pointer"
          title="Clear conversation"
        >
          <RotateCcw size={13} />
          <span className="hidden sm:inline">Clear</span>
        </button>
      </div>

      {/* Suggested Question Chips (Exact 4 questions) */}
      <div className="flex flex-wrap gap-2">
        {SUGGESTED_QUESTIONS.map((q, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSendMessage(q)}
            disabled={isLoading}
            className="text-xs font-mono px-3 py-1.5 rounded-md bg-white/[0.03] hover:bg-white/[0.08] text-[#a0a0b2] hover:text-white border border-white/10 hover:border-white/20 transition-all cursor-pointer disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Compact Chat Box */}
      <div className="rounded-xl border border-white/10 bg-[#0c0d16]/95 overflow-hidden flex flex-col h-[520px] shadow-2xl backdrop-blur-xl">
        {/* Messages Scroll Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            const isSystem = msg.role === 'system';

            if (isSystem) {
              return (
                <div
                  key={msg.id}
                  className="p-3 bg-emerald-500/10 border border-emerald-500/25 rounded-md text-emerald-300 text-xs font-mono flex items-center gap-2"
                >
                  <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
                  <span>{msg.content}</span>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
              >
                <div
                  className={`w-6 h-6 rounded flex items-center justify-center shrink-0 text-xs ${
                    isUser
                      ? 'bg-[rgba(156,236,255,0.15)] text-[#9cecff] border border-[rgba(156,236,255,0.3)]'
                      : msg.isError
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : 'bg-[rgba(166,139,255,0.15)] text-[#c9beff] border border-[rgba(166,139,255,0.3)]'
                  }`}
                >
                  {isUser ? <User size={13} /> : <Bot size={13} />}
                </div>

                <div
                  className={`max-w-[85%] rounded-lg p-3 text-xs sm:text-sm leading-relaxed ${
                    isUser
                      ? 'bg-[rgba(166,139,255,0.18)] border border-[rgba(166,139,255,0.35)] text-white'
                      : msg.isError
                      ? 'bg-rose-500/10 border border-rose-500/25 text-rose-200'
                      : 'bg-white/[0.03] border border-white/10 text-[#d8d8e6]'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  <div
                    className={`text-[10px] font-mono mt-1.5 pt-1 border-t border-white/5 flex items-center justify-between ${
                      isUser ? 'text-[#a0a0b0]' : 'text-[#727382]'
                    }`}
                  >
                    <span>{isUser ? 'You' : 'BrandLens'}</span>
                    <span>{msg.timestamp}</span>
                  </div>
                </div>
              </div>
            );
          })}

          {isLoading && (
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded bg-[rgba(166,139,255,0.15)] text-[#c9beff] border border-[rgba(166,139,255,0.3)] flex items-center justify-center shrink-0">
                <Bot size={13} />
              </div>
              <div className="p-3 rounded-lg bg-white/[0.03] border border-white/10 flex items-center gap-2 text-xs font-mono text-[#8c8e9e]">
                <Loader2 size={13} className="animate-spin text-[#a68bff]" />
                <span>Thinking...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Error Notification with Optional Retry */}
        {errorMessage && (
          <div className="mx-4 mb-2 p-2.5 bg-rose-500/10 border border-rose-500/25 rounded text-rose-300 text-xs font-mono flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{errorMessage}</span>
            </div>
            {lastQuestion && (
              <button
                type="button"
                onClick={() => handleSendMessage(lastQuestion)}
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white text-[11px] cursor-pointer"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* Input Area */}
        <div className="p-3.5 border-t border-white/10 bg-black/40 space-y-2">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about BrandLens, or type /help your message..."
              disabled={isLoading}
              className="flex-1 bg-white/[0.04] border border-white/10 focus:border-[rgba(166,139,255,0.6)] text-white text-xs sm:text-sm rounded-lg p-2.5 outline-none font-mono placeholder:text-[#6a6a7a] resize-none transition-all"
            />
            <button
              type="button"
              onClick={() => handleSendMessage()}
              disabled={!input.trim() || isLoading}
              className="btn-primary-glow px-4 py-3 rounded-lg bg-[rgba(166,139,255,0.3)] hover:bg-[rgba(166,139,255,0.45)] border border-[rgba(166,139,255,0.6)] text-white text-xs font-mono font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center cursor-pointer h-[56px]"
            >
              {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-[#6c6d7a]">
            <span>
              WhatsApp support: type <code className="text-[#c9beff]">/help your message</code>
            </span>
            <span>Enter to send · Shift+Enter for newline</span>
          </div>
        </div>
      </div>
    </div>
  );
};
