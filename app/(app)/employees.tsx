import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Badge, Card, EmptyState, Icon, SectionHeader } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { loadMembership } from '../../src/lib/membership';
import { accountStatus, formatStatus, loadEmployeeDirectory, type Employee } from '../../src/lib/employeeData';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type DirectoryData = Awaited<ReturnType<typeof loadEmployeeDirectory>>;
const canManage = (membership: Membership | null) => Boolean(membership?.roles.some((role) => role === 'owner' || role === 'operations_manager'));
const toneForStatus = (status: string) => status === 'active' ? 'teal' : status === 'suspended' ? 'amber' : status === 'closed' ? 'red' : 'blue';

export default function EmployeesScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [data, setData] = useState<DirectoryData | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (current && canManage(current)) setData(await loadEmployeeDirectory(current.companyId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load employees.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    return data.employees.filter((employee) => `${employee.display_name} ${employee.employee_number ?? ''} ${data.links.find((link) => link.employee_id === employee.id)?.intended_email ?? ''}`.toLowerCase().includes(needle));
  }, [data, query]);
  if (loading) return <LoadingScreen label="Loading employee directory..." />;
  if (!canManage(membership)) return <AccessDenied />;
  if (error) return <MessageScreen title="Directory unavailable" message={error} action="Try again" onAction={() => void load()} />;

  return <FlatList contentContainerStyle={styles.root} data={visible} keyExtractor={(item) => item.id} showsVerticalScrollIndicator={false} ListHeaderComponent={<><TopBar /><View style={styles.search}><Icon name="search-outline" color={colors.subtle} size={19} /><TextInput placeholder="Search people" placeholderTextColor={colors.subtle} value={query} onChangeText={setQuery} style={styles.searchInput} /></View><SectionHeader title="Team roster" action={`${data?.employees.length ?? 0} people`} /></>} ListEmptyComponent={data?.employees.length ? <EmptyState icon="search-outline" title="No matching employees" message="Try a different name, number, or email." /> : <EmptyState icon="people-outline" title="No employees visible" message="Employees will appear here when they are available through your current management access." />} renderItem={({ item }) => <EmployeeCard employee={item} data={data!} />} />;
}

