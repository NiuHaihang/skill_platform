'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Send, Bot, User, Loader2, Terminal, Plus, ChevronDown, Zap,
} from 'lucide-react';
import api from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import Cookies from 'js-cookie';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: string;
  toolCalls?: any[];
}

interface StreamEvent {
  event: string;
  data: any;
}

// ─── Main Component ───────────────────────────────────────────────

function ChatContent() {
  const searchParams = useSearchParams();
  const agentId = searchParams.get('agent');
  const qc = useQueryClient();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [activeToolCall, setActiveToolCall] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Load agents for selector
  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('/v1/agents').then((r) => r.data),
  });

  const [selectedAgent, setSelectedAgent] = useState<any>(null);

  useEffect(() => {
    if (agents && agentId) {
      const found = agents.find((a: any) => a.id === agentId);
      if (found) setSelectedAgent(found);
    } else if (agents?.length > 0 && !selectedAgent) {
      setSelectedAgent(agents[0]);
    }
  }, [agents, agentId]);

  // Create conversation
  const startConversation = async (agent: any) => {
    if (conversationId) return;
    const { data } = await api.post('/v1/conversations', { agentId: agent.id });
    setConversationId(data.id);
    return data.id;
  };

  // Send message with SSE streaming
  const sendMessage = async () => {
    if (!input.trim() || isStreaming || !selectedAgent) return;

    const userMsg = input.trim();
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');
    setActiveToolCall(null);

    // Add user message immediately.
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: userMsg,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      // Ensure conversation exists.
      let convId = conversationId;
      if (!convId) {
        convId = await startConversation(selectedAgent) ?? null;
        if (!convId) throw new Error('Failed to create conversation');
      }

      // SSE streaming via fetch (EventSource doesn't support POST).
      const token = Cookies.get('access_token');
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/v1/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ content: userMsg }),
        },
      );

      if (!response.ok) throw new Error('Failed to send message');

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            // event type, handled next line
          } else if (line.startsWith('data: ')) {
            try {
              const eventLine = lines[lines.indexOf(line) - 1] || '';
              const eventType = eventLine.replace('event: ', '').trim();
              const data = JSON.parse(line.slice(6));

              if (eventType === 'content_delta') {
                assistantContent += data.delta;
                setStreamingContent(assistantContent);
              } else if (eventType === 'tool_use') {
                setActiveToolCall(`Running skill: ${data.skillSlug} (${data.language})`);
              } else if (eventType === 'tool_result') {
                setActiveToolCall(null);
              } else if (eventType === 'message_done') {
                // Finalize
                const finalMsg: ChatMessage = {
                  id: data.messageId,
                  role: 'assistant',
                  content: assistantContent,
                  createdAt: new Date().toISOString(),
                };
                setMessages((prev) => [...prev, finalMsg]);
                setStreamingContent('');
              } else if (eventType === 'error') {
                toast.error(data.message);
              }
            } catch {
              // Skip malformed SSE data.
            }
          }
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to send message');
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
    } finally {
      setIsStreaming(false);
      setActiveToolCall(null);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="glass border-b border-border px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500/20 to-purple-500/20 border border-brand-500/20 flex items-center justify-center">
            <Bot className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="font-semibold">{selectedAgent?.name || 'Select an Agent'}</h1>
            {selectedAgent && (
              <p className="text-xs text-muted-foreground">
                {selectedAgent.skills?.length ?? 0} skills · {selectedAgent.modelName}
              </p>
            )}
          </div>
        </div>

        {/* Agent selector */}
        {agents && agents.length > 1 && (
          <select
            value={selectedAgent?.id || ''}
            onChange={(e) => {
              const agent = agents.find((a: any) => a.id === e.target.value);
              if (agent) {
                setSelectedAgent(agent);
                setConversationId(null);
                setMessages([]);
              }
            }}
            className="input-field w-auto text-sm"
          >
            {agents.map((a: any) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500/20 to-purple-500/20 border border-brand-500/20 flex items-center justify-center mb-4">
              <Zap className="w-8 h-8 text-brand-400" />
            </div>
            <h2 className="font-semibold text-lg mb-2">Start a conversation</h2>
            <p className="text-muted-foreground text-sm max-w-xs">
              {selectedAgent
                ? `Chat with ${selectedAgent.name}. It has ${selectedAgent.skills?.length ?? 0} skills ready.`
                : 'Select or create an agent to get started.'}
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming assistant response */}
        {isStreaming && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-purple-500 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-glow">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 max-w-[85%]">
              {activeToolCall && (
                <div className="flex items-center gap-2 text-xs text-brand-400 mb-2 px-3 py-1.5 rounded-lg bg-brand-500/10 border border-brand-500/20 w-fit">
                  <Terminal className="w-3.5 h-3.5 animate-pulse" />
                  {activeToolCall}
                </div>
              )}
              {streamingContent ? (
                <div className="chat-assistant">
                  <p className="whitespace-pre-wrap">{streamingContent}</p>
                  <span className="inline-block w-0.5 h-4 bg-brand-400 ml-0.5 animate-typing align-middle" />
                </div>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Thinking…
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ── */}
      <div className="glass border-t border-border p-4 flex-shrink-0">
        <div className="max-w-4xl mx-auto flex gap-3 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedAgent ? `Message ${selectedAgent.name}…` : 'Select an agent first…'}
              disabled={isStreaming || !selectedAgent}
              rows={1}
              className="input-field resize-none min-h-[44px] max-h-40 py-3 pr-12"
              style={{ height: 'auto' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${Math.min(target.scrollHeight, 160)}px`;
              }}
            />
            <p className="absolute right-3 bottom-2.5 text-xs text-muted-foreground/50">
              {input.length > 0 ? '↵ send' : ''}
            </p>
          </div>
          <button
            onClick={sendMessage}
            disabled={isStreaming || !input.trim() || !selectedAgent}
            className="btn-primary h-11 px-4 flex-shrink-0 disabled:opacity-40"
          >
            {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-center text-xs text-muted-foreground/50 mt-2">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div className={cn(
        'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
        isUser
          ? 'bg-secondary border border-border'
          : 'bg-gradient-to-br from-brand-500 to-purple-500 shadow-glow',
      )}>
        {isUser
          ? <User className="w-4 h-4 text-muted-foreground" />
          : <Bot className="w-4 h-4 text-white" />
        }
      </div>

      {/* Bubble */}
      <div className={cn('max-w-[75%]', isUser ? 'chat-user' : 'chat-assistant')}>
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-brand-400" /></div>}>
      <ChatContent />
    </Suspense>
  );
}
