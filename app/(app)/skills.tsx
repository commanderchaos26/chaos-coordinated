import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Badge, Card, EmptyState, Icon } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { loadMembership } from '../../src/lib/membership';
import { formatStatus, loadEmployeeDirectory } from '../../src/lib/employeeData';
import { runWorkforceCommand } from '../../src/lib/workforceCommands';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type SkillsData = Awaited<ReturnType<typeof loadEmployeeDirectory>>;
const canManage = (membership: Membership | null) => Boolean(membership?.roles.some((role) => role === 'owner' || role === 'operations_manager'));

export default function SkillsScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [data, setData] = useState<SkillsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (current && canManage(current)) setData(await loadEmployeeDirectory(current.companyId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load skills.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const createSkill = async () => {
    if (!membership || !name.trim() || saving) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await runWorkforceCommand({ company_id: membership.companyId, action: 'create_skill', name: name.trim(), category: category.trim() || undefined, description: description.trim() || undefined });
      setName(''); setCategory(''); setDescription(''); setFormOpen(false);
      await load();
      setNotice('Skill created successfully.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create skill.'); }
    finally { setSaving(false); }
  };

  if (loading) return <LoadingScreen label="Loading skills setup..." />;
  if (!canManage(membership)) return <Message title="Management access required" message="Your current role does not include skills management." />;
  const grouped = (data?.skills ?? []).reduce<Record<string, SkillsData['skills']>>((groups, skill) => { const group = skill.category || 'Uncategorized'; (groups[group] ||= []).push(skill); return groups; }, {});
  return <>
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <View style={styles.topbar}><Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>PEOPLE OPERATIONS</Text><Text style={styles.title}>Skills setup</Text></View><View style={styles.headerIcon}><Icon name="ribbon-outline" color={colors.teal} size={21} /></View></View>
      <View style={styles.intro}><Text style={styles.introTitle}>Capabilities library</Text><Text style={styles.introText}>Keep the skills used for floating coverage and dispatch decisions in one place.</Text></View>
      {notice && <Feedback tone="success" message={notice} />}
      {error && <Feedback tone="error" message={error} />}
      <Pressable onPress={() => { setError(null); setFormOpen(true); }} style={styles.addButton}><Icon name="add" color={colors.background} size={20} /><Text style={styles.addText}>Add skill</Text><Icon name="chevron-forward" color={colors.background} size={18} /></Pressable>
      {data?.skills.length ? Object.entries(grouped).map(([group, skills]) => <View key={group} style={styles.group}><Text style={styles.groupTitle}>{group}</Text>{skills.map((skill) => <Card key={skill.id} style={styles.skill}><View style={styles.skillTop}><Text style={styles.skillName}>{skill.name}</Text><Badge label={formatStatus(skill.active ? 'active' : 'inactive')} tone={skill.active ? 'teal' : 'neutral'} /></View>{skill.description && <Text style={styles.description}>{skill.description}</Text>}</Card>)}</View>) : <EmptyState icon="ribbon-outline" title="Skills are not configured" message="Create the first company skill to make it available for employee assignments." />}
    </ScrollView>
    <Modal animationType="slide" transparent visible={formOpen} onRequestClose={() => !saving && setFormOpen(false)}>
      <View style={styles.modalBackdrop}><View style={styles.modal}><View style={styles.modalHeader}><Text style={styles.modalTitle}>Create skill</Text><Pressable disabled={saving} onPress={() => setFormOpen(false)}><Icon name="close" color={colors.muted} size={24} /></Pressable></View><Text style={styles.label}>Skill name *</Text><TextInput autoFocus placeholder="e.g. HVAC diagnostics" placeholderTextColor={colors.subtle} value={name} onChangeText={setName} style={styles.input} /><Text style={styles.label}>Category</Text><TextInput placeholder="e.g. Technical" placeholderTextColor={colors.subtle} value={category} onChangeText={setCategory} style={styles.input} /><Text style={styles.label}>Description</Text><TextInput multiline placeholder="What does this capability cover?" placeholderTextColor={colors.subtle} value={description} onChangeText={setDescription} style={[styles.input, styles.textarea]} /><View style={styles.modalActions}><Pressable disabled={saving} onPress={() => setFormOpen(false)} style={styles.cancel}><Text style={styles.cancelText}>Cancel</Text></Pressable><Pressable disabled={saving || !name.trim()} onPress={() => void createSkill()} style={[styles.submit, (!name.trim() || saving) && styles.disabled]}><Text style={styles.submitText}>{saving ? 'Creating...' : 'Create skill'}</Text></Pressable></View></View></View>
    </Modal>
  </>;
}

