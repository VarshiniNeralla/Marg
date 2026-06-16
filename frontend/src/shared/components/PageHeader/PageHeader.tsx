import React from 'react';
import { Box, Breadcrumbs, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { NavigateNext } from '@mui/icons-material';
import { colors } from '@theme/tokens';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
}

export default function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
}: PageHeaderProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: { xs: 'flex-start', sm: 'center' },
        justifyContent: 'space-between',
        flexDirection: { xs: 'column', sm: 'row' },
        gap: 2,
        mb: 3,
      }}
    >
      <Box>
        {/* Breadcrumbs */}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <Breadcrumbs
            separator={<NavigateNext sx={{ fontSize: 14 }} />}
            sx={{ mb: 0.5 }}
          >
            {breadcrumbs.map((crumb, i) => {
              const isLast = i === breadcrumbs.length - 1;
              return isLast ? (
                <Typography
                  key={i}
                  sx={{ fontSize: '0.8125rem', color: colors.textMuted, fontWeight: 500 }}
                >
                  {crumb.label}
                </Typography>
              ) : (
                <Box
                  key={i}
                  component={RouterLink}
                  to={crumb.href ?? '/'}
                  sx={{
                    fontSize: '0.8125rem',
                    color: colors.textMuted,
                    textDecoration: 'none',
                    '&:hover': { color: colors.primary },
                  }}
                >
                  {crumb.label}
                </Box>
              );
            })}
          </Breadcrumbs>
        )}

        {/* Title */}
        <Typography
          component="h1"
          sx={{
            fontSize: '1.5rem',           // --text-page-title
            fontWeight: 600,
            color: colors.textStrong,
            lineHeight: 1.15,             // --leading-tight
            letterSpacing: '-0.02em',     // --tracking-tight
            fontFamily: '"Google Sans Flex", "Google Sans", Inter, Roboto, sans-serif',
          }}
        >
          {title}
        </Typography>

        {/* Subtitle */}
        {subtitle && (
          <Typography
            sx={{
              fontSize: '0.875rem',
              color: colors.textMuted,
              mt: 0.5,
              lineHeight: 1.5,
            }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>

      {/* Actions slot */}
      {actions && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {actions}
        </Box>
      )}
    </Box>
  );
}
