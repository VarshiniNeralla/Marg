import React from 'react';
import { Box, Typography } from '@mui/material';
import type { ActivityAssessment } from '@/services/constructionProgressService';
import ActivityCard from './ActivityCard';

const P = { strong: '#111827', muted: '#6b7280' };

function Section({ title, activities }: { title: string; activities: ActivityAssessment[] }) {
  if (activities.length === 0) return null;
  const sorted = [...activities].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  return (
    <Box sx={{ mb: 3 }}>
      <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: P.strong, mb: 1.5 }}>
        {title}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
        {sorted.map(activity => (
          <ActivityCard key={activity.activityId} activity={activity} />
        ))}
      </Box>
    </Box>
  );
}

export default function ActivitySection({ activities }: { activities: ActivityAssessment[] }) {
  const flat = activities.filter(a => a.section === 'flat');
  const common = activities.filter(a => a.section === 'common');

  return (
    <Box>
      <Section title="Flat Finishing Works" activities={flat} />
      <Section title="Common Area Finishing Works" activities={common} />
    </Box>
  );
}
