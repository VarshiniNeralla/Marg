import { Box, Chip, Typography } from '@mui/material';
import { colors } from '@theme/tokens';

interface Props {
  questions: string[];
  onSelect: (question: string) => void;
}

export default function DrishtiSuggestedQuestions({ questions, onSelect }: Props) {
  if (!questions.length) return null;

  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: colors.textMuted, mb: 1 }}>
        Suggested questions
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {questions.map((q, i) => (
          <Chip
            key={i}
            label={q}
            clickable
            onClick={() => onSelect(q)}
            sx={{
              fontSize: '0.8125rem', color: colors.textStrong,
              backgroundColor: colors.card, border: `1px solid ${colors.border}`,
              '&:hover': { borderColor: colors.primary, backgroundColor: colors.primary + '08' },
            }}
          />
        ))}
      </Box>
    </Box>
  );
}
