export const BRAND = {
  fonts: {
    heading: 'Inter',
    body: 'Inter',
    headingWeights: { light: 300, regular: 400, medium: 500, bold: 700 },
    bodyWeights: { regular: 400, medium: 500 }
  },
  colours: {
    green: '#00C853',
    black: '#1A1A2E',
    white: '#FFFFFF',
    lightGrey: '#F5F5F5',
    midGrey: '#E0E0E0',
    darkNavy: '#0F1629',
    charcoal: '#2D2D3F'
  },
  spacing: {
    pagePaddingMm: 20,
    sectionGapMm: 12,
    lineHeight: 1.5
  },
  logo: {
    position: 'top-right' as const,
    clearSpaceMm: 10
  },
  typography: {
    h1: { size: '28px', weight: 700, letterSpacing: '-0.02em' },
    h2: { size: '22px', weight: 600, letterSpacing: '-0.01em' },
    h3: { size: '18px', weight: 600, letterSpacing: '0' },
    h4: { size: '15px', weight: 600, letterSpacing: '0' },
    body: { size: '11px', weight: 400, lineHeight: '1.6' },
    caption: { size: '9px', weight: 400, lineHeight: '1.4' }
  }
} as const;
