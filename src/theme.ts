import { Platform } from 'react-native';

export const colors = {
  background: '#0B1117', surface: '#121B24', surfaceRaised: '#18232E', surfaceSoft: '#1D2A35', border: '#273743', text: '#F4F7F8', muted: '#8D9BA5', subtle: '#60717C', teal: '#29D3B2', tealDeep: '#123E3C', blue: '#5FA8FF', blueDeep: '#172F4A', amber: '#F4B65F', amberDeep: '#49351C', red: '#FF7474', redDeep: '#4A232A', white: '#FFFFFF',
};
export const spacing = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, xxl: 30 };
export const typography = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800' as const, letterSpacing: -0.4 },
  heading: { fontSize: 19, lineHeight: 24, fontWeight: '800' as const },
  body: { fontSize: 15, lineHeight: 21 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '700' as const, letterSpacing: 0.4 },
};
export const shadow = Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.24, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }, android: { elevation: 4 }, default: {} });