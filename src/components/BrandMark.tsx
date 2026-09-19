import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export function BrandMark({ size = 72 }: { size?: number }) {
  const rail = Math.max(2, Math.round(size * 0.035));
  return (
    <View style={[styles.shell, { width: size, height: size, borderRadius: size * 0.24 }]}>
      <View style={[styles.blueprintCorner, styles.cornerTopLeft, { width: size * 0.25, height: size * 0.25, borderWidth: rail }]} />
      <View style={[styles.blueprintCorner, styles.cornerBottomRight, { width: size * 0.25, height: size * 0.25, borderWidth: rail }]} />
      <View style={[styles.link, { width: size * 0.46, height: rail }]} />
      <Text style={[styles.letters, { fontSize: size * 0.31, lineHeight: size * 0.36 }]}>CC</Text>
      <View style={[styles.node, { width: size * 0.09, height: size * 0.09, borderRadius: size * 0.045 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  letters: { color: colors.text, fontWeight: '900', letterSpacing: -1 },
  link: { backgroundColor: colors.teal, borderRadius: 99, position: 'absolute', transform: [{ rotate: '-36deg' }] },
  node: { backgroundColor: colors.tealBright, position: 'absolute', right: '17%', top: '17%' },
  blueprintCorner: { borderColor: colors.teal, position: 'absolute' },
  cornerTopLeft: { borderBottomWidth: 0, borderRightWidth: 0, left: '12%', top: '12%' },
  cornerBottomRight: { borderLeftWidth: 0, borderTopWidth: 0, bottom: '12%', right: '12%' },
});
