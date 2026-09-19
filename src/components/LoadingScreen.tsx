import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { BrandMark } from './BrandMark';
import { colors, spacing } from '../theme';

export function LoadingScreen({ label = 'Coordinating field operations…' }: { label?: string }) {
  return (
    <View style={styles.root}>
      <View style={[styles.gridLine, styles.gridOne]} />
      <View style={[styles.gridLine, styles.gridTwo]} />
      <View style={[styles.gridLineVertical, styles.gridThree]} />
      <View style={[styles.gridLineVertical, styles.gridFour]} />

      <View style={styles.brandBlock}>
        <BrandMark size={86} />
        <Text style={styles.brandName}><Text style={styles.brandChaos}>Chaos </Text><Text style={styles.brandCoordinated}>Coordinated</Text></Text>
        <Text style={styles.tagline}>ORDER OUT OF CHAOS.</Text>
        <Text style={styles.descriptor}>AI-DRIVEN TURNOVERS · WORK ORDERS · WORKFORCE</Text>
      </View>

      <View style={styles.loading}>
        <ActivityIndicator size="small" color={colors.teal} />
        <Text style={styles.label}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', overflow: 'hidden', padding: spacing.xl },
  brandBlock: { alignItems: 'center', maxWidth: 360, width: '100%' },
  brandName: { color: colors.text, fontSize: 31, fontWeight: '900', letterSpacing: -1, marginTop: spacing.lg, textAlign: 'center' },
  brandChaos: { color: colors.text },
  brandCoordinated: { color: colors.tealBright },
  tagline: { color: colors.text, fontSize: 12, fontWeight: '900', letterSpacing: 2, marginTop: spacing.sm },
  descriptor: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, lineHeight: 16, marginTop: spacing.sm, textAlign: 'center' },
  loading: { alignItems: 'center', bottom: 54, gap: spacing.sm, position: 'absolute' },
  label: { color: colors.subtle, fontSize: 12, fontWeight: '700' },
  gridLine: { backgroundColor: '#16303B', height: 1, opacity: 0.55, position: 'absolute', width: '130%' },
  gridLineVertical: { backgroundColor: '#16303B', height: '130%', opacity: 0.5, position: 'absolute', width: 1 },
  gridOne: { top: '28%', transform: [{ rotate: '-8deg' }] },
  gridTwo: { bottom: '26%', transform: [{ rotate: '6deg' }] },
  gridThree: { left: '22%', transform: [{ rotate: '9deg' }] },
  gridFour: { right: '20%', transform: [{ rotate: '-7deg' }] },
});
