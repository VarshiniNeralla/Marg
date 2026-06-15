import React from 'react';
import { ThemeProvider, CssBaseline, GlobalStyles } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import theme from '@theme/index';
import AppRouter from '@router/index';
import { ErrorBoundary } from '@shared/components/ErrorBoundary/ErrorBoundary';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 min
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <GlobalStyles styles={{
            'body': { WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' },
            '*:focus-visible': {
              outline: '2px solid #2563eb',
              outlineOffset: '2px',
              borderRadius: '4px',
            },
            '*:focus:not(:focus-visible)': { outline: 'none' },
          }} />
          <AppRouter />
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
