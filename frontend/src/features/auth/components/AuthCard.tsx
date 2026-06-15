import React from 'react';
import { Box, Typography } from '@mui/material';

interface AuthCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export default function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f1f5f9',
        px: 2,
        py: 4,
      }}
    >
      {/* Single unified card — matches the reference exactly */}
      <Box
        sx={{
          width: '100%',
          maxWidth: 360,
          backgroundColor: '#ffffff',
          borderRadius: '20px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
          px: '36px',
          pt: '40px',
          pb: '36px',
        }}
      >
        {/* ── Brand block ── */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: subtitle ? 0 : '28px' }}>

          {/* Horizontal lockup: logo + text stack side by side */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mb: subtitle ? '12px' : '12px' }}>
            {/* Logo mark */}
            <Box
              component="img"
              src="/assets/new_logo.png"
              alt="My Home Group"
              sx={{ width: 38, height: 38, objectFit: 'contain', flexShrink: 0 }}
            />

            {/* Text column: wordmark + endorsement */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {/* Wordmark */}
              <Typography
                sx={{
                  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  fontWeight: 600,
                  fontSize: '1.45rem',
                  lineHeight: 0.95,
                  color: '#111827',
                  letterSpacing: '-0.055em',
                  WebkitFontSmoothing: 'antialiased',
                  MozOsxFontSmoothing: 'grayscale',
                }}
              >
                {title}
              </Typography>

            </Box>
          </Box>

          {/* Tagline / subtitle */}
          {subtitle && (
            <Typography
              sx={{
                fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                fontSize: '0.875rem',
                fontWeight: 500,
                fontStyle: 'normal',
                color: '#64748b',
                lineHeight: 1.45,
                textAlign: 'center',
                maxWidth: '300px',
                m: '0 auto 1.5rem',
              }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>

        {/* ── Form content ── */}
        {children}

        {/* ── Footer ── */}
        {footer && (
          <Box
            sx={{
              mt: '20px',
              textAlign: 'center',
              fontSize: '0.875rem',
              fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
              color: '#6b7280',
              lineHeight: 1.5,
            }}
          >
            {footer}
          </Box>
        )}
      </Box>
    </Box>
  );
}