function TopBar() { return <View style={styles.header}><Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>PEOPLE OPERATIONS</Text><Text style={styles.heading}>Employees</Text></View><View style={styles.headerIcon}><Icon name="people-outline" color={colors.teal} size={21} /></View></View>; }
function EmployeeCard({ employee, data }: { employee: Employee; data: DirectoryData }) {
  const link = data.links.find((item) => item.employee_id === employee.id);
  const status = accountStatus(link?.status);
  const department = data.departments.find((item) => item.id === employee.primary_department_id);
  const roles = data.roles.filter((item) => item.employee_id === employee.id);
  const skills = data.employeeSkills.filter((item) => item.employee_id === employee.id).map((item) => data.skills.find((skill) => skill.id === item.skill_id)?.name).filter(Boolean) as string[];
  return <Pressable onPress={() => router.push({ pathname: '/(app)/employee-detail' as never, params: { id: employee.id } })} style={({ pressed }) => [styles.cardPress, pressed && styles.pressed]}><Card style={styles.card}><View style={styles.cardTop}><View style={styles.avatar}><Text style={styles.avatarText}>{employee.display_name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</Text></View><View style={styles.nameBlock}><Text style={styles.name}>{employee.display_name}</Text><Text style={styles.email}>{link?.intended_email ?? 'No login email recorded'}</Text></View><Badge label={status} tone={toneForStatus(status)} /></View><View style={styles.metaRow}><Badge label={formatStatus(employee.employment_status)} /><Text style={styles.metaText}>{department?.name ?? 'Department not assigned'}</Text></View><View style={styles.bottomRow}><View style={styles.skillSummary}>{skills.slice(0, 2).map((skill) => <Badge key={skill} label={skill} tone="blue" />)}{skills.length > 2 && <Text style={styles.moreSkills}>+{skills.length - 2}</Text>}{skills.length === 0 && <Text style={styles.muted}>No skills assigned</Text>}</View><View style={[styles.floater, employee.floater_eligible ? styles.floaterOn : styles.floaterOff]}><Icon name="swap-horizontal-outline" color={employee.floater_eligible ? colors.teal : colors.subtle} size={14} /><Text style={[styles.floaterText, employee.floater_eligible && styles.floaterTextOn]}>{employee.floater_eligible ? 'Floater' : 'Fixed'}</Text></View></View><View style={styles.roleLine}><Icon name="shield-checkmark-outline" color={colors.subtle} size={14} /><Text style={styles.roleText}>{roles.length ? roles.map((role) => formatStatus(role.role)).join('  •  ') : 'No active roles'}</Text></View></Card></Pressable>;
}
function AccessDenied() { return <MessageScreen title="Management access required" message="Your current role does not include the employee directory." action="Back" onAction={() => router.back()} />; }
function MessageScreen({ title, message, action, onAction }: { title: string; message: string; action: string; onAction: () => void }) { return <View style={styles.messageRoot}><View style={styles.messageIcon}><Icon name="alert-circle-outline" color={colors.amber} size={24} /></View><Text style={styles.messageTitle}>{title}</Text><Text style={styles.messageText}>{message}</Text><Pressable onPress={onAction} style={styles.messageButton}><Text style={styles.messageButtonText}>{action}</Text></Pressable></View>; }

const styles = StyleSheet.create({ root: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg, paddingBottom: 110 }, header: { alignItems: 'center', flexDirection: 'row', marginBottom: spacing.lg, paddingTop: spacing.sm }, back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 }, headerCopy: { flex: 1, marginLeft: spacing.md }, eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }, heading: { color: colors.text, ...typography.title, marginTop: 3 }, headerIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 44, justifyContent: 'center', width: 44 }, search: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', minHeight: 52, paddingHorizontal: spacing.md, marginBottom: spacing.xl }, searchInput: { color: colors.text, flex: 1, fontSize: 15, marginLeft: spacing.sm }, cardPress: { marginBottom: spacing.sm }, card: { padding: spacing.md }, cardTop: { alignItems: 'center', flexDirection: 'row' }, avatar: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 14, height: 48, justifyContent: 'center', width: 48 }, avatarText: { color: colors.teal, fontSize: 15, fontWeight: '800' }, nameBlock: { flex: 1, marginHorizontal: spacing.md }, name: { color: colors.text, fontSize: 16, fontWeight: '800' }, email: { color: colors.muted, fontSize: 12, marginTop: 4 }, metaRow: { alignItems: 'center', borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md }, metaText: { color: colors.muted, flex: 1, fontSize: 12 }, bottomRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }, skillSummary: { alignItems: 'center', flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, moreSkills: { color: colors.blue, fontSize: 12, fontWeight: '800' }, muted: { color: colors.subtle, fontSize: 12 }, floater: { alignItems: 'center', borderRadius: 999, flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 6 }, floaterOn: { backgroundColor: colors.tealDeep }, floaterOff: { backgroundColor: colors.surfaceSoft }, floaterText: { color: colors.subtle, fontSize: 11, fontWeight: '800' }, floaterTextOn: { color: colors.teal }, roleLine: { alignItems: 'center', flexDirection: 'row', marginTop: spacing.md }, roleText: { color: colors.muted, fontSize: 12, marginLeft: 6, textTransform: 'capitalize' }, pressed: { opacity: 0.78 }, messageRoot: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl }, messageIcon: { alignItems: 'center', backgroundColor: colors.amberDeep, borderRadius: 999, height: 56, justifyContent: 'center', width: 56 }, messageTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing.lg }, messageText: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm, maxWidth: 320, textAlign: 'center' }, messageButton: { backgroundColor: colors.teal, borderRadius: 14, marginTop: spacing.xl, minWidth: 140, paddingHorizontal: spacing.xl, paddingVertical: spacing.md }, messageButtonText: { color: colors.background, fontSize: 14, fontWeight: '800', textAlign: 'center' },
});
