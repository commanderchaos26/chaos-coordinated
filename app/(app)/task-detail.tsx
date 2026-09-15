import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge, Card, EmptyState, Icon } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { respondToAssignment, transitionAssignment } from '../../src/lib/dispatchCommands';
import { formatStatus } from '../../src/lib/employeeData';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing } from '../../src/theme';

export default function TaskDetailScreen() {
  const { id, assignmentId } = useLocalSearchParams<{ id?: string; assignmentId?: string }>();
  const [membership, setMembership] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workOrder, setWorkOrder] = useState<any>(null);
  const [assignment, setAssignment] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (!current) return;
      const workOrderId = id || assignmentId || null;
      if (!workOrderId) return;
      const [workOrderResult, assignmentResult] = await Promise.all([
        supabase.from('work_orders').select('*').eq('id', workOrderId).maybeSingle(),
        supabase.from('assignments').select('*').eq('work_order_id', workOrderId).order('created_at', { ascending: false }).limit(1),
      ]);
      if (workOrderResult.error) throw workOrderResult.error;
      if (assignmentResult.error) throw assignmentResult.error;
      setWorkOrder(workOrderResult.data);
      setAssignment((assignmentResult.data ?? [])[0] ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load task.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [id, assignmentId]);

  const handleAction = async (action: 'accept' | 'decline' | 'start' | 'pause' | 'resume' | 'submit', options?: { reason?: string }) => {
    if (!membership || !assignment) return;
    try {
      if (action === 'accept' || action === 'decline') {
        const reason = action === 'decline' ? (options?.reason || 'No reason provided') : null;
        if (action === 'decline' && !reason) {
          Alert.alert('Reason required', 'A decline reason is required.');
          return;
        }
        await respondToAssignment({
          p_company_id: membership.companyId,
          p_assignment_id: assignment.id,
          p_response: action === 'accept' ? 'accepted' : 'declined',
          p_decline_reason: action === 'decline' ? reason : null,
        });
      } else {
        const mappedAction = action === 'resume' ? 'start' : action;
        await transitionAssignment({
          p_company_id: membership.companyId,
          p_assignment_id: assignment.id,
          p_action: mappedAction as any,
          p_reason: options?.reason || null,
        });
      }
      await load();
      Alert.alert('Update sent', 'The assignment status was updated.');
    } catch (cause) {
      Alert.alert('Update failed', cause instanceof Error ? cause.message : 'Could not update assignment.');
    }
  };

  const requestReason = (title: string, message: string, fallback: string, action: 'decline' | 'submit') => {
    Alert.prompt(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action === 'decline' ? 'Decline' : 'Submit',
        onPress: (value?: string) => { void handleAction(action, { reason: value || fallback }); },
      },
    ], 'plain-text', fallback);
  };

  if (loading) return <LoadingScreen label="Loading task..." />;
  if (!workOrder && !assignment) return <Message title="Task unavailable" message="This task could not be found." />;

  const status = (assignment?.status ?? workOrder?.status ?? 'unknown').toLowerCase();

  return (
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Icon name="arrow-back" color={colors.text} size={21} />
        </Pressable>
        <Text style={styles.titleText}>Task detail</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {workOrder ? (
        <Card style={styles.card}>
          <Text style={styles.heading}>{workOrder.title}</Text>
          <View style={styles.metaRow}>
            <Badge label={workOrder.priority || 'normal'} tone={['urgent', 'high'].includes((workOrder.priority || '').toLowerCase()) ? 'red' : 'amber'} />
            <Badge label={formatStatus(workOrder.status)} tone={workOrder.status === 'completed' ? 'teal' : 'blue'} />
          </View>
          <Text style={styles.metaText}>Status: {formatStatus(workOrder.status)}</Text>
          {workOrder.due_at && <Text style={styles.metaText}>Due: {new Date(workOrder.due_at).toLocaleString()}</Text>}
          {workOrder.description && <Text style={styles.description}>{workOrder.description}</Text>}
        </Card>
      ) : (
        <EmptyState icon="construct-outline" title="Task not loaded" message="This task has no visible work-order details." />
      )}

      {assignment && (
        <Card style={styles.card}>
          <Text style={styles.subTitle}>Assignment</Text>
          <Text style={styles.metaText}>Assignment status: {formatStatus(assignment.status)}</Text>
          <Text style={styles.metaText}>
            Scheduled: {assignment.scheduled_start ? new Date(assignment.scheduled_start).toLocaleString() : 'No start set'}
            {assignment.scheduled_end ? ` → ${new Date(assignment.scheduled_end).toLocaleString()}` : ''}
          </Text>

          {status === 'offered' && (
            <View style={styles.buttonRow}>
              <Pressable onPress={() => void handleAction('accept')} style={styles.primary}><Text style={styles.primaryText}>Accept</Text></Pressable>
              <Pressable onPress={() => requestReason('Decline assignment', 'Please provide a reason.', 'No reason provided', 'decline')} style={styles.secondary}><Text style={styles.secondaryText}>Decline</Text></Pressable>
            </View>
          )}

          {['accepted', 'paused'].includes(status) && (
            <View style={styles.buttonRow}>
              <Pressable onPress={() => void handleAction(status === 'paused' ? 'resume' : 'start')} style={styles.primary}>
                <Text style={styles.primaryText}>{status === 'paused' ? 'Resume' : 'Start'}</Text>
              </Pressable>
              {status !== 'paused' && (
                <Pressable onPress={() => requestReason('Submit work', 'Add a submission note.', 'Submitted from mobile', 'submit')} style={styles.secondary}>
                  <Text style={styles.secondaryText}>Submit work</Text>
                </Pressable>
              )}
            </View>
          )}

          {status === 'active' && (
            <View style={styles.buttonRow}>
              <Pressable onPress={() => void handleAction('pause')} style={styles.secondary}><Text style={styles.secondaryText}>Pause</Text></Pressable>
              <Pressable onPress={() => requestReason('Submit work', 'Add a note.', 'Submitted from mobile', 'submit')} style={styles.primary}><Text style={styles.primaryText}>Submit work</Text></Pressable>
            </View>
          )}

          {status === 'submitted' && <Text style={styles.metaText}>Awaiting verification.</Text>}
        </Card>
      )}
    </ScrollView>
  );
}

