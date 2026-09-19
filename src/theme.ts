import { Platform } from 'react-native';

export const colors = {
  background: '#07131C',
  canvas: '#081823',
  surface: '#0D1E29',
  surfaceRaised: '#122633',
  surfaceSoft: '#18313F',
  border: '#254352',
  borderStrong: '#315666',
  text: '#F4F9FB',
  muted: '#9AAAB5',
  subtle: '#657D8B',
  teal: '#32D4B3',
  tealBright: '#5BE5C9',
  tealDeep: '#0A3B37',
  blue: '#55B7FF',
  blueDeep: '#103753',
  amber: '#FFB84D',
  amberDeep: '#4B3415',
  red: '#FF6673',
  redDeep: '#49212A',
  white: '#FFFFFF',
  nav: '#091722',
  scrim: 'rgba(2, 10, 15, 0.76)',
};

export const spacing = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, xxl: 30 };

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 };

export const typography = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '900' as const, letterSpacing: -0.5 },
  heading: { fontSize: 19, lineHeight: 24, fontWeight: '800' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 21 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '700' as const, letterSpacing: 0.35 },
};

export const shadow = Platform.select({
  ios: {
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  android: { elevation: 5 },
  default: {},
});
