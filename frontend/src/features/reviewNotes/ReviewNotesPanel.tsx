import React, { useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import {
  AddCommentRounded, BrushRounded, CheckCircleRounded, CloseRounded, DeleteOutlineRounded, GestureRounded,
  MyLocationRounded, NorthEastRounded, PanToolAltRounded, PanoramaFishEyeRounded, RateReviewRounded,
  RadioButtonUncheckedRounded, UndoRounded, CropSquareRounded,
} from '@mui/icons-material';
import type { ReviewNote } from '@/services/reviewNoteService';
import { ANNOTATION_COLORS, MAX_SHAPES, type Shape } from '@/utils/annotationGeometry';
import type { AnnotateTool } from './AnnotationLayer';

export interface DraftAnnotation {
  active: boolean;
  tool: AnnotateTool;
  color: string;
  shapes: Shape[];
}

interface Props {
  notes: ReviewNote[];
  /** Photo these notes belong to, e.g. "5 Nov 2026, 03:37 pm". */
  captureLabel: string;
  /** Unresolved notes across the whole tour. */
  openOnTour: number;
  loading: boolean;
  canWrite: boolean;
  /** False for photos that cannot be drawn on (for example raw dual-fisheye); comments still work. */
  canAnnotate: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onShow: (note: ReviewNote) => void;
  draft: DraftAnnotation;
  onDraftChange: (patch: Partial<DraftAnnotation>) => void;
  saving: boolean;
  error: string;
  onSave: (text: string) => Promise<boolean>;
  onToggleResolved: (note: ReviewNote) => void;
  onDelete: (note: ReviewNote) => void;
}

const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const BLUE = '#2563eb';

const TOOLS: { id: AnnotateTool; label: string; icon: React.ReactNode }[] = [
  { id: 'move', label: 'Move', icon: <PanToolAltRounded sx={{ fontSize: 18 }} /> },
  { id: 'rect', label: 'Box', icon: <CropSquareRounded sx={{ fontSize: 18 }} /> },
  { id: 'ellipse', label: 'Circle', icon: <PanoramaFishEyeRounded sx={{ fontSize: 18 }} /> },
  { id: 'arrow', label: 'Arrow', icon: <NorthEastRounded sx={{ fontSize: 18 }} /> },
  { id: 'pen', label: 'Pen', icon: <GestureRounded sx={{ fontSize: 18 }} /> },
];

function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Review notes for the photo on screen. Everyone who can open the tour reads them; managers add comments and draw
 * on the photo. A note can carry a comment, a drawing, or both.
 */
export default function ReviewNotesPanel({
  notes, captureLabel, openOnTour, loading, canWrite, canAnnotate, selectedId, onSelect, onShow, draft, onDraftChange,
  saving, error, onSave, onToggleResolved, onDelete,
}: Props) {
  const [text, setText] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const hasDrawing = draft.shapes.length > 0;
  const canSubmit = !saving && (text.trim().length > 0 || hasDrawing);

  const submit = async () => {
    if (!canSubmit) return;
    const ok = await onSave(text.trim());
    if (ok) setText('');
  };

  const iconBtn = (title: string, onClick: () => void, icon: React.ReactNode, opts: { danger?: boolean; testId?: string } = {}) => (
    <Box
      role="button" aria-label={title} title={title} data-testid={opts.testId} onClick={onClick}
      sx={{
        width: 34, height: 34, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        color: opts.danger ? '#dc2626' : MUTED, '&:hover': { backgroundColor: opts.danger ? '#fef2f2' : '#f1f5f9', color: opts.danger ? '#b91c1c' : INK },
      }}
    >
      {icon}
    </Box>
  );

  return (
    <Box data-testid="review-notes-panel" sx={{ backgroundColor: '#fff', border: `1px solid ${LINE}`, borderRadius: '20px', overflow: 'hidden' }}>
      {/* header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 1.5, borderBottom: `1px solid ${LINE}` }}>
        <Box sx={{ width: 36, height: 36, borderRadius: '11px', backgroundColor: '#fff7ed', color: '#ea580c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <RateReviewRounded sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 800, color: INK, lineHeight: 1.2 }}>Review notes</Typography>
          <Typography noWrap sx={{ fontSize: '0.75rem', color: MUTED }}>This photo · {captureLabel || 'latest capture'}</Typography>
        </Box>
        {openOnTour > 0 && (
          <Box data-testid="open-notes-chip" sx={{ px: 1.25, py: 0.5, borderRadius: '999px', backgroundColor: '#fff7ed', color: '#c2410c', fontSize: '0.75rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
            {openOnTour} to do on this tour
          </Box>
        )}
      </Box>

      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {/* composer (managers only) */}
        {canWrite && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, p: 1.5, borderRadius: '16px', backgroundColor: '#f8fafc', border: `1px solid ${LINE}` }}>
            {draft.active && (
              <Box data-testid="annotate-toolbar" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                  <Box sx={{ display: 'flex', p: 0.5, gap: 0.25, borderRadius: '12px', backgroundColor: '#e8edf4' }}>
                    {TOOLS.map(t => (
                      <Box
                        key={t.id} role="button" aria-pressed={draft.tool === t.id} title={t.label} data-testid={`tool-${t.id}`}
                        onClick={() => onDraftChange({ tool: t.id })}
                        sx={{
                          display: 'flex', alignItems: 'center', gap: 0.5, px: 1.1, py: 0.6, borderRadius: '9px', cursor: 'pointer', userSelect: 'none',
                          fontSize: '0.75rem', fontWeight: 700, color: draft.tool === t.id ? BLUE : MUTED,
                          backgroundColor: draft.tool === t.id ? '#fff' : 'transparent', boxShadow: draft.tool === t.id ? '0 1px 3px rgba(15,23,42,0.14)' : 'none',
                        }}
                      >
                        {t.icon}<Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t.label}</Box>
                      </Box>
                    ))}
                  </Box>

                  <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', px: 0.5 }}>
                    {ANNOTATION_COLORS.map(c => (
                      <Box
                        key={c} role="button" aria-label={`Colour ${c}`} aria-pressed={draft.color === c} data-testid={`color-${c.slice(1)}`}
                        onClick={() => onDraftChange({ color: c })}
                        sx={{
                          width: 22, height: 22, borderRadius: '50%', backgroundColor: c, cursor: 'pointer',
                          border: '2px solid #fff', boxShadow: draft.color === c ? `0 0 0 2px ${c === '#ffffff' ? '#94a3b8' : c}` : '0 0 0 1px #cbd5e1',
                        }}
                      />
                    ))}
                  </Box>

                  <Box sx={{ flex: 1 }} />
                  {iconBtn('Undo last shape', () => onDraftChange({ shapes: draft.shapes.slice(0, -1) }), <UndoRounded sx={{ fontSize: 19 }} />, { testId: 'annotate-undo' })}
                </Box>
                <Typography sx={{ fontSize: '0.75rem', color: MUTED }}>
                  {draft.tool === 'move'
                    ? 'Turn and zoom the photo to the spot, then pick a shape.'
                    : 'Drag on the photo to draw. Choose Move to turn the photo again.'}
                  {hasDrawing ? ` ${draft.shapes.length} of ${MAX_SHAPES} shapes drawn.` : ''}
                </Typography>
              </Box>
            )}

            <Box
              component="textarea"
              data-testid="note-text"
              value={text}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
              placeholder="Write a note, e.g. Windows not yet installed"
              rows={2}
              maxLength={1000}
              sx={{
                width: '100%', resize: 'vertical', boxSizing: 'border-box', p: 1.25, borderRadius: '12px', border: `1px solid ${LINE}`, backgroundColor: '#fff',
                font: 'inherit', fontSize: '0.875rem', color: INK, outline: 'none', '&:focus': { borderColor: BLUE, boxShadow: '0 0 0 3px rgba(37,99,235,0.12)' },
              }}
            />

            {error && <Typography data-testid="note-error" sx={{ fontSize: '0.8125rem', color: '#b91c1c', fontWeight: 600 }}>{error}</Typography>}

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              {canAnnotate && !draft.active && (
                <Box
                  role="button" data-testid="annotate-start" onClick={() => onDraftChange({ active: true, tool: 'rect' })}
                  sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.9, borderRadius: '12px', cursor: 'pointer', userSelect: 'none', border: `1.5px solid ${LINE}`, backgroundColor: '#fff', fontSize: '0.8125rem', fontWeight: 700, color: INK, '&:hover': { borderColor: BLUE, color: BLUE } }}
                >
                  <BrushRounded sx={{ fontSize: 18 }} /> Annotate photo
                </Box>
              )}
              {draft.active && (
                <Box
                  role="button" data-testid="annotate-cancel" onClick={() => onDraftChange({ active: false, tool: 'move', shapes: [] })}
                  sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.9, borderRadius: '12px', cursor: 'pointer', userSelect: 'none', border: `1.5px solid ${LINE}`, backgroundColor: '#fff', fontSize: '0.8125rem', fontWeight: 700, color: MUTED }}
                >
                  <CloseRounded sx={{ fontSize: 18 }} /> Cancel drawing
                </Box>
              )}
              <Box sx={{ flex: 1 }} />
              <Box
                role="button" aria-disabled={!canSubmit} data-testid="note-save" onClick={() => { void submit(); }}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.95, borderRadius: '12px', userSelect: 'none', fontSize: '0.8125rem', fontWeight: 800, color: '#fff',
                  cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.5,
                  background: `linear-gradient(135deg,${BLUE},#1d4ed8)`, boxShadow: canSubmit ? '0 4px 12px rgba(37,99,235,0.28)' : 'none',
                }}
              >
                {saving ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <AddCommentRounded sx={{ fontSize: 18 }} />}
                {hasDrawing ? 'Save note with drawing' : 'Add note'}
              </Box>
            </Box>
          </Box>
        )}

        {/* list */}
        {loading ? (
          <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}><CircularProgress size={22} /></Box>
        ) : notes.length === 0 ? (
          <Box data-testid="notes-empty" sx={{ py: 2.5, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: INK }}>No notes on this photo yet</Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: MUTED, mt: 0.25 }}>
              {canWrite ? 'Add a note above so everyone can see what still needs doing.' : 'A manager can add notes about what needs doing here.'}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {notes.map((n, i) => {
              const selected = selectedId === n.id;
              const drawn = !!n.annotation?.shapes?.length;
              return (
                <Box
                  key={n.id} data-testid="review-note" onClick={() => drawn && onSelect(selected ? null : n.id)}
                  sx={{
                    display: 'flex', gap: 1.25, p: 1.5, borderRadius: '14px', cursor: drawn ? 'pointer' : 'default',
                    border: `1.5px solid ${selected ? BLUE : LINE}`, backgroundColor: selected ? '#eff6ff' : '#fff', opacity: n.resolved ? 0.7 : 1,
                  }}
                >
                  <Box sx={{ width: 28, height: 28, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: n.resolved ? '#dcfce7' : drawn ? (n.annotation?.shapes[0]?.color ?? '#ef4444') : '#fff7ed', color: n.resolved ? '#15803d' : drawn ? '#fff' : '#c2410c', fontSize: '0.75rem', fontWeight: 800 }}>
                    {n.resolved ? <CheckCircleRounded sx={{ fontSize: 18 }} /> : drawn ? i + 1 : <AddCommentRounded sx={{ fontSize: 15 }} />}
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: INK, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', textDecoration: n.resolved ? 'line-through' : 'none' }}>
                      {n.text || 'Marked on the photo'}
                    </Typography>
                    <Typography sx={{ fontSize: '0.75rem', color: MUTED, mt: 0.375 }}>
                      {n.createdByName || 'Manager'} · {whenLabel(n.createdAt)}{n.resolved ? ' · Done' : ''}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    {drawn && iconBtn('Show on photo', () => onShow(n), <MyLocationRounded sx={{ fontSize: 19 }} />, { testId: 'note-show' })}
                    {canWrite && iconBtn(n.resolved ? 'Mark as to do' : 'Mark as done', () => onToggleResolved(n), n.resolved ? <CheckCircleRounded sx={{ fontSize: 20, color: '#16a34a' }} /> : <RadioButtonUncheckedRounded sx={{ fontSize: 20 }} />, { testId: 'note-resolve' })}
                    {canWrite && (confirmId === n.id ? (
                      <Box
                        role="button" data-testid="note-delete-confirm" onClick={() => { setConfirmId(null); onDelete(n); }}
                        sx={{ px: 1.1, py: 0.6, borderRadius: '9px', backgroundColor: '#dc2626', color: '#fff', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}
                      >
                        Delete?
                      </Box>
                    ) : iconBtn('Delete note', () => setConfirmId(n.id), <DeleteOutlineRounded sx={{ fontSize: 19 }} />, { danger: true, testId: 'note-delete' }))}
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}
