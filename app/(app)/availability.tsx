import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Badge, Card, EmptyState, Icon } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { approveAvailability, removeAvailability, submitAvailability } from '../../src/lib/dispatchCommands';
import { formatStatus } from '../../src/lib/employeeData';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type AvailabilityRow = {
  id: string;
  employee_id: string;
  kind: string;
  starts_at: string;
  ends_at: string | null;
  reason: string | null;
  approved_at: string | null;
};

type EmployeeOption = { id: string; display_name: string };

const canManageTeam = (membership: Membership | null) => Boolean(membership?.roles.some((role) => ['owner', 'operations_manager', 'supervisor', 'dispatcher'].includes(role)));
const availabilityKinds = ['available', 'unavailable', 'pto', 'sick', 'training', 'restricted'] as const;

export default function AvailabilityScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [records, setRecords] = useState<AvailabilityRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState<(typeof availabilityKinds)[number]>('available');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (!current) return;
      setSelectedEmployeeId(current.employeeId);

      const [employeesResult, periodsResult] = await Promise.all([
        supabase.from('employees').select('id,display_name').eq('company_id', current.companyId).order('display_name'),
        supabase.from('availability_periods').select('id,employee_id,kind,starts_at,ends_at,reason,approved_at').eq('company_id', current.companyId).order('starts_at', { ascending: true }),
      ]);
      if (employeesResult.error) throw employeesResult.error;
      if (periodsResult.error) throw periodsResult.error;
      setEmployees((employeesResult.data ?? []) as EmployeeOption[]);
      setRecords((periodsResult.data ?? []) as AvailabilityRow[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load availability.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const visibleRecords = useMemo(() => {
    if (!membership) return [];
    const employeeId = canManageTeam(membership) ? selectedEmployeeId || membership.employeeId : membership.employeeId;
    return records.filter((row) => row.employee_id === employeeId).sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }, [membership, records, selectedEmployeeId]);

  const handleSubmit = async () => {
    if (!membership || saving) return;

    if (!startsAt.trim() || !endsAt.trim()) {
      Alert.alert(
        'Start and end required',
        'Enter both a start date/time and an end date/time.',
      );
      return;
    }

    const startTime = new Date(startsAt).getTime();
    const endTime = new Date(endsAt).getTime();

    if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
      Alert.alert(
        'Invalid date or time',
        'Use a valid date/time for both Start and End, for example 2026-09-20T08:00:00.',
      );
      return;
    }

    if (endTime <= startTime) {
      Alert.alert(
        'Invalid time range',
        'The end date/time must be after the start date/time.',
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const employeeId = canManageTeam(membership) ? selectedEmployeeId || membership.employeeId : membership.employeeId;
      await submitAvailability({
        p_company_id: membership.companyId,
        p_employee_id: employeeId,
        p_kind: kind,
        p_starts_at: startsAt,
        p_ends_at: endsAt,
        p_reason: reason.trim() || null,
        p_approve: canManageTeam(membership) ? true : false,
      });
      setModalOpen(false);
      setKind('available');
      setStartsAt('');
      setEndsAt('');
      setReason('');
      await load();
      Alert.alert('Availability saved', 'Your availability update has been recorded.');
    } catch (cause) {
      Alert.alert('Could not save availability', cause instanceof Error ? cause.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (periodId: string) => {
    if (!membership || saving) return;
    setSaving(true);
    try { await approveAvailability({ p_company_id: membership.companyId, p_period_id: periodId }); await load(); }
    catch (cause) { Alert.alert('Approval failed', cause instanceof Error ? cause.message : 'Could not approve availability.'); }
    finally { setSaving(false); }
  };

  const handleRemove = async (periodId: string) => {
    if (!membership || saving) return;
    Alert.alert('Remove availability?', 'This will remove the selected availability period.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        setSaving(true);
        try { await removeAvailability({ p_company_id: membership.companyId, p_period_id: periodId }); await load(); }
        catch (cause) { Alert.alert('Remove failed', cause instanceof Error ? cause.message : 'Could not remove availability.'); }
        finally { setSaving(false); }
      } },
    ]);
  };

  if (loading) return <LoadingScreen label="Loading availability..." />;
  if (!membership) return <Message title="Unavailable" message="Your workspace session is not available." />;

  const employeeName = employees.find((item) => item.id === (canManageTeam(membership) ? selectedEmployeeId || membership.employeeId : membership.employeeId))?.display_name ?? 'You';

  return <>
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21} /></Pressable>
        <View style={styles.headerCopy}><Text style={styles.eyebrow}>OPERATIONS</Text><Text style={styles.title}>Availability</Text></View>
        <View style={styles.headerIcon}><Icon name="calendar-outline" color={colors.teal} size={21} /></View>
      </View>

      {canManageTeam(membership) && (
        <View style={styles.filterRow}>
          <Text style={styles.label}>Employee</Text>
          <View style={styles.selectorWrap}>
            {employees.map((employee) => (
              <Pressable key={employee.id} onPress={() => setSelectedEmployeeId(employee.id)} style={[styles.selector, selectedEmployeeId === employee.id && styles.selectorActive]}>
                <Text style={[styles.selectorText, selectedEmployeeId === employee.id && styles.selectorTextActive]}>{employee.display_name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <Pressable onPress={() => setModalOpen(true)} style={styles.addButton}><Icon name="add" color={colors.background} size={20} /><Text style={styles.addText}>Add availability</Text></Pressable>
      {error && <Feedback tone="error" message={error} />}
      <Text style={styles.sectionTitle}>{canManageTeam(membership) ? `${employeeName}'s upcoming availability` : 'Your upcoming availability'}</Text>
      {visibleRecords.length ? visibleRecords.map((row) => {
        const conflict = records.some((other) => other.id !== row.id && other.employee_id === row.employee_id && other.kind !== 'available' && row.kind !== 'available' && new Date(other.starts_at) < new Date(row.ends_at ?? row.starts_at) && new Date(row.starts_at) < new Date(other.ends_at ?? other.starts_at));
        return <Card key={row.id} style={styles.card}>
          <View style={styles.cardTop}><Badge label={formatStatus(row.kind)} tone={row.approved_at ? 'teal' : row.kind === 'available' ? 'blue' : 'amber'} />{conflict && <Badge label="Conflict" tone="red" />}</View>
          <Text style={styles.metaLine}>{new Date(row.starts_at).toLocaleString()} {row.ends_at ? `→ ${new Date(row.ends_at).toLocaleString()}` : ''}</Text>
          {row.reason && <Text style={styles.reason}>{row.reason}</Text>}
          <View style={styles.cardActions}><Text style={styles.state}>{row.approved_at ? 'Approved' : 'Pending approval'}</Text>{!row.approved_at && canManageTeam(membership) && <Pressable onPress={() => void handleApprove(row.id)} style={styles.inlineAction}><Text style={styles.inlineActionText}>Approve</Text></Pressable>}<Pressable onPress={() => void handleRemove(row.id)} style={styles.inlineAction}><Text style={styles.inlineActionText}>Remove</Text></Pressable></View>
        </Card>;
      }) : <EmptyState icon="calendar-outline" title="No availability entered" message="Create the first availability entry for this employee." />}
    </ScrollView>

    <Modal animationType="slide" transparent visible={modalOpen} onRequestClose={() => !saving && setModalOpen(false)}>
      <View style={styles.modalBackdrop}><View style={styles.modal}>
        <View style={styles.modalHeader}><Text style={styles.modalTitle}>Add availability</Text><Pressable disabled={saving} onPress={() => setModalOpen(false)}><Icon name="close" color={colors.muted} size={23} /></Pressable></View>
        <Text style={styles.label}>Type</Text>
        <View style={styles.kindRow}>{availabilityKinds.map((option) => <Pressable key={option} onPress={() => setKind(option)} style={[styles.kindButton, kind === option && styles.kindButtonActive]}><Text style={[styles.kindText, kind === option && styles.kindTextActive]}>{formatStatus(option)}</Text></Pressable>)}</View>
        <Text style={styles.label}>Start</Text>
        <TextInput value={startsAt} onChangeText={setStartsAt} placeholder="2026-09-20T08:00:00" placeholderTextColor={colors.subtle} style={styles.input} />
        <Text style={styles.label}>End</Text>
        <TextInput value={endsAt} onChangeText={setEndsAt} placeholder="2026-09-20T12:00:00" placeholderTextColor={colors.subtle} style={styles.input} />
        <Text style={styles.label}>Reason</Text>
        <TextInput value={reason} onChangeText={setReason} placeholder="Optional reason" placeholderTextColor={colors.subtle} multiline style={[styles.input, styles.textarea]} />
        <View style={styles.modalActions}><Pressable disabled={saving} onPress={() => setModalOpen(false)} style={styles.cancelButton}><Text style={styles.cancelText}>Cancel</Text></Pressable><Pressable disabled={saving || !startsAt.trim() || !endsAt.trim()} onPress={() => void handleSubmit()} style={[styles.submitButton, (saving || !startsAt.trim() || !endsAt.trim()) && styles.disabled]}><Text style={styles.submitText}>{saving ? 'Saving...' : 'Submit'}</Text></Pressable></View>
      </View></View>
    </Modal>
  </>;
}

function Feedback({ tone, message }: { tone: 'success' | 'error'; message: string }) { return <View style={[styles.feedback, tone === 'success' ? styles.success : styles.failure]}><Icon name={tone === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline'} color={tone === 'success' ? colors.teal : colors.red} size={18} /><Text style={styles.feedbackText}>{message}</Text></View>; }
function Message({ title, message }: { title: string; message: string }) { return <View style={styles.message}><Icon name="alert-circle-outline" color={colors.amber} size={24} /><Text style={styles.messageTitle}>{title}</Text><Text style={styles.messageText}>{message}</Text><Pressable onPress={() => router.back()} style={styles.backButton}><Text style={styles.backText}>Back</Text></Pressable></View>; }

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flexGrow: 1, gap: spacing.md, padding: spacing.lg, paddingBottom: 110 },
  topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm },
  back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  headerCopy: { flex: 1, marginLeft: spacing.md },
  eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colors.text, ...typography.title, marginTop: 3 },
  headerIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 44, justifyContent: 'center', width: 44 },
  filterRow: { gap: spacing.sm },
  label: { color: colors.muted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  selectorWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  selector: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  selectorActive: { backgroundColor: colors.tealDeep, borderColor: colors.teal },
  selectorText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  selectorTextActive: { color: colors.teal },
  addButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 52 },
  addText: { color: colors.background, fontSize: 14, fontWeight: '800' },
  sectionTitle: { color: colors.text, ...typography.heading },
  card: { padding: spacing.md },
  cardTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  metaLine: { color: colors.text, fontSize: 14, marginTop: spacing.sm },
  reason: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  cardActions: { alignItems: 'center', borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.md },
  state: { color: colors.muted, flex: 1, fontSize: 12, fontWeight: '700' },
  inlineAction: { backgroundColor: colors.tealDeep, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  inlineActionText: { color: colors.teal, fontSize: 12, fontWeight: '800' },
  feedback: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  success: { backgroundColor: colors.tealDeep },
  failure: { backgroundColor: colors.redDeep },
  feedbackText: { color: colors.text, flex: 1, fontSize: 13 },
  modalBackdrop: { backgroundColor: '#00000099', flex: 1, justifyContent: 'flex-end' },
  modal: { backgroundColor: colors.surfaceRaised, borderTopLeftRadius: 22, borderTopRightRadius: 22, gap: spacing.md, padding: spacing.xl },
  modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  modalTitle: { color: colors.text, fontSize: 19, fontWeight: '800' },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kindButton: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  kindButtonActive: { backgroundColor: colors.tealDeep, borderColor: colors.teal },
  kindText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  kindTextActive: { color: colors.teal },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, color: colors.text, fontSize: 15, minHeight: 50, paddingHorizontal: spacing.md },
  textarea: { minHeight: 90, paddingTop: spacing.md, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between', marginTop: spacing.sm },
  cancelButton: { alignItems: 'center', borderColor: colors.border, borderWidth: 1, borderRadius: 12, flex: 1, minHeight: 50, justifyContent: 'center' },
  cancelText: { color: colors.text, fontWeight: '800' },
  submitButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 50 },
  submitText: { color: colors.background, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  message: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl },
  messageTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing.md },
  messageText: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm, textAlign: 'center' },
  backButton: { backgroundColor: colors.teal, borderRadius: 12, marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  backText: { color: colors.background, fontWeight: '800' },
});
