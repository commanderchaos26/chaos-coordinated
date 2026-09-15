import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';

export function LoadingScreen({ label = 'Coordinating chaos…' }: { label?: string }) {
  return (
    <View style={styles.root}>
      <View style={styles.mark}><ActivityIndicator size="small" color={colors.teal} /></View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', backgroundColor: colors.background, flex: 1, gap: spacing.lg, justifyContent: 'center', padding: spacing.xl },
  mark: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 58, justifyContent: 'center', width: 58 },
  label: { color: colors.muted, fontSize: 15 },
});
