import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Badge, Card, EmptyState, Icon } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { formatStatus } from '../../src/lib/employeeData';
import { loadMembership } from '../../src/lib/membership';
import {
  addScheduleException,
  approveScheduleException,
  removeScheduleException,
  setCompanyScheduleDay,
  type ScheduleExceptionKind,
  type ScheduleRecurrence,
} from '../../src/lib/scheduleCommands';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type ScheduleDay = {
  company_id: string;
  weekday: number;
  is_workday: boolean;
  start_time: string | null;
  end_time: string | null;
};

type ScheduleException = {
  id: string;
  employee_id: string;
  kind: ScheduleExceptionKind;
  recurrence: ScheduleRecurrence;
  starts_at: string | null;
  ends_at: string | null;
  weekday: number | null;
  start_time: string | null;
  end_time: string | null;
  effective_from: string | null;
  effective_to: string | null;
  note: string | null;
  approved_at: string | null;
  active: boolean;
};

type EmployeeOption = { id: string; display_name: string; employment_status: string };

const weekdays = [
  { value: 0, short: 'Sun', long: 'Sunday' },
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
] as const;

const exceptionKinds: ScheduleExceptionKind[] = ['unavailable', 'pto', 'sick', 'training', 'restricted'];
const canManageTeam = (membership: Membership | null) => Boolean(membership?.roles.some((role) => ['owner', 'operations_manager', 'supervisor', 'dispatcher'].includes(role)));
const canEditCompanySchedule = (membership: Membership | null) => Boolean(membership?.roles.some((role) => ['owner', 'operations_manager'].includes(role)));
const today = () => new Date().toISOString().slice(0, 10);