function Feedback({ tone, message }: { tone: 'success' | 'error'; message: string }) { return <View style={[styles.feedback, tone === 'success' ? styles.success : styles.failure]}><Icon name={tone === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline'} color={tone === 'success' ? colors.teal : colors.red} size={19} /><Text style={styles.feedbackText}>{message}</Text></View>; }
function Message({ title, message }: { title: string; message: string }) { return <View style={styles.message}><Icon name="alert-circle-outline" color={colors.amber} size={25} /><Text style={styles.messageTitle}>{title}</Text><Text style={styles.messageText}>{message}</Text><Pressable onPress={() => router.back()} style={styles.backButton}><Text style={styles.backText}>Back</Text></Pressable></View>; }

const styles = StyleSheet.create({ root: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg, paddingBottom: 110 }, topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm }, back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 }, headerCopy: { flex: 1, marginLeft: spacing.md }, eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }, title: { color: colors.text, ...typography.title, marginTop: 3 }, headerIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 44, justifyContent: 'center', width: 44 }, intro: { marginTop: spacing.xxl }, introTitle: { color: colors.text, ...typography.heading }, introText: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.xs }, feedback: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md }, success: { backgroundColor: colors.tealDeep }, failure: { backgroundColor: colors.redDeep }, feedbackText: { color: colors.text, flex: 1, fontSize: 13, lineHeight: 18 }, addButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.xl, minHeight: 54, paddingHorizontal: spacing.md }, addText: { color: colors.background, flex: 1, fontSize: 15, fontWeight: '800' }, group: { marginBottom: spacing.lg }, groupTitle: { color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, marginBottom: spacing.sm, textTransform: 'uppercase' }, skill: { marginBottom: spacing.sm, padding: spacing.md }, skillTop: { alignItems: 'center', flexDirection: 'row' }, skillName: { color: colors.text, flex: 1, fontSize: 15, fontWeight: '800' }, description: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm }, modalBackdrop: { backgroundColor: '#00000099', flex: 1, justifyContent: 'flex-end' }, modal: { backgroundColor: colors.surface, borderColor: colors.border, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: spacing.lg }, modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.lg }, modalTitle: { color: colors.text, fontSize: 20, fontWeight: '800' }, label: { color: colors.muted, fontSize: 12, fontWeight: '800', marginBottom: spacing.xs, marginTop: spacing.sm, textTransform: 'uppercase' }, input: { backgroundColor: colors.surfaceSoft, borderColor: colors.border, borderRadius: 11, borderWidth: 1, color: colors.text, fontSize: 15, minHeight: 48, paddingHorizontal: spacing.md }, textarea: { minHeight: 82, paddingTop: spacing.md, textAlignVertical: 'top' }, modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl }, cancel: { alignItems: 'center', borderColor: colors.border, borderRadius: 12, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 50 }, cancelText: { color: colors.text, fontWeight: '800' }, submit: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 50 }, submitText: { color: colors.background, fontWeight: '800' }, disabled: { opacity: 0.45 }, message: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl }, messageTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing.lg }, messageText: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm, textAlign: 'center' }, backButton: { backgroundColor: colors.teal, borderRadius: 14, marginTop: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.md }, backText: { color: colors.background, fontWeight: '800' }, });