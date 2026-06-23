'use client';

import { useState, useRef, useEffect, Suspense, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Send, Bot, User, Loader2, Terminal, Plus, Trash2, MessageSquare,
  MoreHorizontal, Check, X,
} from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import Cookies from 'js-cookie';
import toast from 'react-hot-toast';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

/**
 * Strip internal LLM markup (DeepSeek DSML, think tags, etc.)
 * so users never see raw model internals.
 */
function cleanContent(text: string): string {
  if (!text) return text;
  return text
    .replace(/<\|\|DSML\|\|tool_calls>[\s\S]*?<\/\|\|DSML\|\|tool_calls>/g, '')
    .replace(/<[/]?\|\|DSML\|\|[^>]*>/g, '')
    .replace(/<\|think\|>[\s\S]*?<\/\|think\|>/g, '')
    .replace(/<[/]?\|think\|>/g, '')
    .replace(/<\|\|[^|]*\|\|>/g, '')
    .trim();
}

/** Fetch wrapper that automatically refreshes the access token on 401. */
async function fetchWithAuth(url: string, init: RequestInit): Promise<Response> {
  const token = Cookies.get('access_token');
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });

  if (res.status !== 401) return res;

  const refreshToken = Cookies.get('refresh_token');
  if (!refreshToken) { window.location.href = '/login'; return res; }

  try {
    const { data } = await api.post('/v1/auth/refresh', { refreshToken });
    Cookies.set('access_token', data.accessToken, {
      expires: 1 / 96,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });
    return fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${data.accessToken}` } });
  } catch {
    Cookies.remove('access_token');
    Cookies.remove('refresh_token');
    window.location.href = '/login';
    return res;
  }
}

// ─── Types ────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'error';
  content: string;
  createdAt: string;
}

interface Conversation {
  id: string;
  title: string;
  agentId: string;
  agent?: { id: string; name: string };
  messageCount: number;
  lastMessageAt?: string;
  createdAt: string;
}

// ─── Main Component ───────────────────────────────────────────────

function ChatContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();

  const agentIdParam  = searchParams.get('agent');
  const convIdParam   = searchParams.get('conv');

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(agentIdParam);
  const [conversationId, setConversationId]   = useState<string | null>(convIdParam);
  const [messages, setMessages]               = useState<ChatMessage[]>([]);
  const [input, setInput]                     = useState('');
  const [isStreaming, setIsStreaming]          = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [activeToolCall, setActiveToolCall]   = useState<string | null>(null);
  const [editingConvId, setEditingConvId]     = useState<string | null>(null);
  const [editingTitle, setEditingTitle]       = useState('');
  const [messagesLoading, setMessagesLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);
  const editInputRef   = useRef<HTMLInputElement>(null);

  // Keep URL in sync
  const pushUrl = useCallback((agentId: string | null, convId: string | null) => {
    const params = new URLSearchParams();
    if (agentId) params.set('agent', agentId);
    if (convId)  params.set('conv',  convId);
    router.replace(`/dashboard/chat?${params.toString()}`, { scroll: false });
  }, [router]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Agents list
  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('/v1/agents').then((r) => r.data),
  });

  // Conversations list
  const { data: conversations, refetch: refetchConversations } = useQuery<Conversation[]>({
    queryKey: ['conversations'],
    queryFn: () => api.get('/v1/conversations').then((r) => r.data),
    refetchInterval: false,
  });

  const selectedAgent = agents?.find((a: any) => a.id === selectedAgentId) ?? agents?.[0] ?? null;

  // When an agent is chosen from param but no selectedAgentId set
  useEffect(() => {
    if (!selectedAgentId && agents?.length) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  // Load messages when conversation changes
  useEffect(() => {
    if (!conversationId) { setMessages([]); return; }
    setMessagesLoading(true);
    api.get(`/v1/conversations/${conversationId}/messages`)
      .then((r) => {
        // Backend now returns { data: Message[], hasMore: boolean }
        const rawMessages = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
        const loaded = rawMessages.filter((m: any) => m.role !== 'tool').map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        }));
        setMessages(loaded);
      })
      .catch(() => toast.error('无法加载历史消息'))
      .finally(() => setMessagesLoading(false));
  }, [conversationId]);

  // ── Mutations ──────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/conversations/${id}`),
    onSuccess: (_, id) => {
      toast.success('会话已删除');
      refetchConversations();
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
        pushUrl(selectedAgentId, null);
      }
    },
    onError: () => toast.error('删除失败'),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.patch(`/v1/conversations/${id}`, { title }),
    onSuccess: () => { refetchConversations(); setEditingConvId(null); },
    onError: () => toast.error('重命名失败'),
  });

  // ── Handlers ──────────────────────────────────────────────────

  const selectConversation = (conv: Conversation) => {
    if (conv.id === conversationId) return;
    setConversationId(conv.id);
    setSelectedAgentId(conv.agentId);
    setStreamingContent('');
    pushUrl(conv.agentId, conv.id);
  };

  const startNewConversation = () => {
    setConversationId(null);
    setMessages([]);
    setStreamingContent('');
    pushUrl(selectedAgentId, null);
    inputRef.current?.focus();
  };

  const startRename = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingConvId(conv.id);
    setEditingTitle(conv.title);
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const commitRename = () => {
    if (!editingConvId || !editingTitle.trim()) { setEditingConvId(null); return; }
    renameMutation.mutate({ id: editingConvId, title: editingTitle.trim() });
  };

  // ── Send Message ───────────────────────────────────────────────

  const sendMessage = async () => {
    if (!input.trim() || isStreaming || !selectedAgent) return;

    const userMsg = input.trim();
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');
    setActiveToolCall(null);

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
        const { data } = await api.post('/v1/conversations', { agentId: selectedAgent.id });
        convId = data.id;
        setConversationId(convId);
        pushUrl(selectedAgent.id, convId);
        refetchConversations();
      }

      const response = await fetchWithAuth(
        `${API_BASE}/v1/conversations/${convId}/messages`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: userMsg }) },
      );

      if (!response.ok) {
        let errMsg = `Server error (${response.status})`;
        try { const b = await response.json(); errMsg = b.message || errMsg; } catch {}
        throw new Error(errMsg);
      }

      const reader  = response.body!.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const text  = decoder.decode(value, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            // handled next line
          } else if (line.startsWith('data: ')) {
            try {
              const eventLine = lines[lines.indexOf(line) - 1] || '';
              const eventType = eventLine.replace('event: ', '').trim();
              const data = JSON.parse(line.slice(6));

              if (eventType === 'content_delta') {
                assistantContent += cleanContent(data.delta ?? '');
                setStreamingContent(assistantContent);
              } else if (eventType === 'tool_use') {
                setActiveToolCall(`Running skill: ${data.skillSlug} (${data.language})`);
              } else if (eventType === 'tool_result') {
                setActiveToolCall(null);
              } else if (eventType === 'message_done') {
                const finalMsg: ChatMessage = {
                  id: data.messageId,
                  role: 'assistant',
                  content: assistantContent,
                  createdAt: new Date().toISOString(),
                };
                setMessages((prev) => [...prev, finalMsg]);
                setStreamingContent('');
                // Refresh conversation list (title may have been auto-set).
                refetchConversations();
              } else if (eventType === 'error') {
                const errText = typeof data.message === 'string' ? data.message : '对话处理失败，请稍后重试。';
                setMessages((prev) => [
                  ...prev,
                  { id: `err-${Date.now()}`, role: 'error' as const, content: errText, createdAt: new Date().toISOString() },
                ]);
                setStreamingContent('');
              }
            } catch { /* skip malformed SSE */ }
          }
        }
      }
    } catch (err: any) {
      const isNetwork = err instanceof TypeError && err.message === 'Failed to fetch';
      const friendly  = isNetwork
        ? '🌐 无法连接到服务器，请确认后端服务是否在 3001 端口正常运行。'
        : (err.message || '😕 发送失败，请稍后重试。');
      setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: 'error' as const, content: friendly, createdAt: new Date().toISOString() }]);
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      setStreamingContent('');
    } finally {
      setIsStreaming(false);
      setActiveToolCall(null);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Conversation groups for sidebar ────────────────────────────
  const groupedConversations = (() => {
    if (!conversations?.length) return [];
    const now = Date.now();
    const groups: { label: string; convs: Conversation[] }[] = [
      { label: '今天', convs: [] },
      { label: '昨天', convs: [] },
      { label: '更早', convs: [] },
    ];
    for (const conv of conversations) {
      const ts = conv.lastMessageAt ? new Date(conv.lastMessageAt).getTime() : new Date(conv.createdAt).getTime();
      const diff = now - ts;
      if (diff < 86_400_000)       groups[0].convs.push(conv);
      else if (diff < 172_800_000) groups[1].convs.push(conv);
      else                          groups[2].convs.push(conv);
    }
    return groups.filter((g) => g.convs.length > 0);
  })();

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Sidebar: Conversation History ── */}
      <aside className="w-64 flex-shrink-0 flex flex-col border-r border-border bg-background/50">
        {/* Sidebar Header */}
        <div className="p-3 border-b border-border flex items-center justify-between flex-shrink-0">
          <span className="text-sm font-medium text-muted-foreground">历史会话</span>
          <button
            id="new-conversation-btn"
            onClick={startNewConversation}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            title="新建会话"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Agent selector */}
        {agents && agents.length > 1 && (
          <div className="px-3 py-2 border-b border-border">
            <select
              value={selectedAgentId || ''}
              onChange={(e) => {
                setSelectedAgentId(e.target.value);
                setConversationId(null);
                setMessages([]);
                pushUrl(e.target.value, null);
              }}
              className="input-field w-full text-xs py-1.5"
            >
              {agents.map((a: any) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto py-2">
          {!conversations ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8 px-3">还没有历史会话，发送第一条消息开始！</p>
          ) : (
            groupedConversations.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-medium text-muted-foreground/60 px-3 py-1 mt-1">{group.label}</p>
                {group.convs.map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conv={conv}
                    isActive={conv.id === conversationId}
                    isEditing={editingConvId === conv.id}
                    editingTitle={editingTitle}
                    editInputRef={editInputRef as React.RefObject<HTMLInputElement>}
                    onSelect={() => selectConversation(conv)}
                    onDelete={(e) => { e.stopPropagation(); deleteMutation.mutate(conv.id); }}
                    onStartRename={(e) => startRename(conv, e)}
                    onEditChange={setEditingTitle}
                    onCommitRename={commitRename}
                    onCancelRename={() => setEditingConvId(null)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ── Main Chat Area ── */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="glass border-b border-border px-5 py-3 flex items-center gap-3 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500/20 to-purple-500/20 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
            <Bot className="w-4 h-4 text-brand-400" />
          </div>
          <div className="min-w-0">
            <h1 className="font-semibold text-sm leading-tight truncate">
              {conversationId
                ? (conversations?.find((c) => c.id === conversationId)?.title || '加载中…')
                : (selectedAgent?.name || '选择 Agent 开始对话')}
            </h1>
            {selectedAgent && (
              <p className="text-xs text-muted-foreground">
                {selectedAgent.skills?.length ?? 0} 个 Skill · {selectedAgent.modelName}
              </p>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {messagesLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
            </div>
          ) : messages.length === 0 && !isStreaming ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-20">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500/20 to-purple-500/20 border border-brand-500/20 flex items-center justify-center mb-4">
                <MessageSquare className="w-7 h-7 text-brand-400" />
              </div>
              <h2 className="font-semibold text-base mb-2">
                {selectedAgent ? `与 ${selectedAgent.name} 对话` : '请先选择一个 Agent'}
              </h2>
              <p className="text-muted-foreground text-sm max-w-xs">
                {selectedAgent
                  ? `已配置 ${selectedAgent.skills?.length ?? 0} 个 Skill，发送消息开始对话`
                  : '在左侧选择历史会话或新建一个'}
              </p>
            </div>
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}

          {/* Streaming response */}
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
                    <p className="whitespace-pre-wrap">{cleanContent(streamingContent)}</p>
                    <span className="inline-block w-0.5 h-4 bg-brand-400 ml-0.5 animate-typing align-middle" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    思考中…
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="glass border-t border-border p-4 flex-shrink-0">
          <div className="flex gap-3 items-end">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={selectedAgent ? `发送消息给 ${selectedAgent.name}…` : '请先选择 Agent…'}
                disabled={isStreaming || !selectedAgent}
                rows={1}
                className="input-field resize-none min-h-[44px] max-h-40 py-3 pr-12"
                style={{ height: 'auto' }}
                onInput={(e) => {
                  const t = e.target as HTMLTextAreaElement;
                  t.style.height = 'auto';
                  t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
                }}
              />
            </div>
            <button
              id="send-message-btn"
              onClick={sendMessage}
              disabled={isStreaming || !input.trim() || !selectedAgent}
              className="btn-primary h-11 px-4 flex-shrink-0 disabled:opacity-40"
            >
              {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-center text-xs text-muted-foreground/50 mt-2">
            Enter 发送 · Shift+Enter 换行
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Conversation Sidebar Item ─────────────────────────────────────

interface ConversationItemProps {
  conv: Conversation;
  isActive: boolean;
  isEditing: boolean;
  editingTitle: string;
  editInputRef: React.RefObject<HTMLInputElement>;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onStartRename: (e: React.MouseEvent) => void;
  onEditChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
}

function ConversationItem({
  conv, isActive, isEditing, editingTitle, editInputRef,
  onSelect, onDelete, onStartRename, onEditChange, onCommitRename, onCancelRename,
}: ConversationItemProps) {
  const [showActions, setShowActions] = useState(false);

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 px-3 py-2 mx-1 rounded-lg cursor-pointer transition-colors text-sm',
        isActive
          ? 'bg-brand-500/15 text-foreground'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
      onClick={onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <MessageSquare className={cn('w-3.5 h-3.5 flex-shrink-0', isActive && 'text-brand-400')} />

      {isEditing ? (
        <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <input
            ref={editInputRef}
            value={editingTitle}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename();
              if (e.key === 'Escape') onCancelRename();
            }}
            className="flex-1 bg-transparent border-b border-brand-400 outline-none text-sm py-0.5"
          />
          <button onClick={onCommitRename} className="text-brand-400 hover:text-brand-300 p-0.5">
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={onCancelRename} className="text-muted-foreground hover:text-foreground p-0.5">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs leading-relaxed">{conv.title}</p>
            {conv.agent && (
              <p className="text-xs text-muted-foreground/60 truncate">{conv.agent.name}</p>
            )}
          </div>

          {/* Actions (on hover) */}
          {showActions && (
            <div className="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              <button
                title="重命名"
                onClick={onStartRename}
                className="p-1 rounded hover:bg-border transition-colors text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
              <button
                title="删除"
                onClick={onDelete}
                className="p-1 rounded hover:bg-red-500/20 transition-colors text-muted-foreground hover:text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Message Bubble ────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser  = message.role === 'user';
  const isError = message.role === 'error';

  if (isError) {
    return (
      <div className="flex gap-3">
        <div className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center flex-shrink-0 mt-0.5 text-base">⚠️</div>
        <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-tl-sm bg-red-500/10 border border-red-500/20 text-sm">
          <p className="text-red-300 font-medium text-xs mb-1">系统提示</p>
          <p className="text-red-200 leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <div className={cn(
        'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
        isUser ? 'bg-secondary border border-border' : 'bg-gradient-to-br from-brand-500 to-purple-500 shadow-glow',
      )}>
        {isUser ? <User className="w-4 h-4 text-muted-foreground" /> : <Bot className="w-4 h-4 text-white" />}
      </div>
      <div className={cn('max-w-[75%]', isUser ? 'chat-user' : 'chat-assistant')}>
        <p className="whitespace-pre-wrap leading-relaxed">
          {isUser ? message.content : cleanContent(message.content)}
        </p>
      </div>
    </div>
  );
}

// ─── Page Export ───────────────────────────────────────────────────

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
      </div>
    }>
      <ChatContent />
    </Suspense>
  );
}
