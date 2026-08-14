import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Typography, TextField, IconButton, CircularProgress, Button, Tooltip,
} from '@mui/material';
import {
  SendRounded, ArrowBackRounded, AutoAwesomeRounded, DeleteOutlineRounded,
  AddCommentRounded, ChatBubbleOutlineRounded, MenuRounded, CloseRounded,
} from '@mui/icons-material';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { colors } from '@theme/tokens';
import {
  useDrishtiProjects,
  useSuggestedQuestions,
  useDrishtiConversation,
  useDrishtiConversations,
  useAskDrishti,
  useDeleteDrishtiConversation,
} from '@/hooks/useDrishti';
import DrishtiMessageBubble from '@/components/drishti/DrishtiMessageBubble';
import DrishtiSuggestedQuestions from '@/components/drishti/DrishtiSuggestedQuestions';
import DrishtiScopeBreadcrumb from '@/components/drishti/DrishtiScopeBreadcrumb';
import ConfirmDialog from '@shared/components/ConfirmDialog/ConfirmDialog';
import type { DrishtiConversationSummary, DrishtiMessage, DrishtiScope } from '@/types/drishti';

const EMPTY_SCOPE: DrishtiScope = {
  towerId: null, towerName: null, floorId: null, floorName: null, flatName: null, roomName: null,
};

function formatChatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function ChatHistoryItem({
  chat,
  active,
  onSelect,
  onDelete,
}: {
  chat: DrishtiConversationSummary;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <Box
      onClick={onSelect}
      sx={{
        display: 'flex', alignItems: 'flex-start', gap: 0.75,
        px: 1.25, py: 1, borderRadius: '10px', cursor: 'pointer',
        backgroundColor: active ? colors.primarySoft : 'transparent',
        border: `1px solid ${active ? colors.primary + '33' : 'transparent'}`,
        '&:hover': {
          backgroundColor: active ? colors.primarySoft : colors.bg,
          '& .chat-delete': { opacity: 1 },
        },
      }}
    >
      <ChatBubbleOutlineRounded sx={{ fontSize: 15, color: active ? colors.primary : colors.textMuted, mt: 0.35, flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{
          fontSize: '0.8125rem', fontWeight: active ? 700 : 600,
          color: active ? colors.primary : colors.textStrong, lineHeight: 1.3,
        }}>
          {chat.title || 'Untitled chat'}
        </Typography>
        <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, mt: 0.25 }}>
          {formatChatTime(chat.updatedAt)}
        </Typography>
      </Box>
      <Tooltip title="Delete chat">
        <IconButton
          className="chat-delete"
          size="small"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          sx={{
            opacity: { xs: 1, md: 0 }, transition: 'opacity 120ms',
            color: colors.textMuted, p: 0.5,
            '&:hover': { color: colors.danger, backgroundColor: colors.dangerBg },
          }}
        >
          <DeleteOutlineRounded sx={{ fontSize: 15 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default function DrishtiChatPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlConversationId = searchParams.get('c') || undefined;

  const { data: projects } = useDrishtiProjects();
  const project = projects?.find(p => p.projectId === projectId);

  const [conversationId, setConversationId] = useState<string | undefined>(urlConversationId);
  const [localMessages, setLocalMessages] = useState<DrishtiMessage[]>([]);
  const [scope, setScope] = useState<DrishtiScope>(EMPTY_SCOPE);
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DrishtiConversationSummary | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hydratedRef = useRef<string | null>(null);

  const { data: conversations = [], isLoading: loadingList } = useDrishtiConversations(projectId);
  const { data: conversation, isFetching: loadingConversation } = useDrishtiConversation(conversationId);
  const { data: suggestedData } = useSuggestedQuestions(projectId);
  const askMutation = useAskDrishti(projectId as string);
  const deleteMutation = useDeleteDrishtiConversation(projectId as string);

  // Keep URL in sync so refresh restores the active chat.
  useEffect(() => {
    if (!projectId) return;
    const next = new URLSearchParams(searchParams);
    if (conversationId) next.set('c', conversationId);
    else next.delete('c');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [conversationId, projectId, searchParams, setSearchParams]);

  // Sync from URL when navigating via browser back/forward or deep-link.
  useEffect(() => {
    if (urlConversationId !== conversationId) {
      setConversationId(urlConversationId);
      if (!urlConversationId) {
        setLocalMessages([]);
        setScope(EMPTY_SCOPE);
        hydratedRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to URL changes
  }, [urlConversationId]);

  // Hydrate messages from the persisted conversation when selecting/reloading a chat.
  useEffect(() => {
    if (!conversation || conversation.conversationId !== conversationId) return;
    // Don't clobber optimistic in-flight turns for the same conversation.
    if (askMutation.isPending && hydratedRef.current === conversationId) return;
    setLocalMessages(conversation.messages);
    setScope(conversation.scope ?? EMPTY_SCOPE);
    hydratedRef.current = conversationId ?? null;
  }, [conversation, conversationId, askMutation.isPending]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [localMessages, askMutation.isPending]);

  const sortedChats = useMemo(
    () => [...conversations].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [conversations],
  );

  if (!projectId) {
    return <Navigate to="/drishti" replace />;
  }

  const startNewChat = () => {
    setConversationId(undefined);
    setLocalMessages([]);
    setScope(EMPTY_SCOPE);
    hydratedRef.current = null;
    setSidebarOpen(false);
  };

  const selectChat = (id: string) => {
    if (id === conversationId) {
      setSidebarOpen(false);
      return;
    }
    setConversationId(id);
    setLocalMessages([]);
    setScope(EMPTY_SCOPE);
    hydratedRef.current = null;
    setSidebarOpen(false);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.conversationId;
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('Chat deleted');
      if (conversationId === id) startNewChat();
    } catch {
      toast.error('Could not delete chat');
    } finally {
      setDeleteTarget(null);
    }
  };

  const send = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || askMutation.isPending) return;
    setInput('');

    const optimisticUser: DrishtiMessage = {
      messageId: `optimistic-${Date.now()}`,
      role: 'user',
      content: trimmed,
      structuredPayload: null,
      createdAt: new Date().toISOString(),
    };
    setLocalMessages(prev => [...prev, optimisticUser]);

    try {
      const result = await askMutation.mutateAsync({ question: trimmed, conversationId });
      setConversationId(result.conversationId);
      hydratedRef.current = result.conversationId;
      setLocalMessages(prev => {
        const withoutOptimistic = prev.filter(m => m.messageId !== optimisticUser.messageId);
        // Prefer server-persisted user turn if present after refetch; otherwise keep optimistic + assistant.
        return [...withoutOptimistic, optimisticUser, result.message];
      });
      if (result.message.structuredPayload?.scope) {
        setScope(result.message.structuredPayload.scope);
      }
    } catch {
      toast.error('Drishti is temporarily unavailable. Your construction data is safe. Please try again.');
      setLocalMessages(prev => prev.filter(m => m.messageId !== optimisticUser.messageId));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'morning' : greetingHour < 17 ? 'afternoon' : 'evening';

  const sidebar = (
    <Box sx={{
      width: { xs: '100%', md: 260 },
      flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      height: '100%',
      borderRight: { md: `1px solid ${colors.border}` },
      backgroundColor: colors.card,
      px: 1.25, py: 1.5,
    }}>
      <Button
        fullWidth
        variant="outlined"
        startIcon={<AddCommentRounded />}
        onClick={startNewChat}
        sx={{
          mb: 1.5, justifyContent: 'flex-start', textTransform: 'none',
          fontWeight: 700, fontSize: '0.8125rem', borderRadius: '10px',
          borderColor: colors.border, color: colors.textStrong,
          '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft },
        }}
      >
        New chat
      </Button>

      <Typography sx={{
        fontSize: '0.6875rem', fontWeight: 700, color: colors.textMuted,
        textTransform: 'uppercase', letterSpacing: '0.06em', px: 0.75, mb: 0.75,
      }}>
        Your chats
      </Typography>

      <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {loadingList ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={18} />
          </Box>
        ) : sortedChats.length === 0 ? (
          <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, px: 0.75, py: 1.5, lineHeight: 1.45 }}>
            No saved chats yet. Ask a question to start one — it will appear here.
          </Typography>
        ) : (
          sortedChats.map(chat => (
            <ChatHistoryItem
              key={chat.conversationId}
              chat={chat}
              active={chat.conversationId === conversationId}
              onSelect={() => selectChat(chat.conversationId)}
              onDelete={() => setDeleteTarget(chat)}
            />
          ))
        )}
      </Box>
    </Box>
  );

  return (
    <Box sx={{
      position: 'relative',
      mx: { xs: -1, sm: -1.5, md: -2 },
      mb: { xs: -1, md: -2 },
      height: { xs: 'calc(100vh - 120px)', md: 'calc(100vh - 100px)' },
      display: 'flex',
      borderTop: `1px solid ${colors.border}`,
      backgroundColor: colors.bg,
    }}>
      {/* Desktop sidebar */}
      <Box sx={{ display: { xs: 'none', md: 'flex' }, height: '100%' }}>
        {sidebar}
      </Box>

      {/* Mobile sidebar drawer */}
      {sidebarOpen && (
        <Box sx={{
          display: { xs: 'flex', md: 'none' },
          position: 'absolute', inset: 0, zIndex: 20,
          backgroundColor: 'rgba(15,23,42,0.35)',
        }} onClick={() => setSidebarOpen(false)}>
          <Box
            onClick={(e) => e.stopPropagation()}
            sx={{ width: '82vw', maxWidth: 300, height: '100%', boxShadow: '8px 0 24px rgba(0,0,0,0.12)' }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 1, pt: 1, backgroundColor: colors.card }}>
              <IconButton size="small" onClick={() => setSidebarOpen(false)}>
                <CloseRounded sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
            {sidebar}
          </Box>
        </Box>
      )}

      {/* Main chat column */}
      <Box sx={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
        maxWidth: 900, mx: 'auto', width: '100%', px: { xs: 1.5, md: 2.5 },
      }}>
        {/* Header */}
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          py: 1.75, borderBottom: `1px solid ${colors.border}`, gap: 1,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            <IconButton size="small" onClick={() => navigate('/drishti')} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
              <ArrowBackRounded sx={{ fontSize: 18 }} />
            </IconButton>
            <IconButton size="small" onClick={() => setSidebarOpen(true)} sx={{ display: { xs: 'inline-flex', md: 'none' } }}>
              <MenuRounded sx={{ fontSize: 20 }} />
            </IconButton>
            <Box sx={{
              width: 34, height: 34, borderRadius: '9px', backgroundColor: colors.primary + '12',
              color: colors.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <AutoAwesomeRounded sx={{ fontSize: 17 }} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, lineHeight: 1.2 }}>
                {conversation?.title || (localMessages.length ? 'Chat' : 'New chat')}
              </Typography>
              <DrishtiScopeBreadcrumb projectName={project?.projectName ?? 'Loading…'} scope={scope} />
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
            <Button
              size="small"
              startIcon={<AddCommentRounded />}
              onClick={startNewChat}
              sx={{ fontSize: '0.75rem', fontWeight: 700, displayTransform: 'none', display: { xs: 'none', sm: 'inline-flex' } }}
            >
              New chat
            </Button>
            {conversationId && (
              <Tooltip title="Delete this chat">
                <IconButton
                  size="small"
                  onClick={() => {
                    const chat = sortedChats.find(c => c.conversationId === conversationId);
                    setDeleteTarget(chat ?? {
                      conversationId,
                      projectId,
                      projectName: project?.projectName ?? '',
                      title: conversation?.title || 'Chat',
                      updatedAt: new Date().toISOString(),
                    });
                  }}
                  sx={{ color: colors.textMuted, '&:hover': { color: colors.danger } }}
                >
                  <DeleteOutlineRounded sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
            <Button size="small" onClick={() => navigate('/drishti')} sx={{ fontSize: '0.75rem', textTransform: 'none' }}>
              Projects
            </Button>
          </Box>
        </Box>

        {/* Messages */}
        <Box ref={scrollRef} sx={{ flex: 1, overflowY: 'auto', px: 0.5, py: 1.5 }}>
          {conversationId && loadingConversation && localMessages.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={22} />
            </Box>
          ) : localMessages.length === 0 ? (
            <Box sx={{ py: 2 }}>
              <Box sx={{ p: 2.5, borderRadius: '4px 14px 14px 14px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, mb: 3 }}>
                <Typography sx={{ fontSize: '0.875rem', color: colors.textStrong }}>
                  Good {greeting}. I'm Drishti.
                  I'm ready to help you understand {project?.projectName ?? 'this project'}.
                </Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mt: 1 }}>
                  You can ask me about project progress, floors, flats, rooms, finishing works,
                  common areas, captures, quality issues or estimated completion.
                  Your chats are saved automatically — use New chat to start a fresh thread.
                </Typography>
              </Box>
              <DrishtiSuggestedQuestions
                questions={suggestedData?.questions ?? []}
                onSelect={(q) => send(q)}
              />
            </Box>
          ) : (
            localMessages.map((m) => (
              <DrishtiMessageBubble key={m.messageId} message={m} onFollowUpClick={(q) => send(q)} />
            ))
          )}
          {askMutation.isPending && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1 }}>
              <CircularProgress size={16} />
              <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>Drishti is thinking…</Typography>
            </Box>
          )}
        </Box>

        {/* Input */}
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, py: 1.75, borderTop: `1px solid ${colors.border}` }}>
          <TextField
            fullWidth
            multiline
            maxRows={4}
            placeholder="Ask Drishti anything about this project..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            size="small"
            disabled={askMutation.isPending}
          />
          <IconButton
            color="primary"
            onClick={() => send(input)}
            disabled={askMutation.isPending || !input.trim()}
            sx={{
              backgroundColor: colors.primary, color: '#fff',
              '&:hover': { backgroundColor: colors.primary },
              '&.Mui-disabled': { backgroundColor: colors.borderLight, color: colors.textSubdued },
            }}
          >
            <SendRounded sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      </Box>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete chat?"
        description={`“${deleteTarget?.title || 'This chat'}” will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
