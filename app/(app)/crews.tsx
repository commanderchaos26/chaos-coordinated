import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Badge, Card, EmptyState, Icon } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { loadOrganizationData } from '../../src/lib/employeeData';
import { loadMembership } from '../../src/lib/membership';
import { runOrganizationCommand } from '../../src/lib/organizationCommands';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type Data = Awaited<ReturnType<typeof loadOrganizationData>>;
type Crew = Data['crews'][number];
const canManage = (m: Membership | null) => Boolean(m?.roles.some((r) => r === 'owner' || r === 'operations_manager'));

export default function CrewsScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState<Crew | null>(null);
  const [editing, setEditing] = useState<Crew | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try { const current = await loadMembership(); setMembership(current); if (current && canManage(current)) setData(await loadOrganizationData(current.companyId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load crews.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const openForm = (crew?: Crew) => { setEditing(crew ?? null); setName(crew?.name ?? ''); setNotes(crew?.notes ?? ''); setFormOpen(true); setError(null); };
  const save = async () => {
    if (!membership || !name.trim() || saving) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      if (editing) await runOrganizationCommand({ company_id: membership.companyId, action: 'update_crew', crew_id: editing.id, name: name.trim(), notes: notes.trim() });
      else await runOrganizationCommand({ company_id: membership.companyId, action: 'create_crew', name: name.trim(), notes: notes.trim() || undefined });
      setFormOpen(false); setEditing(null); await load(); setNotice(editing ? 'Crew updated.' : 'Crew created.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save crew.'); }
    finally { setSaving(false); }
  };
  const setActive = async (crew: Crew) => {
    if (!membership || saving) return;
    setSaving(true); setError(null); setNotice(null);
    try { await runOrganizationCommand({ company_id: membership.companyId, action: 'update_crew', crew_id: crew.id, active: !crew.active }); await load(); setNotice(`${crew.name} ${crew.active ? 'deactivated' : 'activated'}.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update crew status.'); }
    finally { setSaving(false); }
  };
  const setLead = async (crew: Crew, employeeId: string | null) => {
    if (!membership || saving) return;
    setSaving(true); setError(null); setNotice(null);
    try { await runOrganizationCommand({ company_id: membership.companyId, action: 'set_crew_lead', crew_id: crew.id, employee_id: employeeId }); await load(); setMemberOpen(null); setNotice(employeeId ? 'Crew lead updated.' : 'Crew lead removed.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update crew lead.'); }
    finally { setSaving(false); }
  };
  const toggleMember = async (crew: Crew, employeeId: string, assigned: boolean) => {
    if (!membership || saving) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      if (assigned) await runOrganizationCommand({ company_id: membership.companyId, action: 'remove_crew_member', crew_id: crew.id, employee_id: employeeId });
      else await runOrganizationCommand({ company_id: membership.companyId, action: 'assign_crew_member', crew_id: crew.id, employee_id: employeeId });
      await load(); setNotice(assigned ? 'Crew member removed.' : 'Crew member added.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update crew membership.'); }
    finally { setSaving(false); }
  };
  if (loading) return <LoadingScreen label="Loading crews..." />;
  if (!canManage(membership)) return <Message title="Management access required" message="Your current role does not include crew management." />;
  return <>
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <TopBar /><Text style={styles.intro}>Build field coverage groups, designate leads, and keep membership current.</Text>
      {notice && <Feedback message={notice} tone="success" />}{error && <Feedback message={error} tone="error" />}
      <Pressable onPress={() => openForm()} style={styles.add}><Icon name="add" color={colors.background} size={20} /><Text style={styles.addText}>Create crew</Text></Pressable>
      {data?.crews.length ? data.crews.map((crew) => { const members = data.crewMembers.filter((row) => row.crew_id === crew.id); const lead = data.employees.find((employee) => employee.id === crew.lead_employee_id); return <Card key={crew.id} style={styles.card}><View style={styles.cardTop}><View style={styles.cardCopy}><Text style={styles.name}>{crew.name}</Text><Text style={styles.lead}>{lead ? `Lead: ${lead.display_name}` : 'No lead assigned'}</Text></View><Badge label={crew.active ? 'Active' : 'Inactive'} tone={crew.active ? 'teal' : 'neutral'} /></View>{crew.notes && <Text style={styles.notes}>{crew.notes}</Text>}<Text style={styles.count}>{members.length} member{members.length === 1 ? '' : 's'}</Text><View style={styles.actions}><Pressable onPress={() => setMemberOpen(crew)}><Text style={styles.actionText}>Manage members</Text></Pressable><Pressable onPress={() => openForm(crew)}><Text style={styles.actionText}>Edit</Text></Pressable><Pressable disabled={saving} onPress={() => void setActive(crew)}><Text style={[styles.actionText, crew.active ? styles.danger : null]}>{crew.active ? 'Deactivate' : 'Activate'}</Text></Pressable></View></Card>; }) : <EmptyState icon="git-network-outline" title="No crews yet" message="Create a crew to coordinate field coverage." />}
    </ScrollView>
    <Modal animationType="slide" transparent visible={formOpen} onRequestClose={() => !saving && setFormOpen(false)}><View style={styles.backdrop}><View style={styles.modal}><ModalHeader title={editing ? 'Edit crew' : 'Create crew'} onClose={() => setFormOpen(false)} /><Field label="Name *" value={name} onChangeText={setName} placeholder="e.g. North response team" /><Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Coverage notes or operating focus" multiline /><View style={styles.modalActions}><Pressable disabled={saving} onPress={() => setFormOpen(false)}><Text style={styles.cancel}>Cancel</Text></Pressable><Pressable disabled={saving || !name.trim()} onPress={() => void save()} style={[styles.submit, (!name.trim() || saving) && styles.disabled]}><Text style={styles.submitText}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Create crew'}</Text></Pressable></View></View></View></Modal>
    <Modal animationType="slide" transparent visible={Boolean(memberOpen)} onRequestClose={() => !saving && setMemberOpen(null)}><View style={styles.backdrop}><View style={styles.modal}><ModalHeader title={memberOpen ? `${memberOpen.name} members` : 'Members'} onClose={() => setMemberOpen(null)} />{memberOpen && <><Text style={styles.sectionLabel}>Crew lead</Text>{data?.employees.map((employee) => <Pressable key={`lead-${employee.id}`} disabled={saving} onPress={() => void setLead(memberOpen, employee.id)} style={styles.person}><Text style={styles.personName}>{employee.display_name}</Text>{memberOpen.lead_employee_id === employee.id && <Badge label="Lead" tone="teal" />}</Pressable>)}<Pressable disabled={saving || !memberOpen.lead_employee_id} onPress={() => void setLead(memberOpen, null)}><Text style={styles.removeLead}>Remove lead</Text></Pressable><Text style={styles.sectionLabel}>Members</Text>{data?.employees.map((employee) => { const assigned = data.crewMembers.some((row) => row.crew_id === memberOpen.id && row.employee_id === employee.id); return <Pressable key={employee.id} disabled={saving} onPress={() => void toggleMember(memberOpen, employee.id, assigned)} style={styles.person}><Text style={styles.personName}>{employee.display_name}</Text><Badge label={assigned ? 'Assigned' : 'Add'} tone={assigned ? 'teal' : 'neutral'} /></Pressable>; })}</>}</View></View></Modal>
  </>;
}
function TopBar() { return <View style={styles.topbar}><Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>PEOPLE OPERATIONS</Text><Text style={styles.title}>Crews</Text></View><View style={styles.headerIcon}><Icon name="git-network-outline" color={colors.teal} size={21} /></View></View>; }
function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) { return <View style={styles.modalTop}><Text style={styles.modalTitle}>{title}</Text><Pressable onPress={onClose}><Icon name="close" color={colors.muted} size={24} /></Pressable></View>; }
function Field({ label, value, onChangeText, placeholder, multiline = false }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean }) { return <View><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.subtle} multiline={multiline} style={[styles.input, multiline && styles.textarea]} /></View>; }
function Feedback({ message, tone }: { message: string; tone: 'success' | 'error' }) { return <View style={[styles.feedback, tone === 'success' ? styles.success : styles.failure]}><Icon name={tone === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline'} color={tone === 'success' ? colors.teal : colors.red} size={18} /><Text style={styles.feedbackText}>{message}</Text></View>; }
function Message({ title, message }: { title: string; message: string }) { return <View style={styles.message}><Icon name="alert-circle-outline" color={colors.amber} size={25} /><Text style={styles.messageTitle}>{title}</Text><Text style={styles.messageText}>{message}</Text><Pressable onPress={() => router.back()} style={styles.backButton}><Text style={styles.backText}>Back</Text></Pressable></View>; }
const styles = StyleSheet.create({ root: { backgroundColor: colors.background, flexGrow: 1, gap: spacing.md, padding: spacing.lg, paddingBottom: 110 }, topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm }, back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 }, headerCopy: { flex: 1, marginLeft: spacing.md }, eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }, title: { color: colors.text, ...typography.title, marginTop: 3 }, headerIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 44, justifyContent: 'center', width: 44 }, intro: { color: colors.muted, fontSize: 14, lineHeight: 21 }, add: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 52 }, addText: { color: colors.background, fontSize: 14, fontWeight: '800' }, card: { padding: spacing.md }, cardTop: { alignItems: 'center', flexDirection: 'row' }, cardCopy: { flex: 1 }, name: { color: colors.text, fontSize: 16, fontWeight: '800' }, lead: { color: colors.muted, fontSize: 12, marginTop: 4 }, notes: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: spacing.md }, count: { color: colors.muted, fontSize: 13, marginTop: spacing.md }, actions: { borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.md, paddingTop: spacing.md }, actionText: { color: colors.teal, fontSize: 13, fontWeight: '800' }, danger: { color: colors.red }, feedback: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: spacing.sm, padding: spacing.md }, success: { backgroundColor: colors.tealDeep }, failure: { backgroundColor: colors.redDeep }, feedbackText: { color: colors.text, flex: 1, fontSize: 13 }, backdrop: { backgroundColor: '#00000099', flex: 1, justifyContent: 'flex-end' }, modal: { backgroundColor: colors.surfaceRaised, borderTopLeftRadius: 22, borderTopRightRadius: 22, gap: spacing.md, maxHeight: '88%', padding: spacing.xl }, modalTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, modalTitle: { color: colors.text, fontSize: 19, fontWeight: '800' }, label: { color: colors.muted, fontSize: 12, fontWeight: '800' }, input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, color: colors.text, fontSize: 15, minHeight: 50, marginTop: 6, paddingHorizontal: spacing.md }, textarea: { minHeight: 80, paddingTop: spacing.md, textAlignVertical: 'top' }, modalActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, justifyContent: 'flex-end', marginTop: spacing.sm }, cancel: { color: colors.muted, fontSize: 14, fontWeight: '800', padding: spacing.md }, submit: { backgroundColor: colors.teal, borderRadius: 12, padding: spacing.md }, submitText: { color: colors.background, fontSize: 14, fontWeight: '800' }, disabled: { opacity: 0.5 }, sectionLabel: { color: colors.muted, fontSize: 12, fontWeight: '800', marginTop: spacing.sm, textTransform: 'uppercase' }, person: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 48 }, personName: { color: colors.text, fontSize: 14, fontWeight: '700' }, removeLead: { color: colors.red, fontSize: 13, fontWeight: '800', paddingVertical: spacing.sm }, message: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl }, messageTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing.md }, messageText: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm, textAlign: 'center' }, backButton: { backgroundColor: colors.teal, borderRadius: 12, marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md }, backText: { color: colors.background, fontWeight: '800' } });
