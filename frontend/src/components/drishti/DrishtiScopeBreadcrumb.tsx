import { Box, Typography } from '@mui/material';
import { ChevronRightRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import type { DrishtiScope } from '@/types/drishti';

interface Props {
  projectName: string;
  scope: DrishtiScope;
}

/** Read-only display of the server-resolved conversation scope — never an
 * editable client-side filter. The backend re-derives scope every turn from
 * the question + conversation history, so the client only shows what it
 * last resolved rather than owning its own copy of "current scope". */
export default function DrishtiScopeBreadcrumb({ projectName, scope }: Props) {
  const crumbs = [
    projectName,
    scope.towerName,
    scope.floorName,
    scope.flatName,
    scope.roomName,
  ].filter((c): c is string => !!c);

  if (crumbs.length <= 1) {
    return (
      <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{projectName}</Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.25 }}>
      {crumbs.map((c, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          {i > 0 && <ChevronRightRounded sx={{ fontSize: 14, color: colors.textSubdued }} />}
          <Typography sx={{
            fontSize: '0.75rem',
            color: i === crumbs.length - 1 ? colors.textStrong : colors.textMuted,
            fontWeight: i === crumbs.length - 1 ? 700 : 500,
          }}>
            {c}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
