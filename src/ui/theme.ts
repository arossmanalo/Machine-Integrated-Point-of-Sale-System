/*
 * A counter tool for a family laundry shop: calm slate neutrals tinted toward blue, one clear
 * blue for the action that matters on each screen, large touch targets, and numbers that are
 * readable at arm's length. Every colour, size and gap in the app comes from this file.
 */

export const colors = {
  background: '#F3F5F8',
  surface: '#FFFFFF',
  surfaceSunken: '#E9EDF2',
  border: '#D7DEE7',
  text: '#16202D',
  textMuted: '#566274',
  textOnAccent: '#FFFFFF',
  accent: '#2563EB',
  accentPressed: '#1D4ED8',
  accentSoft: '#E6EEFD',
  success: '#0F7A4A',
  successSoft: '#E3F3EA',
  warning: '#8F5600',
  warningSoft: '#FCF0DA',
  danger: '#B42318',
  dangerSoft: '#FCE9E7',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 12,
} as const;

export const fonts = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
} as const;

export const type = {
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  body: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 25 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 25 },
  heading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  title: { fontFamily: fonts.semibold, fontSize: 26, lineHeight: 32, letterSpacing: -0.3 },
  figure: { fontFamily: fonts.semibold, fontSize: 32, lineHeight: 38, letterSpacing: -0.5 },
} as const;

/** Only for things that float above the page: dialogs and the toast. */
export const elevation = {
  shadowColor: '#0B1220',
  shadowOpacity: 0.18,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 8,
} as const;

export const MIN_TOUCH = 48;
export const CONTENT_MAX_WIDTH = 920;
