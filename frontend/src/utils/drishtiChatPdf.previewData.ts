/**
 * Offline preview harness for Drishti chat PDF layout.
 * Open via Vite: import and call from a temporary console, or run:
 *   node --experimental-vm-modules is not enough (needs DOM).
 *
 * Used by scripts/preview-drishti-pdf.mjs through Playwright when available.
 */
import type { DrishtiConversationDetail, DrishtiMessage } from '@/types/drishti';

export const PREVIEW_MESSAGES: DrishtiMessage[] = [
  {
    messageId: 'u1', role: 'user', createdAt: '2026-08-17T08:50:00.000Z',
    content: 'What is the overall project progress?',
    structuredPayload: null,
  },
  {
    messageId: 'a1', role: 'assistant', createdAt: '2026-08-17T08:50:05.000Z',
    content: 'Overall project progress is 2.0%.',
    structuredPayload: {
      answer: 'Overall project progress is 2.0%.',
      scope: { towerId: null, towerName: null, floorId: null, floorName: null, flatName: null, roomName: null },
      facts: [
        'Overall project progress is 2.0%.',
        '1 floor has been analyzed.',
        '9 floors have not yet been analyzed.',
      ],
      insights: [
        'The current progress percentage is heavily influenced by the fact that only 10% of the floors have been analyzed.',
      ],
      recommendations: [
        'Prioritise capture and analysis on remaining floors before treating 2.0% as a project-wide completion signal.',
      ],
      metrics: [
        { label: 'Overall Project Progress', value: '2.0%', trend: null },
        { label: 'Floors Analysed', value: '1 / 10', trend: null },
        { label: 'Room Capture Coverage', value: '8.6%', trend: null },
        { label: 'Rooms Captured', value: '8 / 93', trend: null },
        { label: 'Activities Assessed', value: '88', trend: null },
      ],
      evidence: [],
      followUpQuestions: [
        'Which floors have not been analysed yet?',
        'What is progress on the analysed floor?',
      ],
    },
  },
  {
    messageId: 'u2', role: 'user', createdAt: '2026-08-17T08:51:00.000Z',
    content: 'Which activities are being tracked?',
    structuredPayload: null,
  },
  {
    messageId: 'a2', role: 'assistant', createdAt: '2026-08-17T08:51:05.000Z',
    content: `The following activities are currently pending in the Lift Lobby:

* **Wall Punning Works**: 60% complete
* **MEP Works**: 20% complete
* **False Ceiling Works**: 15% complete

These activities are still in progress and require further attention to reach completion.`,
    structuredPayload: {
      answer: `The following activities are currently pending in the Lift Lobby:

* **Wall Punning Works**: 60% complete
* **MEP Works**: 20% complete
* **False Ceiling Works**: 15% complete

These activities are still in progress and require further attention to reach completion.`,
      scope: { towerId: null, towerName: null, floorId: null, floorName: null, flatName: null, roomName: 'Lift Lobby' },
      facts: [
        '**Wall Punning Works** is 60% complete.',
        '**MEP Works** is 20% complete.',
      ],
      insights: ['Lift Lobby finishing remains incomplete across multiple work streams.'],
      recommendations: [],
      metrics: [
        { label: 'Wall Punning Works', value: '60%', trend: null },
        { label: 'MEP Works', value: '20%', trend: null },
        { label: 'False Ceiling Works', value: '15%', trend: null },
      ],
      evidence: [],
      followUpQuestions: ['Which rooms have not been captured yet?'],
    },
  },
  {
    messageId: 'u3', role: 'user', createdAt: '2026-08-17T08:52:00.000Z',
    content: 'Which rooms have not been captured yet?',
    structuredPayload: null,
  },
  {
    messageId: 'a3', role: 'assistant', createdAt: '2026-08-17T08:52:05.000Z',
    content: `The following rooms have not been captured yet on the analysed floor.

Flat 01: Bedroom-2, Bedroom-3, Kitchen, Living/Dining, Lobby, Toilet-1, Toilet-2, Balcony, Dress, Utility
Flat 02: Balcony, Bedroom-2, Bedroom-3, Kitchen, Living/Dining, Lobby, Toilet-1
Flat 03: Bedroom-1, Bedroom-2, Kitchen, Living/Dining, Lobby, Toilet-1, Toilet-2, Balcony
Flat 04: Bedroom-2, Bedroom-3, Kitchen, Living/Dining, Lobby, Dress, Utility
Flat 05: Balcony, Bedroom-1, Bedroom-2, Kitchen, Living/Dining, Lobby, Toilet-1`,
    structuredPayload: {
      answer: `The following rooms have not been captured yet on the analysed floor.

Flat 01: Bedroom-2, Bedroom-3, Kitchen, Living/Dining, Lobby, Toilet-1, Toilet-2, Balcony, Dress, Utility
Flat 02: Balcony, Bedroom-2, Bedroom-3, Kitchen, Living/Dining, Lobby, Toilet-1
Flat 03: Bedroom-1, Bedroom-2, Kitchen, Living/Dining, Lobby, Toilet-1, Toilet-2, Balcony
Flat 04: Bedroom-2, Bedroom-3, Kitchen, Living/Dining, Lobby, Dress, Utility
Flat 05: Balcony, Bedroom-1, Bedroom-2, Kitchen, Living/Dining, Lobby, Toilet-1`,
      scope: { towerId: null, towerName: null, floorId: null, floorName: null, flatName: null, roomName: null },
      facts: ['Multiple flats still have rooms pending capture.'],
      insights: ['Capture coverage remains the primary blocker to reliable progress measurement.'],
      recommendations: ['Schedule a systematic capture pass by flat.'],
      metrics: [{ label: 'Rooms Captured', value: '8 / 93', trend: null }],
      evidence: [],
      followUpQuestions: ['What is the status of the Lift Lobby?'],
    },
  },
  {
    messageId: 'u4', role: 'user', createdAt: '2026-08-17T08:53:00.000Z',
    content: 'What is the status of the Lift Lobby?',
    structuredPayload: null,
  },
  {
    messageId: 'a4', role: 'assistant', createdAt: '2026-08-17T08:53:05.000Z',
    content: 'The Lift Lobby is configured, but it has not been captured yet.',
    structuredPayload: {
      answer: 'The Lift Lobby is configured, but it has not been captured yet.',
      scope: { towerId: null, towerName: null, floorId: null, floorName: null, flatName: null, roomName: 'Lift Lobby' },
      facts: ['Lift Lobby is configured for common area finishing.'],
      insights: [],
      recommendations: ['Capture the Lift Lobby to unlock activity assessment.'],
      metrics: [],
      evidence: [],
      followUpQuestions: ['What other activities are pending in the Lift Lobby?'],
    },
  },
  {
    messageId: 'u5', role: 'user', createdAt: '2026-08-17T08:54:00.000Z',
    content: 'What other activities are pending in the Lift Lobby?',
    structuredPayload: null,
  },
  {
    messageId: 'a5', role: 'assistant', createdAt: '2026-08-17T08:54:05.000Z',
    content: 'The Lift Lobby is configured, but it has not been captured yet.',
    structuredPayload: {
      answer: 'The Lift Lobby is configured, but it has not been captured yet.',
      scope: { towerId: null, towerName: null, floorId: null, floorName: null, flatName: null, roomName: 'Lift Lobby' },
      facts: ['No photo evidence is available for Lift Lobby activities.'],
      insights: [],
      recommendations: [],
      metrics: [],
      evidence: [],
      followUpQuestions: [],
    },
  },
  {
    messageId: 'u6', role: 'user', createdAt: '2026-08-17T08:55:00.000Z',
    content: 'Is tiling configured for this project?',
    structuredPayload: null,
  },
  {
    messageId: 'a6', role: 'assistant', createdAt: '2026-08-17T08:55:05.000Z',
    content: 'Tiling is not configured for this project.',
    structuredPayload: {
      answer: 'Tiling is not configured for this project.',
      scope: { towerId: null, towerName: null, floorId: null, floorName: null, flatName: null, roomName: null },
      facts: ['Tiling is not configured.'],
      insights: [],
      recommendations: [],
      metrics: [],
      evidence: [],
      followUpQuestions: [],
    },
  },
];

export const PREVIEW_CONVERSATION: DrishtiConversationDetail = {
  conversationId: 'preview',
  projectId: 'p1',
  projectName: 'Project A',
  title: 'What is the overall project progress?',
  updatedAt: '2026-08-17T09:14:00.000Z',
  createdAt: '2026-08-17T08:50:00.000Z',
  scope: { towerId: null, towerName: null, floorId: null, floorName: null, flatName: null, roomName: null },
  messages: PREVIEW_MESSAGES,
};