function Message({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.message}>
      <Icon name="alert-circle-outline" color={colors.amber} size={25} />
      <Text style={styles.messageTitle}>{title}</Text>
      <Text style={styles.messageText}>{message}</Text>
      <Pressable onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backText}>Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg, paddingBottom: 110 },
  topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm },
  back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  titleText: { color: colors.text, flex: 1, fontSize: 20, fontWeight: '800', marginLeft: spacing.md },
  card: { marginTop: spacing.md, padding: spacing.md },
  heading: { color: colors.text, fontSize: 20, fontWeight: '800' },
  subTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: spacing.md },
  metaRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  metaText: { color: colors.muted, fontSize: 13, marginTop: spacing.sm },
  description: { color: colors.muted, lineHeight: 20, marginTop: spacing.md },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  primary: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 48 },
  primaryText: { color: colors.background, fontWeight: '800' },
  secondary: { alignItems: 'center', backgroundColor: colors.surfaceSoft, borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 48 },
  secondaryText: { color: colors.text, fontWeight: '800' },
  error: { color: colors.red, fontSize: 12, marginTop: spacing.md },
  message: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 18, borderWidth: 1, flex: 1, justifyContent: 'center', margin: spacing.lg, padding: spacing.xl },
  messageTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing.md },
  messageText: { color: colors.muted, fontSize: 13, marginTop: spacing.sm, textAlign: 'center' },
  backButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, marginTop: spacing.lg, minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  backText: { color: colors.background, fontWeight: '800' },
});