export default function AvailabilityScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [scheduleDays, setScheduleDays] = useState<ScheduleDay[]>([]);
  const [exceptions, setExceptions] = useState<ScheduleException[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [kind, setKind] = useState<ScheduleExceptionKind>('unavailable');
  const [recurrence, setRecurrence] = useState<ScheduleRecurrence>('one_off');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [weeklyDay, setWeeklyDay] = useState(1);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [effectiveTo, setEffectiveTo] = useState('');
  const [note, setNote] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (!current) return;
      setSelectedEmployeeId((existing) => existing || current.employeeId);

      const [daysResult, exceptionsResult, employeesResult] = await Promise.all([
        supabase.from('company_schedule_days').select('company_id,weekday,is_workday,start_time,end_time').eq('company_id', current.companyId).order('weekday'),
        supabase.from('employee_schedule_exceptions').select('id,employee_id,kind,recurrence,starts_at,ends_at,weekday,start_time,end_time,effective_from,effective_to,note,approved_at,active').eq('company_id', current.companyId).eq('active', true).order('created_at', { ascending: false }),
        canManageTeam(current)
          ? supabase.from('employees').select('id,display_name,employment_status').eq('company_id', current.companyId).eq('employment_status', 'active').order('display_name')
          : Promise.resolve({ data: [{ id: current.employeeId, display_name: 'You', employment_status: 'active' }], error: null }),
      ]);

      if (daysResult.error) throw daysResult.error;
      if (exceptionsResult.error) throw exceptionsResult.error;
      if (employeesResult.error) throw employeesResult.error;
      setScheduleDays((daysResult.data ?? []) as ScheduleDay[]);
      setExceptions((exceptionsResult.data ?? []) as ScheduleException[]);
      setEmployees((employeesResult.data ?? []) as EmployeeOption[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load schedule.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const effectiveEmployeeId = canManageTeam(membership) ? selectedEmployeeId || membership?.employeeId || '' : membership?.employeeId || '';
  const employeeName = employees.find((item) => item.id === effectiveEmployeeId)?.display_name ?? 'Employee';
  const visibleExceptions = useMemo(
    () => exceptions.filter((item) => item.employee_id === effectiveEmployeeId),
    [effectiveEmployeeId, exceptions],
  );

  const defaultSummary = useMemo(() => {
    const active = weekdays.filter((day) => scheduleDays.find((row) => row.weekday === day.value)?.is_workday);
    if (!active.length) return 'No default workdays selected';
    if (active.map((day) => day.value).join(',') === '1,2,3,4,5') return 'Monday–Friday';
    return active.map((day) => day.short).join(', ');
  }, [scheduleDays]);

  const resetModal = () => {
    setKind('unavailable');
    setRecurrence('one_off');
    setStartsAt('');
    setEndsAt('');
    setWeeklyDay(1);
    setStartTime('');
    setEndTime('');
    setEffectiveFrom(today());
    setEffectiveTo('');
    setNote('');
  };

  const saveException = async () => {
    if (!membership || !effectiveEmployeeId || saving) return;

    if (recurrence === 'one_off') {
      const start = new Date(startsAt).getTime();
      const end = new Date(endsAt).getTime();
      if (!startsAt.trim() || !endsAt.trim() || Number.isNaN(start) || Number.isNaN(end) || end <= start) {
        Alert.alert('Valid start and end required', 'Enter a valid start and end date/time for the schedule exception.');
        return;
      }
    } else {
      if (!effectiveFrom.trim()) {
        Alert.alert('Start date required', 'Enter the date when this weekly exception should begin.');
        return;
      }
      if ((startTime.trim() && !endTime.trim()) || (!startTime.trim() && endTime.trim())) {
        Alert.alert('Both times required', 'For a partial-day weekly exception, enter both a start time and end time. Leave both blank for the whole day.');
        return;
      }
    }

    setSaving(true);
    try {
      await addScheduleException({
        p_company_id: membership.companyId,
        p_employee_id: effectiveEmployeeId,
        p_kind: kind,
        p_recurrence: recurrence,
        p_starts_at: recurrence === 'one_off' ? startsAt : null,
        p_ends_at: recurrence === 'one_off' ? endsAt : null,
        p_weekday: recurrence === 'weekly' ? weeklyDay : null,
        p_start_time: recurrence === 'weekly' && startTime.trim() ? startTime.trim() : null,
        p_end_time: recurrence === 'weekly' && endTime.trim() ? endTime.trim() : null,
        p_effective_from: recurrence === 'weekly' ? effectiveFrom : null,
        p_effective_to: recurrence === 'weekly' && effectiveTo.trim() ? effectiveTo.trim() : null,
        p_note: note.trim() || null,
        p_approve: canManageTeam(membership),
      });
      setModalOpen(false);
      resetModal();
      await load();
      Alert.alert('Schedule exception saved', canManageTeam(membership) ? 'The employee will be omitted from dispatch during this exception.' : 'The exception was submitted and is now visible to management.');
    } catch (cause) {
      Alert.alert('Could not save exception', cause instanceof Error ? cause.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggleDefaultDay = async (day: ScheduleDay) => {
    if (!membership || !canEditCompanySchedule(membership) || saving) return;
    setSaving(true);
    try {
      await setCompanyScheduleDay({
        p_company_id: membership.companyId,
        p_weekday: day.weekday,
        p_is_workday: !day.is_workday,
        p_start_time: day.start_time,
        p_end_time: day.end_time,
      });
      await load();
    } catch (cause) {
      Alert.alert('Could not update workweek', cause instanceof Error ? cause.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const approve = async (id: string) => {
    if (!membership || saving) return;
    setSaving(true);
    try {
      await approveScheduleException({ p_company_id: membership.companyId, p_exception_id: id });
      await load();
    } catch (cause) {
      Alert.alert('Approval failed', cause instanceof Error ? cause.message : 'Could not approve the exception.');
    } finally {
      setSaving(false);
    }
  };

  const remove = (id: string) => {
    if (!membership || saving) return;
    Alert.alert('Remove exception?', 'This employee will return to the normal company schedule for that period.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          try {
            await removeScheduleException({ p_company_id: membership.companyId, p_exception_id: id });
            await load();
          } catch (cause) {
            Alert.alert('Remove failed', cause instanceof Error ? cause.message : 'Could not remove the exception.');
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  if (loading) return <LoadingScreen label="Loading schedule..." />;
  if (!membership) return <Message title="Unavailable" message="Your workspace session is not available." />;

  return <>
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21} /></Pressable>
        <View style={styles.headerCopy}><Text style={styles.eyebrow}>OPERATIONS</Text><Text style={styles.title}>Schedule & Exceptions</Text></View>
        <View style={styles.headerIcon}><Icon name="calendar-outline" color={colors.teal} size={21} /></View>
      </View>

      <Card style={styles.explainer}>
        <View style={styles.explainerTop}><Icon name="checkmark-circle-outline" color={colors.teal} size={23} /><Text style={styles.explainerTitle}>Available by default</Text></View>
        <Text style={styles.explainerText}>Every active employee is automatically treated as available on the company workdays. No employee setup is required unless their schedule is different.</Text>
      </Card>

      {error && <Feedback message={error} />}

      <View style={styles.sectionHeader}><View><Text style={styles.sectionTitle}>Company workweek</Text><Text style={styles.sectionSub}>{defaultSummary} • company default</Text></View>{canEditCompanySchedule(membership) && <Badge label="Editable" tone="teal" />}</View>
      <View style={styles.dayRow}>
        {weekdays.map((day) => {
          const row = scheduleDays.find((item) => item.weekday === day.value) ?? { company_id: membership.companyId, weekday: day.value, is_workday: false, start_time: null, end_time: null };
          return <Pressable key={day.value} disabled={!canEditCompanySchedule(membership) || saving} onPress={() => void toggleDefaultDay(row)} style={[styles.dayChip, row.is_workday && styles.dayChipActive]}>
            <Text style={[styles.dayChipText, row.is_workday && styles.dayChipTextActive]}>{day.short}</Text>
          </Pressable>;
        })}
      </View>
      {canEditCompanySchedule(membership) && <Text style={styles.helper}>Tap a day to add or remove it from the default workweek. Employees inherit this schedule automatically.</Text>}

      {canManageTeam(membership) && <View style={styles.filterRow}>
        <Text style={styles.label}>Employee</Text>
        <View style={styles.selectorWrap}>{employees.map((employee) => <Pressable key={employee.id} onPress={() => setSelectedEmployeeId(employee.id)} style={[styles.selector, effectiveEmployeeId === employee.id && styles.selectorActive]}><Text style={[styles.selectorText, effectiveEmployeeId === employee.id && styles.selectorTextActive]}>{employee.display_name}</Text></Pressable>)}</View>
      </View>}

      <View style={styles.sectionHeader}><View><Text style={styles.sectionTitle}>{canManageTeam(membership) ? `${employeeName}'s exceptions` : 'Your exceptions'}</Text><Text style={styles.sectionSub}>Only record what differs from the normal workweek.</Text></View></View>
      <Pressable onPress={() => setModalOpen(true)} style={styles.addButton}><Icon name="add" color={colors.background} size={20} /><Text style={styles.addText}>Add schedule exception</Text></Pressable>

      {visibleExceptions.length ? visibleExceptions.map((item) => <Card key={item.id} style={styles.exceptionCard}>
        <View style={styles.exceptionTop}><View style={styles.badgeRow}><Badge label={formatStatus(item.kind)} tone={item.kind === 'sick' || item.kind === 'unavailable' ? 'amber' : 'blue'} /><Badge label={item.recurrence === 'weekly' ? 'Weekly' : 'One-time'} tone="neutral" /></View><Badge label={item.approved_at ? 'Approved' : 'Pending'} tone={item.approved_at ? 'teal' : 'amber'} /></View>
        <Text style={styles.exceptionWhen}>{describeException(item)}</Text>
        {item.note && <Text style={styles.note}>{item.note}</Text>}
        <View style={styles.exceptionActions}>{!item.approved_at && canManageTeam(membership) && <Pressable onPress={() => void approve(item.id)} style={styles.inlineAction}><Text style={styles.inlineActionText}>Approve</Text></Pressable>}<Pressable onPress={() => remove(item.id)} style={styles.inlineAction}><Text style={styles.inlineActionText}>Remove</Text></Pressable></View>
      </Card>) : <EmptyState icon="calendar-outline" title="Following normal schedule" message={`${employeeName} has no schedule exceptions. The company workweek applies automatically.`} />}
    </ScrollView>

    <Modal animationType="slide" transparent visible={modalOpen} onRequestClose={() => !saving && setModalOpen(false)}>
      <View style={styles.modalBackdrop}><View style={styles.modal}>
        <View style={styles.modalHeader}><View><Text style={styles.modalTitle}>Add schedule exception</Text><Text style={styles.modalSub}>{employeeName}</Text></View><Pressable disabled={saving} onPress={() => setModalOpen(false)}><Icon name="close" color={colors.muted} size={23} /></Pressable></View>

        <Text style={styles.label}>Reason type</Text>
        <View style={styles.kindRow}>{exceptionKinds.map((option) => <Pressable key={option} onPress={() => setKind(option)} style={[styles.kindButton, kind === option && styles.kindButtonActive]}><Text style={[styles.kindText, kind === option && styles.kindTextActive]}>{formatStatus(option)}</Text></Pressable>)}</View>

        <Text style={styles.label}>Frequency</Text>
        <View style={styles.segment}><Pressable onPress={() => setRecurrence('one_off')} style={[styles.segmentButton, recurrence === 'one_off' && styles.segmentActive]}><Text style={[styles.segmentText, recurrence === 'one_off' && styles.segmentTextActive]}>One-time</Text></Pressable><Pressable onPress={() => setRecurrence('weekly')} style={[styles.segmentButton, recurrence === 'weekly' && styles.segmentActive]}><Text style={[styles.segmentText, recurrence === 'weekly' && styles.segmentTextActive]}>Repeats weekly</Text></Pressable></View>

        {recurrence === 'one_off' ? <>
          <Text style={styles.label}>Start</Text><TextInput value={startsAt} onChangeText={setStartsAt} placeholder="2026-09-20T08:00:00" placeholderTextColor={colors.subtle} style={styles.input} />
          <Text style={styles.label}>End</Text><TextInput value={endsAt} onChangeText={setEndsAt} placeholder="2026-09-20T17:00:00" placeholderTextColor={colors.subtle} style={styles.input} />
        </> : <>
          <Text style={styles.label}>Day</Text><View style={styles.dayRow}>{weekdays.map((day) => <Pressable key={day.value} onPress={() => setWeeklyDay(day.value)} style={[styles.dayChip, weeklyDay === day.value && styles.dayChipActive]}><Text style={[styles.dayChipText, weeklyDay === day.value && styles.dayChipTextActive]}>{day.short}</Text></Pressable>)}</View>
          <Text style={styles.label}>Starts on</Text><TextInput value={effectiveFrom} onChangeText={setEffectiveFrom} placeholder="2026-09-20" placeholderTextColor={colors.subtle} style={styles.input} />
          <Text style={styles.label}>Ends on</Text><TextInput value={effectiveTo} onChangeText={setEffectiveTo} placeholder="Optional" placeholderTextColor={colors.subtle} style={styles.input} />
          <Text style={styles.label}>Partial-day times</Text><View style={styles.twoColumns}><TextInput value={startTime} onChangeText={setStartTime} placeholder="08:00" placeholderTextColor={colors.subtle} style={[styles.input, styles.halfInput]} /><TextInput value={endTime} onChangeText={setEndTime} placeholder="12:00" placeholderTextColor={colors.subtle} style={[styles.input, styles.halfInput]} /></View><Text style={styles.helper}>Leave both times blank to omit the employee for the entire day.</Text>
        </>}

        <Text style={styles.label}>Note</Text><TextInput value={note} onChangeText={setNote} placeholder="Vacation, appointment, class, restriction..." placeholderTextColor={colors.subtle} multiline style={[styles.input, styles.textarea]} />
        <Text style={styles.helper}>The note explains why the employee is omitted. Dispatch uses the structured dates and times above, not guesses from free-form text.</Text>
        <View style={styles.modalActions}><Pressable disabled={saving} onPress={() => setModalOpen(false)} style={styles.cancelButton}><Text style={styles.cancelText}>Cancel</Text></Pressable><Pressable disabled={saving} onPress={() => void saveException()} style={[styles.submitButton, saving && styles.disabled]}><Text style={styles.submitText}>{saving ? 'Saving...' : 'Save exception'}</Text></Pressable></View>
      </View></View>
    </Modal>
  </>;
}

function describeException(item: ScheduleException) {
  if (item.recurrence === 'one_off') {
    if (!item.starts_at || !item.ends_at) return 'One-time schedule exception';
    return `${new Date(item.starts_at).toLocaleString()} → ${new Date(item.ends_at).toLocaleString()}`;
  }
  const day = weekdays.find((option) => option.value === item.weekday)?.long ?? 'Weekly';
  const time = item.start_time && item.end_time ? `${item.start_time.slice(0, 5)}–${item.end_time.slice(0, 5)}` : 'all day';
  const range = item.effective_to ? `${item.effective_from} through ${item.effective_to}` : `starting ${item.effective_from}`;
  return `Every ${day}, ${time}, ${range}`;
}

function Feedback({ message }: { message: string }) { return <View style={styles.failure}><Icon name="alert-circle-outline" color={colors.red} size={18} /><Text style={styles.feedbackText}>{message}</Text></View>; }
function Message({ title, message }: { title: string; message: string }) { return <View style={styles.message}><Icon name="alert-circle-outline" color={colors.amber} size={24} /><Text style={styles.messageTitle}>{title}</Text><Text style={styles.messageText}>{message}</Text><Pressable onPress={() => router.back()} style={styles.backButton}><Text style={styles.backText}>Back</Text></Pressable></View>; }

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flexGrow: 1, gap: spacing.md, padding: spacing.lg, paddingBottom: 110 },
  topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm },
  back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  headerCopy: { flex: 1, marginLeft: spacing.md },
  eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colors.text, ...typography.title, marginTop: 3 },
  headerIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 44, justifyContent: 'center', width: 44 },
  explainer: { padding: spacing.md },
  explainerTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  explainerTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  explainerText: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  sectionTitle: { color: colors.text, ...typography.heading },
  sectionSub: { color: colors.muted, fontSize: 12, marginTop: 3 },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dayChip: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 999, borderWidth: 1, minWidth: 46, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  dayChipActive: { backgroundColor: colors.tealDeep, borderColor: colors.teal },
  dayChipText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  dayChipTextActive: { color: colors.teal },
  helper: { color: colors.subtle, fontSize: 11, lineHeight: 16 },
  filterRow: { gap: spacing.sm, marginTop: spacing.sm },
  label: { color: colors.muted, fontSize: 12, fontWeight: '800', marginTop: spacing.sm, textTransform: 'uppercase' },
  selectorWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  selector: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  selectorActive: { backgroundColor: colors.tealDeep, borderColor: colors.teal },
  selectorText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  selectorTextActive: { color: colors.teal },
  addButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 52 },
  addText: { color: colors.background, fontSize: 14, fontWeight: '800' },
  exceptionCard: { padding: spacing.md },
  exceptionTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  badgeRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  exceptionWhen: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: spacing.md },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  exceptionActions: { borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end', marginTop: spacing.md, paddingTop: spacing.md },
  inlineAction: { backgroundColor: colors.tealDeep, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  inlineActionText: { color: colors.teal, fontSize: 12, fontWeight: '800' },
  failure: { alignItems: 'center', backgroundColor: colors.redDeep, borderRadius: 12, flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  feedbackText: { color: colors.text, flex: 1, fontSize: 13 },
  modalBackdrop: { backgroundColor: '#00000099', flex: 1, justifyContent: 'flex-end' },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', padding: spacing.lg, paddingBottom: 36 },
  modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  modalSub: { color: colors.muted, fontSize: 12, marginTop: 3 },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kindButton: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  kindButtonActive: { backgroundColor: colors.tealDeep, borderColor: colors.teal },
  kindText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  kindTextActive: { color: colors.teal },
  segment: { flexDirection: 'row', gap: spacing.sm },
  segmentButton: { alignItems: 'center', backgroundColor: colors.background, borderColor: colors.border, borderRadius: 12, borderWidth: 1, flex: 1, paddingVertical: spacing.md },
  segmentActive: { backgroundColor: colors.tealDeep, borderColor: colors.teal },
  segmentText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  segmentTextActive: { color: colors.teal },
  input: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 12, borderWidth: 1, color: colors.text, minHeight: 46, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  twoColumns: { flexDirection: 'row', gap: spacing.sm },
  halfInput: { flex: 1 },
  textarea: { minHeight: 78, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  cancelButton: { alignItems: 'center', borderColor: colors.border, borderRadius: 12, borderWidth: 1, flex: 1, paddingVertical: spacing.md },
  cancelText: { color: colors.muted, fontWeight: '800' },
  submitButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, flex: 1.4, paddingVertical: spacing.md },
  submitText: { color: colors.background, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  message: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl },
  messageTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing.md },
  messageText: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm, textAlign: 'center' },
  backButton: { backgroundColor: colors.teal, borderRadius: 12, marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  backText: { color: colors.background, fontWeight: '800' },
});
