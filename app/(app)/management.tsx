import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionTile, Icon } from '../../src/components/FieldUI';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import type { Membership } from '../../src/types/app';
import { colors, spacing, typography } from '../../src/theme';

const canManagePeople = (membership: Membership | null) => Boolean(membership?.roles.some((role) => role === 'owner' || role === 'operations_manager'));
const canUseOperations = (membership: Membership | null) => Boolean(membership?.roles.some((role) => ['owner', 'operations_manager', 'supervisor', 'dispatcher'].includes(role)));

export default function ManagementScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [platformControl, setPlatformControl] = useState(false);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const current = await loadMembership();
        if (!mounted) return;
        setMembership(current);
        if (!current) return;
        const { data, error } = await supabase.functions.invoke('platform-license-control', {
          body: { action: 'status', company_id: current.companyId },
        });
        if (mounted) setPlatformControl(!error && Boolean(data?.authorized));
      } catch {
        if (mounted) setMembership(null);
      }
    })();
    return () => { mounted = false; };
  }, []);

  return <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}><View style={styles.header}><View><Text style={styles.eyebrow}>CONTROL ROOM</Text><Text style={styles.title}>Management center</Text></View><View style={styles.headerIcon}><Icon name="settings-outline" color={colors.teal} size={22} /></View></View><Text style={styles.intro}>Keep people, coverage, locations, and field operations aligned from one place.</Text>{canUseOperations(membership) ? <><Pressable style={({ pressed }) => [styles.invite, pressed && styles.pressed]} onPress={() => router.push('/invite-employee')}>
    <View style={styles.inviteIcon}><Icon name="person-add-outline" color={colors.background} size={20} /></View><View style={styles.inviteCopy}><Text style={styles.inviteTitle}>Invite an employee</Text><Text style={styles.inviteText}>Create access for a new technician</Text></View><Icon name="arrow-forward" color={colors.background} size={20} /></Pressable><Text style={styles.sectionLabel}>Operations directory</Text><View style={styles.tiles}><ActionTile icon="people-outline" title="Employees" subtitle="Team roster and roles" onPress={() => canManagePeople(membership) ? router.push('/(app)/employees' as never) : undefined} /><ActionTile icon="business-outline" title="Departments" subtitle="Organize teams and coverage" onPress={() => router.push('/(app)/departments' as never)} /><ActionTile icon="git-network-outline" title="Crews" subtitle="Group field coverage" onPress={() => router.push('/(app)/crews' as never)} /><ActionTile icon="calendar-outline" title="Schedule & exceptions" subtitle="Default workweek, time off, restrictions" onPress={() => router.push('/(app)/availability' as never)} />{canManagePeople(membership) ? <ActionTile icon="document-text-outline" title="Payroll & timecards" subtitle="Thursday payroll files and employee hours" onPress={() => router.push('/(app)/payroll' as never)} /> : null}<ActionTile icon="navigate-outline" title="Dispatch" subtitle="Assignments and routing" onPress={() => router.push('/(app)/dispatch' as never)} /><ActionTile icon="ribbon-outline" title="Skills" subtitle="Certifications and capabilities" onPress={() => canManagePeople(membership) ? router.push('/(app)/skills' as never) : undefined} />{canManagePeople(membership) ? <><ActionTile icon="briefcase-outline" title="Client Portal" subtitle="Clients, contracts, and Turn List Import" onPress={() => router.push('/(app)/clients' as never)} /><ActionTile icon="shield-checkmark-outline" title="AI Walkthrough access" subtitle="Choose which employee profiles can use AI inspections" onPress={() => router.push('/(app)/ai-access' as never)} /><ActionTile icon="location-outline" title="Properties & geofences" subtitle="Properties, buildings, units, and worksite boundaries" onPress={() => router.push('/(app)/properties' as never)} />{platformControl ? <ActionTile icon="key-outline" title="Platform QA & license" subtitle="Private test tooling and non-destructive suspension control" onPress={() => router.push('/(app)/platform-control' as never)} /> : null}</> : null}</View></> : <View style={styles.locked}><Icon name="lock-closed-outline" color={colors.amber} size={24} /><Text style={styles.lockedTitle}>Management access required</Text><Text style={styles.lockedText}>Your current role does not include operations management controls.</Text></View>}</ScrollView>;
}

const styles = StyleSheet.create({ root: { backgroundColor: colors.background, gap: spacing.lg, padding: spacing.lg, paddingBottom: 110 }, header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm }, eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }, title: { color: colors.text, ...typography.title, marginTop: 4 }, headerIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 44, justifyContent: 'center', width: 44 }, intro: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: -spacing.sm }, invite: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 16, flexDirection: 'row', minHeight: 76, padding: spacing.md }, inviteIcon: { alignItems: 'center', backgroundColor: '#FFFFFF55', borderRadius: 11, height: 42, justifyContent: 'center', width: 42 }, inviteCopy: { flex: 1, marginLeft: spacing.md }, inviteTitle: { color: colors.background, fontSize: 15, fontWeight: '800' }, inviteText: { color: '#0B1117AA', fontSize: 12, marginTop: 3 }, sectionLabel: { color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, marginBottom: -spacing.sm, textTransform: 'uppercase' }, tiles: { gap: spacing.sm }, locked: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 18, borderWidth: 1, padding: spacing.xxl }, lockedTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: spacing.md }, lockedText: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: 'center' }, pressed: { opacity: 0.78 } });