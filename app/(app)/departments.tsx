import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Badge, Card, EmptyState, Icon } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { Department, loadOrganizationData } from '../../src/lib/employeeData';
import { loadMembership } from '../../src/lib/membership';
import { runOrganizationCommand } from '../../src/lib/organizationCommands';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type Data = Awaited<ReturnType<typeof loadOrganizationData>>;
const canManage = (m: Membership | null) => Boolean(m?.roles.some((r) => r === 'owner' || r === 'operations_manager'));

export default function DepartmentsScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try { const current = await loadMembership(); setMembership(current); if (current && canManage(current)) setData(await loadOrganizationData(current.companyId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load departments.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const counts = useMemo(() => new Map((data?.departments ?? []).map((department) => [department.id, data?.employeeDepartments.filter((row) => row.department_id === department.id).length ?? 0])), [data]);
  const openForm = (department?: Department) => { setEditing(department ?? null); setName(department?.name ?? ''); setCode(department?.code ?? ''); setFormOpen(true); setError(null); };
  const save = async () => {
    if (!membership || !name.trim() || saving) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      if (editing) await runOrganizationCommand({ company_id: membership.companyId, action: 'update_department', department_id: editing.id, name: name.trim(), code: code.trim() });
      else await runOrganizationCommand({ company_id: membership.companyId, action: 'create_department', name: name.trim(), code: code.trim() });
      setEditing(null); setName(''); setCode(''); setFormOpen(false); await load(); setNotice(editing ? 'Department updated.' : 'Department created.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save department.'); }
    finally { setSaving(false); }
  };
  const toggle = async (department: Department) => {
    if (!membership || saving) return;
    setSaving(true); setError(null); setNotice(null);
    try { await runOrganizationCommand({ company_id: membership.companyId, action: 'update_department', department_id: department.id, active: !department.active }); await load(); setNotice(`${department.name} ${department.active ? 'deactivated' : 'activated'}.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update department status.'); }
    finally { setSaving(false); }
  };
  if (loading) return <LoadingScreen label="Loading departments..." />;
  if (!canManage(membership)) return <Message title="Management access required" message="Your current role does not include department management." />;
  return <>
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <TopBar /><Text style={styles.intro}>Organize employees into the departments used for coverage and dispatch.</Text>
      {notice && <Feedback message={notice} tone="success" />}{error && <Feedback message={error} tone="error" />}
      <Pressable onPress={() => openForm()} style={styles.add}><Icon name="add" color={colors.background} size={20} /><Text style={styles.addText}>Create department</Text></Pressable>
      {data?.departments.length ? data.departments.map((department) => <Card key={department.id} style={styles.card}><View style={styles.cardTop}><View style={styles.cardCopy}><Text style={styles.name}>{department.name}</Text><Text style={styles.code}>{department.code || 'No code'}</Text></View><Badge label={department.active ? 'Active' : 'Inactive'} tone={department.active ? 'teal' : 'neutral'} /></View><Text style={styles.count}>{counts.get(department.id) ?? 0} employee{counts.get(department.id) === 1 ? '' : 's'}</Text><View style={styles.actions}><Pressable onPress={() => openForm(department)}><Text style={styles.actionText}>Edit</Text></Pressable><Pressable disabled={saving} onPress={() => void toggle(department)}><Text style={[styles.actionText, department.active ? styles.danger : null]}>{department.active ? 'Deactivate' : 'Activate'}</Text></Pressable></View></Card>) : <EmptyState icon="business-outline" title="No departments yet" message="Create a department to start organizing your field team." />}
    </ScrollView>
    <Modal animationType="slide" transparent visible={formOpen} onRequestClose={() => !saving && setFormOpen(false)}><View style={styles.backdrop}><View style={styles.modal}><View style={styles.modalTop}><Text style={styles.modalTitle}>{editing ? 'Edit department' : 'Create department'}</Text><Pressable disabled={saving} onPress={() => setFormOpen(false)}><Icon name="close" color={colors.muted} size={24} /></Pressable></View><Field label="Name *" value={name} onChangeText={setName} placeholder="e.g. Housekeeping" /><Field label="Code" value={code} onChangeText={setCode} placeholder="e.g. HK" /><View style={styles.modalActions}><Pressable disabled={saving} onPress={() => setFormOpen(false)}><Text style={styles.cancel}>Cancel</Text></Pressable><Pressable disabled={saving || !name.trim()} onPress={() => void save()} style={[styles.submit, (!name.trim() || saving) && styles.disabled]}><Text style={styles.submitText}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Create department'}</Text></Pressable></View></View></View></Modal>
  </>;
}
function TopBar() { return <View style={styles.topbar}><Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>PEOPLE OPERATIONS</Text><Text style={styles.title}>Departments</Text></View><View style={styles.headerIcon}><Icon name="business-outline" color={colors.teal} size={21} /></View></View>; }
function Field({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string }) { return <View><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.subtle} style={styles.input} /></View>; }
function Feedback({ message, tone }: { message: string; tone: 'success' | 'error' }) { return <View style={[styles.feedback, tone === 'success' ? styles.success : styles.failure]}><Icon name={tone === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline'} color={tone === 'success' ? colors.teal : colors.red} size={18} /><Text style={styles.feedbackText}>{message}</Text></View>; }
function Message({ title, message }: { title: string; message: string }) { return <View style={styles.message}><Icon name="alert-circle-outline" color={colors.amber} size={25} /><Text style={styles.messageTitle}>{title}</Text><Text style={styles.messageText}>{message}</Text><Pressable onPress={() => router.back()} style={styles.backButton}><Text style={styles.backText}>Back</Text></Pressable></View>; }
const styles = StyleSheet.create({ root: { backgroundColor: colors.background, flexGrow: 1, gap: spacing.md, padding: spacing.lg, paddingBottom: 110 }, topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm }, back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 }, headerCopy: { flex: 1, marginLeft: spacing.md }, eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }, title: { color: colors.text, ...typography.title, marginTop: 3 }, headerIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 44, justifyContent: 'center', width: 44 }, intro: { color: colors.muted, fontSize: 14, lineHeight: 21 }, add: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 52 }, addText: { color: colors.background, fontSize: 14, fontWeight: '800' }, card: { padding: spacing.md }, cardTop: { alignItems: 'center', flexDirection: 'row' }, cardCopy: { flex: 1 }, name: { color: colors.text, fontSize: 16, fontWeight: '800' }, code: { color: colors.muted, fontSize: 12, marginTop: 4 }, count: { color: colors.muted, fontSize: 13, marginTop: spacing.md }, actions: { borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md, paddingTop: spacing.md }, actionText: { color: colors.teal, fontSize: 13, fontWeight: '800' }, danger: { color: colors.red }, feedback: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: spacing.sm, padding: spacing.md }, success: { backgroundColor: colors.tealDeep }, failure: { backgroundColor: colors.redDeep }, feedbackText: { color: colors.text, flex: 1, fontSize: 13 }, backdrop: { backgroundColor: '#00000099', flex: 1, justifyContent: 'flex-end' }, modal: { backgroundColor: colors.surfaceRaised, borderTopLeftRadius: 22, borderTopRightRadius: 22, gap: spacing.md, padding: spacing.xl }, modalTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, modalTitle: { color: colors.text, fontSize: 19, fontWeight: '800' }, label: { color: colors.muted, fontSize: 12, fontWeight: '800' }, input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, color: colors.text, fontSize: 15, minHeight: 50, marginTop: 6, paddingHorizontal: spacing.md }, modalActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, justifyContent: 'flex-end', marginTop: spacing.sm }, cancel: { color: colors.muted, fontSize: 14, fontWeight: '800', padding: spacing.md }, submit: { backgroundColor: colors.teal, borderRadius: 12, padding: spacing.md }, submitText: { color: colors.background, fontSize: 14, fontWeight: '800' }, disabled: { opacity: 0.5 }, message: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl }, messageTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing.md }, messageText: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm, textAlign: 'center' }, backButton: { backgroundColor: colors.teal, borderRadius: 12, marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md }, backText: { color: colors.background, fontWeight: '800' } });
