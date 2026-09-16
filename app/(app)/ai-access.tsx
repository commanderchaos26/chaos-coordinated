import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Badge, Card, Icon } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { loadEmployeeDirectory } from '../../src/lib/employeeData';
import { setEmployeeFeaturePermission } from '../../src/lib/featurePermissionCommands';
import { loadMembership } from '../../src/lib/membership';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type DirectoryData = Awaited<ReturnType<typeof loadEmployeeDirectory>>;
const canManage = (membership: Membership | null) => Boolean(membership?.roles.some((role) => role === 'owner' || role === 'operations_manager'));

export default function AiAccessScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [data, setData] = useState<DirectoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingEmployeeId, setSavingEmployeeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (current && canManage(current)) setData(await loadEmployeeDirectory(current.companyId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load AI access settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const activeEmployees = useMemo(() => (data?.employees ?? []).filter((employee) => employee.employment_status === 'active'), [data]);

  const hasAccess = (employeeId: string) => Boolean(data?.featurePermissions.some((permission) => permission.employee_id === employeeId && permission.permission_key === 'ai_walkthrough'));

  const toggle = async (employeeId: string, enabled: boolean) => {
    if (!membership || savingEmployeeId) return;
    setSavingEmployeeId(employeeId);
    setError(null);
    try {
      await setEmployeeFeaturePermission({
        companyId: membership.companyId,
        employeeId,
        permissionKey: 'ai_walkthrough',
        enabled,
      });
      setData(await loadEmployeeDirectory(membership.companyId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update AI walkthrough access.');
    } finally {
      setSavingEmployeeId(null);
    }
  };

  if (loading) return <LoadingScreen label="Loading AI access..." />;
  if (!canManage(membership)) return <Message title="Management access required" message="Only the Owner or Operations Manager can grant AI Walkthrough access." />;

  return <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
    <View style={styles.topbar}><Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>SECURITY & ACCESS</Text><Text style={styles.title}>AI Walkthrough access</Text></View><View style={styles.headerIcon}><Icon name="shield-checkmark-outline" color={colors.teal} size={22} /></View></View>

    <Card style={styles.infoCard}><Text style={styles.infoTitle}>Explicit permission only</Text><Text style={styles.infoText}>A job title or normal technician account does not automatically unlock AI Walkthrough. Turn access on only for employees authorized to inspect units or create work from walkthroughs.</Text></Card>

    {error ? <Card style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></Card> : null}

    <Text style={styles.sectionLabel}>Active employee profiles</Text>
    <View style={styles.list}>{activeEmployees.map((employee) => {
      const enabled = hasAccess(employee.id);
      const busy = savingEmployeeId === employee.id;
      const roles = data?.roles.filter((role) => role.employee_id === employee.id).map((role) => role.role.replaceAll('_', ' ')) ?? [];
      return <Card key={employee.id} style={styles.employeeCard}><View style={styles.employeeRow}><View style={styles.avatar}><Text style={styles.avatarText}>{employee.display_name.split(' ').map((part) => part[0]).join('').slice(0,2).toUpperCase()}</Text></View><View style={styles.employeeCopy}><Text style={styles.employeeName}>{employee.display_name}</Text><Text style={styles.employeeMeta}>{roles.length ? roles.join(', ') : 'No active role'}</Text><View style={styles.badgeRow}><Badge label={enabled ? 'AI authorized' : 'AI locked'} tone={enabled ? 'teal' : 'amber'} /></View></View><Switch disabled={busy} value={enabled} onValueChange={(value) => void toggle(employee.id, value)} trackColor={{ false: colors.surfaceSoft, true: colors.tealDeep }} thumbColor={enabled ? colors.teal : colors.muted} /></View></Card>;
    })}</View>

    {!activeEmployees.length ? <Card><Text style={styles.emptyText}>No active employee profiles are available.</Text></Card> : null}

    <Card style={styles.auditCard}><Icon name="document-text-outline" color={colors.blue} size={21} /><View style={styles.auditCopy}><Text style={styles.auditTitle}>Every change is audited</Text><Text style={styles.auditText}>Granting or revoking this permission is recorded with who changed it and when.</Text></View></Card>
  </ScrollView>;
}

function Message({ title, message }: { title: string; message: string }) {
  return <View style={styles.message}><Icon name="lock-closed-outline" color={colors.amber} size={28} /><Text style={styles.messageTitle}>{title}</Text><Text style={styles.messageText}>{message}</Text><Pressable onPress={() => router.back()} style={styles.done}><Text style={styles.doneText}>Back</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flexGrow: 1, gap: spacing.md, padding: spacing.lg, paddingBottom: 110 },
  topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm },
  back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  headerCopy: { flex: 1, marginLeft: spacing.md },
  eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: colors.text, ...typography.title, marginTop: 3 },
  headerIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 44, justifyContent: 'center', width: 44 },
  infoCard: { padding: spacing.lg },
  infoTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  infoText: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: spacing.sm },
  sectionLabel: { color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  list: { gap: spacing.sm },
  employeeCard: { padding: spacing.md },
  employeeRow: { alignItems: 'center', flexDirection: 'row' },
  avatar: { alignItems: 'center', backgroundColor: colors.surfaceSoft, borderRadius: 999, height: 46, justifyContent: 'center', width: 46 },
  avatarText: { color: colors.text, fontSize: 14, fontWeight: '900' },
  employeeCopy: { flex: 1, marginHorizontal: spacing.md },
  employeeName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  employeeMeta: { color: colors.muted, fontSize: 12, marginTop: 3, textTransform: 'capitalize' },
  badgeRow: { alignItems: 'flex-start', marginTop: spacing.sm },
  auditCard: { alignItems: 'center', backgroundColor: colors.blueDeep, flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  auditCopy: { flex: 1 },
  auditTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  auditText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  errorCard: { backgroundColor: colors.redDeep, padding: spacing.md },
  errorText: { color: colors.text, fontSize: 13 },
  emptyText: { color: colors.muted, fontSize: 13 },
  message: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xxl },
  messageTitle: { color: colors.text, fontSize: 18, fontWeight: '900', marginTop: spacing.md },
  messageText: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: spacing.sm, textAlign: 'center' },
  done: { backgroundColor: colors.teal, borderRadius: 14, marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  doneText: { color: colors.background, fontWeight: '900' },
});