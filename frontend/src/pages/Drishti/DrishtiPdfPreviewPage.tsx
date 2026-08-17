import { useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { buildDrishtiChatPdfHtml } from '@/utils/drishtiChatPdf';
import { exportHtmlToPdf } from '@/utils/htmlToPdf';
import { PREVIEW_CONVERSATION, PREVIEW_MESSAGES } from '@/utils/drishtiChatPdf.previewData';

/**
 * Local visual QA page for the Drishti chat PDF redesign.
 * Route: /dev/drishti-pdf-preview
 */
export default function DrishtiPdfPreviewPage() {
  const [html, setHtml] = useState('');
  const [css, setCss] = useState('');
  const [body, setBody] = useState('');
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    const doc = buildDrishtiChatPdfHtml({
      title: PREVIEW_CONVERSATION.title,
      projectName: PREVIEW_CONVERSATION.projectName,
      messages: PREVIEW_MESSAGES,
      conversation: PREVIEW_CONVERSATION,
    });
    setHtml(doc);
    setCss((doc.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || [])[1] || '');
    setBody((doc.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || '');
    setPageCount((doc.match(/class="print-page"/g) || []).length);
  }, []);

  return (
    <Box sx={{ p: 2, background: '#e8edf3', minHeight: '100vh' }}>
      {css ? <style>{css}</style> : null}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography sx={{ fontWeight: 700 }} data-page-count={pageCount}>
          Drishti PDF preview · {pageCount} pages
        </Typography>
        <Button
          variant="contained"
          size="small"
          onClick={() => exportHtmlToPdf(html, 'Drishti-Preview-Report')}
          disabled={!html}
        >
          Download PDF
        </Button>
      </Box>
      {body ? (
        <Box
          id="pdf-preview-root"
          sx={{
            '& .print-page': {
              margin: '0 auto 16px',
              boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
            },
          }}
          dangerouslySetInnerHTML={{ __html: body }}
        />
      ) : null}
    </Box>
  );
}
