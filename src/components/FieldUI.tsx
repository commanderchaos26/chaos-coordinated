import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadow, spacing, typography } from '../theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 20, color = colors.muted }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'teal' | 'blue' | 'amber' | 'red' }) {
  const toneStyles = { neutral: styles.badgeNeutral, teal: styles.badgeTeal, blue: styles.badgeBlue, amber: styles.badgeAmber, red: styles.badgeRed };
  const textStyles = { neutral: styles.neutralText, teal: styles.badgeTealText, blue: styles.badgeBlueText, amber: styles.badgeAmberText, red: styles.badgeRedText };
  return <View style={[styles.badge, toneStyles[tone]]}><Text style={[styles.badgeText, textStyles[tone]]}>{label}</Text></View>;
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text>{action && <Pressable onPress={onAction} hitSlop={8}><Text style={styles.sectionAction}>{action}</Text></Pressable>}</View>;
}

export function MetricCard({ label, value, icon, tone = 'teal' }: { label: string; value: string; icon: IconName; tone?: 'teal' | 'blue' | 'amber' | 'red' }) {
  const tint = { teal: colors.teal, blue: colors.blue, amber: colors.amber, red: colors.red }[tone];
  return <Card style={styles.metric}><View style={[styles.metricIcon, { backgroundColor: `${tint}1C`, borderColor: `${tint}3A` }]}><Icon name={icon} color={tint} size={17} /></View><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></Card>;
}

export function EmptyState({ icon, title, message }: { icon: IconName; title: string; message: string }) {
  return <Card style={styles.empty}><View style={styles.emptyIcon}><Icon name={icon} color={colors.teal} size={22} /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyMessage}>{message}</Text></Card>;
}

export function ActionTile({ icon, title, subtitle, onPress }: { icon: IconName; title: string; subtitle: string; onPress?: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.actionTile, pressed && styles.pressed]}><View style={styles.actionIcon}><Icon name={icon} color={colors.teal} size={19} /></View><View style={styles.actionCopy}><Text style={styles.actionTitle}>{title}</Text><Text style={styles.actionSubtitle}>{subtitle}</Text></View><Icon name="chevron-forward" color={colors.subtle} size={18} /></Pressable>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow,
  },
  badge: { alignSelf: 'flex-start', borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.1 },
  badgeNeutral: { backgroundColor: colors.surfaceSoft, borderColor: colors.border },
  badgeTeal: { backgroundColor: colors.tealDeep, borderColor: '#1D6B60' },
  badgeBlue: { backgroundColor: colors.blueDeep, borderColor: '#285B7D' },
  badgeAmber: { backgroundColor: colors.amberDeep, borderColor: '#745021' },
  badgeRed: { backgroundColor: colors.redDeep, borderColor: '#73313D' },
  neutralText: { color: colors.muted },
  badgeTealText: { color: colors.tealBright },
  badgeBlueText: { color: colors.blue },
  badgeAmberText: { color: colors.amber },
  badgeRedText: { color: colors.red },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md, marginTop: 2 },
  sectionTitle: { color: colors.text, ...typography.heading },
  sectionAction: { color: colors.teal, fontSize: 13, fontWeight: '800' },
  metric: { flex: 1, minHeight: 116, padding: spacing.md },
  metricIcon: { alignItems: 'center', borderRadius: radius.sm, borderWidth: 1, height: 32, justifyContent: 'center', width: 32 },
  metricValue: { color: colors.text, fontSize: 27, fontWeight: '900', letterSpacing: -0.4, marginTop: spacing.sm },
  metricLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 2 },
  empty: { alignItems: 'center', padding: spacing.xl },
  emptyIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderColor: '#1D6B60', borderRadius: radius.pill, borderWidth: 1, height: 46, justifyContent: 'center', marginBottom: spacing.md, width: 46 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  emptyMessage: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: 'center' },
  actionTile: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', minHeight: 70, padding: spacing.md },
  actionIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderColor: '#1D6B60', borderRadius: radius.sm, borderWidth: 1, height: 40, justifyContent: 'center', width: 40 },
  actionCopy: { flex: 1, marginLeft: spacing.md },
  actionTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  actionSubtitle: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  pressed: { opacity: 0.74, transform: [{ scale: 0.995 }] },
});
