import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import FloorReadyPanel from './FloorReadyPanel';

const render = (pointsWithCaptures: number) => renderToStaticMarkup(
  <MemoryRouter>
    <FloorReadyPanel floorLabel="Floor 3" pointsWithCaptures={pointsWithCaptures} onCapture={() => {}} onRecapture={() => {}} historyHref="/h" />
  </MemoryRouter>,
);

describe('FloorReadyPanel', () => {
  it('always says where the person is', () => {
    expect(render(0)).toContain('You are in Floor 3 and ready to capture');
    expect(render(4)).toContain('You are in Floor 3 and ready to capture');
  });

  it('with no previous captures offers only Go to Capture Mode', () => {
    const html = render(0);
    expect(html).toContain('Go to Capture Mode');
    expect(html).not.toContain('Recapture the Floor');
  });

  it('with previous captures offers both Go to Capture Mode and Recapture the Floor, and says nothing is replaced', () => {
    const html = render(4);
    expect(html).toContain('Go to Capture Mode');
    expect(html).toContain('Recapture the Floor');
    expect(html).toContain('4 capture points on this floor already have photos');
    expect(html).toContain('Every previous capture is kept');
  });

  it('uses singular wording for one point', () => {
    expect(render(1)).toContain('1 capture point on this floor already has photos');
  });
});
