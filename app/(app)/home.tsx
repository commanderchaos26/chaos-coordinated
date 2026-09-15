import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionTile, Card, EmptyState, Icon, MetricCard, SectionHeader } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { useAuth } from '../../src/context/AuthProvider';
import { completeAdmission, loadMembership } from '../../src/lib/membership';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

export default function HomeScreen() {
  const { signOut } = useAuth();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { await completeAdmission(); } catch {}
      try { setMembership(await loadMembership()); } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <LoadingScreen label="Loading your workspace…" />;

  return (
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <View style={styles.header}><View><Text style={styles.eyebrow}>{membership?.companyName ?? 'CHAOS COORDINATED'}</Text><Text style={styles.title}>Good morning, {membership?.displayName?.split(' ')[0] ?? 'team'}</Text><Text style={styles.roles}>{membership?.roles.join('  •  ') || 'Workspace overview'}</Text></View><Pressable onPress={signOut} style={styles.profileButton}><Icon name="person-outline" color={colors.teal} size={21} /></Pressable></View>
      <View style={styles.metrics}><MetricCard icon="briefcase-outline" label="Open work" value="0" /><MetricCard icon="sync-outline" label="In progress" value="0" tone="blue" /><MetricCard icon="alert-circle-outline" label="Needs attention" value="0" tone="amber" /></View>
      <SectionHeader title="Today's work" action="View all" onAction={() => router.push('/work-orders')} />
      <EmptyState icon="checkmark-done-outline" title="Clear runway" message="Assigned work and upcoming handoffs will appear here when your team is dispatched." />
      <SectionHeader title="Priority alerts" />
      <Card style={styles.alertCard}><View style={styles.alertIcon}><Icon name="shield-checkmark-outline" color={colors.blue} size={20} /></View><View style={styles.alertCopy}><Text style={styles.alertTitle}>No active blockers</Text><Text style={styles.alertText}>Your operation is clear of urgent exceptions.</Text></View><Icon name="chevron-forward" color={colors.subtle} size={18} /></Card>
      <SectionHeader title="Active turnovers" action="Open board" onAction={() => router.push('/turnovers')} />
      <EmptyState icon="home-outline" title="No active turnovers" message="Turnover progress, blockers, and target dates will be tracked here." />
      <SectionHeader title="Quick actions" />
      <View style={styles.actions}><ActionTile icon="construct-outline" title="Review work orders" subtitle="See your dispatch queue" onPress={() => router.push('/work-orders')} /><ActionTile icon="sync-outline" title="Track turnovers" subtitle="Monitor unit readiness" onPress={() => router.push('/turnovers')} /><ActionTile icon="people-outline" title="Management center" subtitle="People and operations" onPress={() => router.push('/management')} /></View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, gap: spacing.lg, padding: spacing.lg, paddingBottom: 110 }, header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm }, eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: spacing.xs }, title: { color: colors.text, ...typography.title }, roles: { color: colors.muted, fontSize: 13, marginTop: 5 }, profileButton: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 44, justifyContent: 'center', width: 44 }, metrics: { flexDirection: 'row', gap: spacing.sm }, alertCard: { alignItems: 'center', flexDirection: 'row', padding: spacing.md }, alertIcon: { alignItems: 'center', backgroundColor: colors.blueDeep, borderRadius: 11, height: 40, justifyContent: 'center', width: 40 }, alertCopy: { flex: 1, marginLeft: spacing.md }, alertTitle: { color: colors.text, fontSize: 14, fontWeight: '800' }, alertText: { color: colors.muted, fontSize: 12, marginTop: 3 }, actions: { gap: spacing.sm },
});
