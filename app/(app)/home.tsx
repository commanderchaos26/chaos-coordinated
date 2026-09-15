import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionTile, Badge, Card, EmptyState, Icon, MetricCard, SectionHeader } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { useAuth } from '../../src/context/AuthProvider';
import { respondToAssignment, transitionAssignment } from '../../src/lib/dispatchCommands';
import { formatStatus } from '../../src/lib/employeeData';
import { completeAdmission, loadMembership } from '../../src/lib/membership';
import { registerForPushNotifications, registerNotificationTapHandler } from '../../src/lib/pushNotifications';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type AssignmentRow = {
  id: string;
  employee_id: string;
  work_order_id: string;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  work_orders?: { id: string; title: string; priority: string; due_at: string | null; status: string } | null;
};

type WorkOrderSummary = { id: string; title: string; priority: string; due_at: string | null; status: string };

export default function HomeScreen() {
  const { signOut } = useAuth();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[]>([]);
  const [notificationCount, setNotificationCount] = useState(0);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      await completeAdmission().catch(() => undefined);
      const current = await loadMembership();
      setMembership(current);
      if (!current) return;
      void registerForPushNotifications(current.companyId);

      const [assignmentResult, notificationResult, workOrderResult] = await Promise.all([
        supabase.from('assignments').select('id,employee_id,work_order_id,status,scheduled_start,scheduled_end,work_orders:work_orders(id,title,priority,due_at,status)').eq('company_id', current.companyId).eq('employee_id', current.employeeId).order('scheduled_start', { ascending: true, nullsFirst: false }),
        supabase.from('employee_notifications').select('id').eq('company_id', current.companyId).eq('employee_id', current.employeeId).is('read_at', null).is('acknowledged_at', null),
        supabase.from('work_orders').select('id,title,priority,due_at,status').eq('company_id', current.companyId).order('due_at', { ascending: true, nullsFirst: false }),
      ]);
      if (assignmentResult.error) throw assignmentResult.error;
      if (notificationResult.error) throw notificationResult.error;
      if (workOrderResult.error) throw workOrderResult.error;
      setAssignments((assignmentResult.data ?? []) as unknown as AssignmentRow[]);
      setNotificationCount((notificationResult.data ?? []).length);
      setWorkOrders((workOrderResult.data ?? []) as WorkOrderSummary[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your workspace.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const unsub = registerNotificationTapHandler();
    return () => unsub();
  }, []);

  const metrics = useMemo(() => {
    const openCount = workOrders.filter((item) => !['completed', 'cancelled', 'closed'].includes((item.status ?? '').toLowerCase())).length;
    const inProgressCount = assignments.filter((item) => ['accepted', 'active', 'paused', 'submitted'].includes((item.status ?? '').toLowerCase())).length;
    const needsAttention = assignments.filter((item) => ['offered', 'declined'].includes((item.status ?? '').toLowerCase())).length + workOrders.filter((item) => ['overdue', 'urgent'].includes((item.priority || '').toLowerCase())).length;
    return { openCount, inProgressCount, needsAttention };
  }, [assignments, workOrders]);

  const handleAction = async (assignmentId: string, action: 'accept' | 'decline' | 'start' | 'pause' | 'resume' | 'submit', reason?: string) => {
    if (!membership) return;
    setProcessingId(assignmentId);
    try {
      if (action === 'accept' || action === 'decline') {
        await respondToAssignment({
          p_company_id: membership.companyId,
          p_assignment_id: assignmentId,
          p_response: action === 'accept' ? 'accepted' : 'declined',
          p_decline_reason: action === 'decline' ? (reason || 'No reason provided') : null,
        });
      } else {
        await transitionAssignment({
          p_company_id: membership.companyId,
          p_assignment_id: assignmentId,
          p_action: action === 'resume' ? 'start' : action,
          p_reason: reason || null,
        });
      }
      await load();
    } catch (cause) {
      Alert.alert('Action failed', cause instanceof Error ? cause.message : 'Could not update assignment.');
    } finally {
      setProcessingId(null);
    }
  };

  const requestReason = (assignmentId: string, action: 'decline' | 'submit', title: string, message: string, fallback: string) => {
    Alert.prompt(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action === 'decline' ? 'Decline' : 'Submit',
        onPress: (value?: string) => { void handleAction(assignmentId, action, value || fallback); },
      },
    ], 'plain-text', fallback);
  };

  if (loading) return <LoadingScreen label="Loading your workspace…" />;

  return (
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>{membership?.companyName ?? 'CHAOS COORDINATED'}</Text>
          <Text style={styles.title}>Good morning, {membership?.displayName?.split(' ')[0] ?? 'team'}</Text>
          <Text style={styles.roles}>{membership?.roles.join('  •  ') || 'Workspace overview'}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push('/(app)/notifications' as never)} style={styles.bell}>
            <Icon name="notifications-outline" color={colors.teal} size={21} />
            {notificationCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{notificationCount}</Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={signOut} style={styles.profileButton}>
            <Icon name="person-outline" color={colors.teal} size={21} />
          </Pressable>
        </View>
      </View>

      <View style={styles.metrics}>
        <MetricCard icon="briefcase-outline" label="Open work" value={String(metrics.openCount)} />
        <MetricCard icon="sync-outline" label="In progress" value={String(metrics.inProgressCount)} tone="blue" />
        <MetricCard icon="alert-circle-outline" label="Needs attention" value={String(metrics.needsAttention)} tone="amber" />
      </View>

      <SectionHeader title="Today's work" action="View all" onAction={() => router.push('/(app)/work-orders' as never)} />

      {assignments.length ? (
        assignments.map((assignment) => {
          const task = assignment.work_orders;
          const status = (assignment.status ?? '').toLowerCase();
          const isBusy = processingId === assignment.id;
          const showDecline = status === 'offered';
          const showStart = ['accepted', 'paused'].includes(status);
          const showPause = status === 'active';
          const showSubmit = ['active', 'paused'].includes(status) || status === 'accepted';

          return (
            <Card key={assignment.id} style={styles.assignmentCard}>
              <Text style={styles.assignmentTitle}>{task?.title || 'Task'}</Text>
              <View style={styles.assignmentMeta}>
                <Badge label={task?.priority || 'normal'} tone={['urgent', 'high'].includes((task?.priority || '').toLowerCase()) ? 'red' : 'amber'} />
                <Badge label={formatStatus(assignment.status)} tone={status === 'submitted' ? 'blue' : 'teal'} />
              </View>
              <Text style={styles.assignmentText}>{task?.due_at ? `Due ${new Date(task.due_at).toLocaleString()}` : 'No due date set'}</Text>

              {showDecline && (
                <View style={styles.buttonRow}>
                  <Pressable disabled={isBusy} onPress={() => void handleAction(assignment.id, 'accept')} style={[styles.primary, isBusy && styles.disabledButton]}>
                    <Text style={styles.primaryText}>Accept</Text>
                  </Pressable>
                  <Pressable disabled={isBusy} onPress={() => requestReason(assignment.id, 'decline', 'Decline assignment', 'Please provide a reason.', 'No reason provided')} style={[styles.secondary, isBusy && styles.disabledButton]}>
                    <Text style={styles.secondaryText}>Decline</Text>
                  </Pressable>
                </View>
              )}

              {showStart && (
                <Pressable disabled={isBusy} onPress={() => void handleAction(assignment.id, status === 'paused' ? 'resume' : 'start')} style={[styles.primary, isBusy && styles.disabledButton]}>
                  <Text style={styles.primaryText}>{status === 'paused' ? 'Resume' : 'Start'}</Text>
                </Pressable>
              )}

              {showPause && (
                <View style={styles.buttonRow}>
                  <Pressable disabled={isBusy} onPress={() => void handleAction(assignment.id, 'pause')} style={[styles.secondary, isBusy && styles.disabledButton]}>
                    <Text style={styles.secondaryText}>Pause</Text>
                  </Pressable>
                  <Pressable disabled={isBusy} onPress={() => requestReason(assignment.id, 'submit', 'Submit work', 'Add a submission note.', 'Submitted from mobile')} style={[styles.primary, isBusy && styles.disabledButton]}>
                    <Text style={styles.primaryText}>Submit work</Text>
                  </Pressable>
                </View>
              )}

              {showSubmit && !showPause && status !== 'submitted' && (
                <Pressable disabled={isBusy} onPress={() => requestReason(assignment.id, 'submit', 'Submit work', 'Add a submission note.', 'Submitted from mobile')} style={[styles.primary, isBusy && styles.disabledButton]}>
                  <Text style={styles.primaryText}>Submit work</Text>
                </Pressable>
              )}

              {status === 'submitted' && <Text style={styles.assignmentText}>Awaiting verification.</Text>}
            </Card>
          );
        })
      ) : (
        <EmptyState icon="checkmark-done-outline" title="No active assignments" message="When you are assigned work, it will appear here with the right actions." />
      )}

      {error && (
        <Card style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </Card>
      )}

      <SectionHeader title="Quick actions" />
      <View style={styles.actions}>
        <ActionTile icon="calendar-outline" title="My availability" subtitle="Submit or review your schedule" onPress={() => router.push('/(app)/availability' as never)} />
        <ActionTile icon="construct-outline" title="Work orders" subtitle="Review open tasks" onPress={() => router.push('/(app)/work-orders' as never)} />
        <ActionTile icon="people-outline" title="Management center" subtitle="People and operations" onPress={() => router.push('/(app)/management' as never)} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, gap: spacing.lg, padding: spacing.lg, paddingBottom: 110 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm },
  eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: spacing.xs },
  title: { color: colors.text, ...typography.title },
  roles: { color: colors.muted, fontSize: 13, marginTop: 5 },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  profileButton: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 44, justifyContent: 'center', width: 44 },
  bell: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 44, justifyContent: 'center', position: 'relative', width: 44 },
  badge: { alignItems: 'center', backgroundColor: colors.red, borderRadius: 999, height: 18, justifyContent: 'center', minWidth: 18, position: 'absolute', right: -6, top: -6 },
  badgeText: { color: colors.background, fontSize: 10, fontWeight: '800' },
  metrics: { flexDirection: 'row', gap: spacing.sm },
  assignmentCard: { padding: spacing.md },
  assignmentTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  assignmentMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  assignmentText: { color: colors.muted, fontSize: 13, marginTop: spacing.sm },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  primary: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 48 },
  primaryText: { color: colors.background, fontWeight: '800' },
  secondary: { alignItems: 'center', backgroundColor: colors.surfaceSoft, borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 48 },
  secondaryText: { color: colors.text, fontWeight: '800' },
  disabledButton: { opacity: 0.6 },
  errorCard: { backgroundColor: colors.redDeep, padding: spacing.md },
  errorText: { color: colors.text, fontSize: 12 },
  actions: { gap: spacing.sm },
});
