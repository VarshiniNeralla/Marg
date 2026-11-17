import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ReviewNotesPanel from './ReviewNotesPanel';
import type { ReviewNote } from '@/services/reviewNoteService';

const note = (over: Partial<ReviewNote> = {}): ReviewNote => ({
  id: 'n1', tourId: 't', captureId: 'c', text: 'Windows not yet installed', annotation: null, resolved: false,
  createdBy: 'u', createdByName: 'Meera', createdAt: '2026-11-17T10:00:00Z', updatedAt: '2026-11-17T10:00:00Z', ...over,
});

const base = {
  notes: [] as ReviewNote[], captureLabel: '5 Nov 2026, 03:37 pm', openOnTour: 0, loading: false, canWrite: true, canAnnotate: true,
  selectedId: null, onSelect: () => undefined, onShow: () => undefined,
  draft: { active: false, tool: 'move' as const, color: '#ef4444', shapes: [] },
  onDraftChange: () => undefined,
  saving: false, error: '', onSave: async () => true, onToggleResolved: () => undefined, onDelete: () => undefined,
};
const html = (over: Record<string, unknown> = {}) => renderToStaticMarkup(<ReviewNotesPanel {...base} {...over} />);

describe('review notes panel', () => {
  it('a manager can write a note and start annotating', () => {
    const h = html();
    expect(h).toContain('data-testid="note-text"');
    expect(h).toContain('data-testid="annotate-start"');
    expect(h).toContain('No notes on this photo yet');
  });

  it('everyone else only reads notes', () => {
    const h = html({ canWrite: false, notes: [note()] });
    expect(h).not.toContain('data-testid="note-text"');
    expect(h).not.toContain('data-testid="note-delete"');
    expect(h).not.toContain('data-testid="note-resolve"');
    expect(h).toContain('Windows not yet installed');
  });

  it('shows who wrote a note and what is still to do on the tour', () => {
    const h = html({ notes: [note()], openOnTour: 3 });
    expect(h).toContain('Meera');
    expect(h).toContain('3 to do on this tour');
  });

  it('a drawn note can be shown on the photo, a resolved one reads as done', () => {
    const drawn = note({ annotation: { space: 'sphere', shapes: [{ kind: 'rect', color: '#ef4444', points: [[0, 0], [1, 1]] }] } });
    expect(html({ notes: [drawn] })).toContain('data-testid="note-show"');
    expect(html({ notes: [note({ resolved: true })] })).toContain('Done');
  });

  it('drawing tools appear only while annotating, and photos that cannot be drawn on hide the button', () => {
    expect(html()).not.toContain('data-testid="annotate-toolbar"');
    const drafting = html({ draft: { active: true, tool: 'rect', color: '#ef4444', shapes: [{ kind: 'rect', color: '#ef4444', points: [[0, 0], [1, 1]] }] } });
    expect(drafting).toContain('data-testid="annotate-toolbar"');
    expect(drafting).toContain('Save note with drawing');
    expect(html({ canAnnotate: false })).not.toContain('data-testid="annotate-start"');
  });

  it('shows a save error', () => {
    expect(html({ error: 'Only managers can add or change review notes' })).toContain('Only managers can add');
  });
});
