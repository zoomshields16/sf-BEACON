// BEACON design tokens.
// One loud color (State Farm red) used for action and danger; everything else stays quiet.

export const color = {
  red: '#D62311', // primary actions, active alerts
  redDeep: '#8E1A10', // emergency takeover background
  redTint: '#FBE9E7', // soft fill behind red content
  ink: '#2A2220', // primary text
  inkSoft: '#6B605D', // secondary text
  line: '#E6E1DF', // dividers, input borders
  paper: '#F6F4F3', // app background
  white: '#FFFFFF',
  safe: '#1F7A4D', // "all clear", "I'm safe"
  safeTint: '#E5F2EB',
  watch: '#A35F00', // watches / advisories
  watchTint: '#FBF0DF',
} as const;

export const font = {
  regular: 'PublicSans_400Regular',
  medium: 'PublicSans_500Medium',
  semibold: 'PublicSans_600SemiBold',
  bold: 'PublicSans_700Bold',
  black: 'PublicSans_800ExtraBold',
} as const;

// Type scale (roughly a 1.25 ratio, rounded for screens)
export const type = {
  display: { fontFamily: font.black, fontSize: 34, lineHeight: 38, letterSpacing: -0.6 },
  title: { fontFamily: font.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  heading: { fontFamily: font.bold, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 23 },
  bodyStrong: { fontFamily: font.semibold, fontSize: 16, lineHeight: 23 },
  small: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  smallStrong: { fontFamily: font.semibold, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: font.medium, fontSize: 12, lineHeight: 16 },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

// Radii carry hierarchy: big surfaces are softer, controls are tighter.
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;
