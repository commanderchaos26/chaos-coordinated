import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge, Card, EmptyState, Icon } from '../../src/components/FieldUI';
import { TextEntryModal } from '../../src/components/TextEntryModal';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { assignWorkOrder } from '../../src/lib/dispatchCommands';
import { formatStatus, loadEmployeeDirectory } from '../../src/lib/employeeData';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type WorkOrder = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  department_id: string | null;
};

type AssignmentRow = { id: string; employee_id: string; work_order_id: string; status: string };
const canDispatch = (membership: Membership | null) => Boolean(membership?.roles.some((role) => ['owner', 'operations_manager', 'supervisor', 'dispatcher'].includes(role)));

export default function DispatchScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [directory, setDirectory] = useState<Awaited<ReturnType<typeof loadEmployeeDirectory>> | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overrideRequest, setOverrideRequest] = useState<{
    employeeId: string;
    employeeName: string;
  } | null>(null);
  const [overrideBusy, setOverrideBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (!current || !canDispatch(current)) return;
      const [ordersResult, assignmentsResult, dirResult] = await Promise.all([
        supabase.from('work_orders').select('id,title,status,priority,due_at,department_id').eq('company_id', current.companyId).order('due_at', { ascending: true, nullsFirst: false }),
        supabase.from('assignments').select('id,employee_id,work_order_id,status').eq('company_id', current.companyId),
        loadEmployeeDirectory(current.companyId),
      ]);
      if (ordersResult.error) throw ordersResult.error;
      if (assignmentsResult.error) throw assignmentsResult.error;
      const orders = (ordersResult.data ?? []) as WorkOrder[];
      const openOrders = orders.filter((order) => !['completed', 'cancelled', 'closed'].includes((order.status ?? '').toLowerCase()));
      setWorkOrders(openOrders);
      setAssignments((assignmentsResult.data ?? []) as AssignmentRow[]);
      setDirectory(dirResult);
      if (openOrders.length && !selectedOrderId) setSelectedOrderId(openOrders[0].id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load dispatch board.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const selectedOrder = useMemo(() => workOrders.find((order) => order.id === selectedOrderId) ?? null, [selectedOrderId, workOrders]);

  const candidates = useMemo(() => {
    if (!directory || !selectedOrder) return [];
    return directory.employees.map((employee) => {
      const department = directory.departments.find((item) => item.id === employee.primary_department_id);
      const crewMembership = directory.crewMembers.find((row) => row.employee_id === employee.id && row.active);
      const crew = crewMembership ? directory.crews.find((item) => item.id === crewMembership.crew_id) : null;
      const skills = directory.employeeSkills.filter((row) => row.employee_id === employee.id).map((row) => directory.skills.find((skill) => skill.id === row.skill_id)?.name).filter(Boolean) as string[];
      const assignmentCount = assignments.filter((row) => row.employee_id === employee.id && !['completed', 'cancelled', 'closed'].includes((row.status ?? '').toLowerCase())).length;
      return { employee, department, crew, skills, assignmentCount };
    }).filter((item) => item.employee.employment_status?.toLowerCase() !== 'inactive');
  }, [assignments, directory, selectedOrder]);

  if (loading) return <LoadingScreen label="Loading dispatch board..." />;
  if (!membership) return <Message title="Session unavailable" message="Please sign in to access dispatch." />;
  if (!canDispatch(membership)) return <Message title="Dispatch access required" message="Only management roles can use dispatch tools." />;

  return <>
    <TextEntryModal
      visible={Boolean(overrideRequest)}
      title="Override availability?"
      message="This employee is unavailable for the requested assignment. Enter the operational reason for overriding their availability."
      placeholder="Required override reason"
      confirmLabel="Override & assign"
      required
      loading={overrideBusy}
      onCancel={() => {
        if (!overrideBusy) setOverrideRequest(null);
      }}
      onConfirm={async (reason) => {
        if (!membership || !selectedOrder || !overrideRequest || overrideBusy) return;

        setOverrideBusy(true);
        try {
          await assignWorkOrder({
            p_company_id: membership.companyId,
            p_work_order_id: selectedOrder.id,
            p_employee_id: overrideRequest.employeeId,
            p_scheduled_start: null,
            p_scheduled_end: null,
            p_override_availability: true,
            p_override_reason: reason,
          });

          const employeeName = overrideRequest.employeeName;
          setOverrideRequest(null);
          await load();
          Alert.alert(
            'Assignment created',
            `${employeeName} was assigned with an availability override.`,
          );
        } catch (cause) {
          Alert.alert(
            'Assignment failed',
            cause instanceof Error ? cause.message : 'Could not assign work order.',
          );
        } finally {
          setOverrideBusy(false);
        }
      }}
    />
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <View style={styles.topbar}><Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>OPERATIONS</Text><Text style={styles.title}>Dispatch</Text></View><View style={styles.headerIcon}><Icon name="navigate-outline" color={colors.teal} size={21} /></View></View>
      {error && <Feedback tone="error" message={error} />}
      <Text style={styles.sectionTitle}>Open work orders</Text>
      {workOrders.length ? <View style={styles.orderList}>{workOrders.map((order) => <Pressable key={order.id} onPress={() => setSelectedOrderId(order.id)} style={[styles.orderCard, selectedOrderId === order.id && styles.orderCardSelected]}><View style={styles.orderHeader}><Badge label={order.priority || 'normal'} tone={['urgent', 'high'].includes((order.priority || '').toLowerCase()) ? 'red' : 'amber'} /><Text style={styles.status}>{formatStatus(order.status)}</Text></View><Text style={styles.orderTitle}>{order.title}</Text><Text style={styles.orderMeta}>{order.due_at ? `Due ${new Date(order.due_at).toLocaleString()}` : 'No due date'}</Text></Pressable>)}</View> : <EmptyState icon="construct-outline" title="No open work orders" message="The current queue is clear. New work will appear here automatically." />}
      {selectedOrder && <View style={styles.assignmentPanel}><Text style={styles.sectionTitle}>{selectedOrder.title}</Text><View style={styles.assignmentMeta}><Text style={styles.metaText}>Priority: {selectedOrder.priority}</Text><Text style={styles.metaText}>Status: {formatStatus(selectedOrder.status)}</Text></View><Text style={styles.metaText}>Current assignment: {assignments.some((row) => row.work_order_id === selectedOrder.id) ? 'Assigned' : 'Unassigned'}</Text>{candidates.length ? <View style={styles.candidateList}>{candidates.map((candidate) => <CandidateCard key={candidate.employee.id} candidate={candidate} onAssign={() => handleAssign(candidate.employee.id)} />)}</View> : <EmptyState icon="people-outline" title="No available candidates" message="No employees are currently visible for assignment in this company." />}</View>}
    </ScrollView>
  </>;

  async function handleAssign(employeeId: string) {
    if (!membership || !selectedOrder) return;
    const employee = directory?.employees.find((item) => item.id === employeeId);
    if (!employee) return;
    Alert.alert('Assign work order', `Assign ${employee.display_name} to ${selectedOrder.title}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Assign', onPress: async () => {
        try {
          await assignWorkOrder({ p_company_id: membership.companyId, p_work_order_id: selectedOrder.id, p_employee_id: employeeId, p_scheduled_start: null, p_scheduled_end: null, p_override_availability: false, p_override_reason: null });
          await load();
          Alert.alert('Assignment created', `${employee.display_name} was assigned to the work order.`);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'Could not assign work order.';
          if (message.toLowerCase().includes('employee_unavailable')) {
            setOverrideRequest({
              employeeId,
              employeeName: employee.display_name,
            });
            return;
          }
          Alert.alert('Assignment failed', message);
        }
      } },
    ]);
  }
}

function CandidateCard({ candidate, onAssign }: { candidate: { employee: any; department: any; crew: any; skills: string[]; assignmentCount: number }; onAssign: () => void }) {
  const strong = candidate.skills.length > 0 || candidate.assignmentCount === 0;
  return <Card style={[styles.candidateCard, strong && styles.candidateStrong]}><View style={styles.candidateHeader}><View><Text style={styles.candidateName}>{candidate.employee.display_name}</Text><Text style={styles.candidateMeta}>{candidate.department?.name ?? 'No department'} • {candidate.crew?.name ?? 'No crew'}</Text></View><Badge label={candidate.employee.floater_eligible ? 'Floater' : 'Fixed'} tone={candidate.employee.floater_eligible ? 'teal' : 'neutral'} /></View><Text style={styles.skillLine}>{candidate.skills.length ? candidate.skills.slice(0, 3).join(', ') : 'No skills assigned'}</Text><Text style={styles.metaText}>Current workload: {candidate.assignmentCount} active assignment{candidate.assignmentCount === 1 ? '' : 's'}</Text><Pressable onPress={onAssign} style={styles.assignButton}><Text style={styles.assignText}>Assign</Text></Pressable></Card>;
}

function Feedback({ tone, message }: { tone: 'success' | 'error'; message: string }) { return <View style={[styles.feedback, tone === 'success' ? styles.success : styles.failure]}><Icon name={tone === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline'} color={tone === 'success' ? colors.teal : colors.red} size={18} /><Text style={styles.feedbackText}>{message}</Text></View>; }
function Message({ title, message }: { title: string; message: string }) { return <View style={styles.message}><Icon name="alert-circle-outline" color={colors.amber} size={24} /><Text style={styles.messageTitle}>{title}</Text><Text style={styles.messageText}>{message}</Text><Pressable onPress={() => router.back()} style={styles.backButton}><Text style={styles.backText}>Back</Text></Pressable></View>; }

const styles = StyleSheet.create({ root: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg, paddingBottom: 110 }, topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm }, back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 }, headerCopy: { flex: 1, marginLeft: spacing.md }, eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }, title: { color: colors.text, ...typography.title, marginTop: 3 }, headerIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 44, justifyContent: 'center', width: 44 }, sectionTitle: { color: colors.text, ...typography.heading, marginTop: spacing.lg, marginBottom: spacing.md }, orderList: { gap: spacing.sm }, orderCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, padding: spacing.md }, orderCardSelected: { borderColor: colors.teal }, orderHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, status: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }, orderTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: spacing.md }, orderMeta: { color: colors.muted, fontSize: 12, marginTop: spacing.sm }, assignmentPanel: { marginTop: spacing.xl }, assignmentMeta: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md }, metaText: { color: colors.muted, fontSize: 12, marginTop: 3 }, candidateList: { gap: spacing.sm }, candidateCard: { padding: spacing.md }, candidateStrong: { borderColor: colors.teal, borderWidth: 1 }, candidateHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, candidateName: { color: colors.text, fontSize: 15, fontWeight: '800' }, candidateMeta: { color: colors.muted, fontSize: 12, marginTop: 4 }, skillLine: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: spacing.md }, assignButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, marginTop: spacing.md, paddingVertical: spacing.sm }, assignText: { color: colors.background, fontWeight: '800' }, feedback: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: spacing.sm, padding: spacing.md }, success: { backgroundColor: colors.tealDeep }, failure: { backgroundColor: colors.redDeep }, feedbackText: { color: colors.text, flex: 1, fontSize: 13 }, message: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl }, messageTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing.md }, messageText: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm, textAlign: 'center' }, backButton: { backgroundColor: colors.teal, borderRadius: 12, marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md }, backText: { color: colors.background, fontWeight: '800' }, });
