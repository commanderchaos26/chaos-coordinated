import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Badge, Card, EmptyState, Icon } from '../../src/components/FieldUI';
import { TextEntryModal } from '../../src/components/TextEntryModal';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { respondToAssignment, transitionAssignment } from '../../src/lib/dispatchCommands';
import { formatStatus } from '../../src/lib/employeeData';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import { getCompletionEvidence, uploadCompletionPhoto, type CompletionEvidence } from '../../src/lib/workEvidence';
import { colors, spacing } from '../../src/theme';

export default function TaskDetailScreen() {
  const { id, assignmentId } = useLocalSearchParams<{ id?: string; assignmentId?: string }>();
  const [membership, setMembership] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workOrder, setWorkOrder] = useState<any>(null);
  const [assignment, setAssignment] = useState<any>(null);
  const [processing, setProcessing] = useState(false);
  const [reasonModal, setReasonModal] = useState<{ title: string; message: string; fallback: string } | null>(null);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionNote, setCompletionNote] = useState('Completed from mobile');
  const [completionPhotos, setCompletionPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [storedEvidence, setStoredEvidence] = useState<CompletionEvidence[]>([]);

  const refreshStoredEvidence = async (current: any, assignmentRow: any, workOrderId: string) => {
    try {
      const evidence = await getCompletionEvidence({
        companyId: current.companyId,
        assignmentId: assignmentRow.id,
        workOrderId,
      });
      setStoredEvidence(evidence);
    } catch {
      setStoredEvidence([]);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (!current) return;
      if (assignmentId) {
        const assignmentResult = await supabase
          .from('assignments')
          .select('*')
          .eq('company_id', current.companyId)
          .eq('id', assignmentId)
          .maybeSingle();

        if (assignmentResult.error) throw assignmentResult.error;
        const exactAssignment = assignmentResult.data;
        if (!exactAssignment) {
          setAssignment(null);
          setWorkOrder(null);
          return;
        }

        const workOrderResult = await supabase
          .from('work_orders')
          .select('*')
          .eq('company_id', current.companyId)
          .eq('id', exactAssignment.work_order_id)
          .maybeSingle();
        if (workOrderResult.error) throw workOrderResult.error;

        setAssignment(exactAssignment);
        setWorkOrder(workOrderResult.data);
        await refreshStoredEvidence(current, exactAssignment, exactAssignment.work_order_id);
        return;
      }

      if (!id) {
        setAssignment(null);
        setWorkOrder(null);
        setStoredEvidence([]);
        return;
      }

      const [workOrderResult, assignmentResult] = await Promise.all([
        supabase.from('work_orders').select('*').eq('company_id', current.companyId).eq('id', id).maybeSingle(),
        supabase.from('assignments').select('*').eq('company_id', current.companyId).eq('work_order_id', id).order('created_at', { ascending: false }).limit(1),
      ]);

      if (workOrderResult.error) throw workOrderResult.error;
      if (assignmentResult.error) throw assignmentResult.error;

      const latestAssignment = (assignmentResult.data ?? [])[0] ?? null;
      setWorkOrder(workOrderResult.data);
      setAssignment(latestAssignment);
      if (latestAssignment && workOrderResult.data?.id) {
        await refreshStoredEvidence(current, latestAssignment, workOrderResult.data.id);
      } else {
        setStoredEvidence([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load task.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [id, assignmentId]);

  const handleAction = async (action: 'accept' | 'decline' | 'start' | 'pause' | 'resume', options?: { reason?: string }) => {
    if (!membership || !assignment || processing) return;
    setProcessing(true);
    try {
      if (action === 'accept' || action === 'decline') {
        const reason = action === 'decline' ? (options?.reason || 'No reason provided') : null;
        await respondToAssignment({
          p_company_id: membership.companyId,
          p_assignment_id: assignment.id,
          p_response: action === 'accept' ? 'accepted' : 'declined',
          p_decline_reason: action === 'decline' ? reason : null,
        });
      } else {
        await transitionAssignment({
          p_company_id: membership.companyId,
          p_assignment_id: assignment.id,
          p_action: action === 'resume' ? 'start' : action,
          p_reason: options?.reason || null,
        });
      }
      await load();
      Alert.alert('Update sent', 'The assignment status was updated.');
    } catch (cause) {
      Alert.alert('Update failed', cause instanceof Error ? cause.message : 'Could not update assignment.');
    } finally {
      setProcessing(false);
    }
  };

  const takeCompletionPhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera permission required', 'Allow camera access to photograph the completed work.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
      });
      if (!result.canceled && result.assets?.[0]) {
        setCompletionPhotos((current) => [...current, result.assets[0]]);
      }
    } catch (cause) {
      Alert.alert('Camera unavailable', cause instanceof Error ? cause.message : 'Could not open the camera.');
    }
  };

  const submitCompletion = async () => {
    if (!membership || !assignment || !workOrder || processing) return;
    setProcessing(true);
    try {
      const { data: currentAssignment, error: assignmentError } = await supabase
        .from('assignments')
        .select('status')
        .eq('company_id', membership.companyId)
        .eq('id', assignment.id)
        .maybeSingle();
      if (assignmentError) throw assignmentError;
      if (!currentAssignment) throw new Error('Assignment not found.');
      const currentStatus = String(currentAssignment.status ?? '').toLowerCase();
      if (!['active', 'paused'].includes(currentStatus)) {
        throw new Error('Start this assignment before submitting completed work.');
      }

      for (const photo of completionPhotos) {
        await uploadCompletionPhoto({
          companyId: membership.companyId,
          assignmentId: assignment.id,
          workOrderId: workOrder.id,
          uri: photo.uri,
          mimeType: photo.mimeType,
          byteSize: photo.fileSize,
        });
      }

      await transitionAssignment({
        p_company_id: membership.companyId,
        p_assignment_id: assignment.id,
        p_action: 'submit',
        p_reason: completionNote.trim() || 'Completed from mobile',
      });

      setCompletionOpen(false);
      setCompletionPhotos([]);
      setCompletionNote('Completed from mobile');
      await load();
      Alert.alert(
        'Work completed',
        completionPhotos.length
          ? `Completed with ${completionPhotos.length} completion photo${completionPhotos.length === 1 ? '' : 's'}. Downstream work is now eligible when its dependencies are satisfied.`
          : 'Work completed. Downstream work is now eligible when its dependencies are satisfied.',
      );
    } catch (cause) {
      Alert.alert('Could not complete work', cause instanceof Error ? cause.message : 'The work was not completed.');
    } finally {
      setProcessing(false);
    }
  };

  const openCompletion = () => {
    setCompletionNote('Completed from mobile');
    setCompletionPhotos([]);
    setCompletionOpen(true);
  };

  if (loading) return <LoadingScreen label="Loading task..." />;
  if (!workOrder && !assignment) return <Message title="Task unavailable" message="This task could not be found." />;

  const status = (assignment?.status ?? workOrder?.status ?? 'unknown').toLowerCase();

  return (
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <TextEntryModal
        visible={Boolean(reasonModal)}
        title={reasonModal?.title ?? ''}
        message={reasonModal?.message}
        initialValue={reasonModal?.fallback ?? ''}
        confirmLabel="Decline"
        required
        loading={processing}
        onCancel={() => setReasonModal(null)}
        onConfirm={async (value) => {
          const current = reasonModal;
          if (!current) return;
          setReasonModal(null);
          await handleAction('decline', { reason: value || current.fallback });
        }}
      />

      <Modal visible={completionOpen} transparent animationType="slide" onRequestClose={() => !processing && setCompletionOpen(false)}>
        <View style={styles.modalShade}>
          <View style={styles.completionModal}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalEyebrow}>COMPLETION EVIDENCE</Text>
                <Text style={styles.modalTitle}>Complete finished work</Text>
              </View>
              <Pressable disabled={processing} onPress={() => setCompletionOpen(false)} style={styles.closeButton}>
                <Icon name="close" color={colors.text} size={22} />
              </Pressable>
            </View>

            <Text style={styles.modalCopy}>Take photos of the finished work before completing it. Completion releases dependent work automatically. The only mandatory approval is the final unit inspection after the final clean.</Text>

            <Pressable disabled={processing} onPress={() => void takeCompletionPhoto()} style={styles.cameraButton}>
              <Icon name="camera-outline" color={colors.background} size={22} />
              <Text style={styles.cameraText}>Open camera & take photo</Text>
            </Pressable>

            {completionPhotos.length ? (
              <View style={styles.photoGrid}>
                {completionPhotos.map((photo, index) => (
                  <View key={`${photo.uri}-${index}`} style={styles.photoWrap}>
                    <Image source={{ uri: photo.uri }} style={styles.photo} />
                    <Pressable
                      disabled={processing}
                      onPress={() => setCompletionPhotos((current) => current.filter((_, i) => i !== index))}
                      style={styles.removePhoto}
                    >
                      <Icon name="close-circle" color={colors.text} size={22} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.photoEmpty}>
                <Icon name="images-outline" color={colors.subtle} size={24} />
                <Text style={styles.photoEmptyText}>No completion photos attached yet.</Text>
              </View>
            )}

            <Text style={styles.fieldLabel}>Completion note</Text>
            <TextInput
              value={completionNote}
              onChangeText={setCompletionNote}
              multiline
              placeholder="Describe what was completed."
              placeholderTextColor={colors.subtle}
              style={styles.noteInput}
            />

            <View style={styles.modalActions}>
              <Pressable disabled={processing} onPress={() => setCompletionOpen(false)} style={styles.secondary}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable disabled={processing} onPress={() => void submitCompletion()} style={[styles.primary, processing && styles.disabled]}>
                <Text style={styles.primaryText}>{processing ? 'Uploading & completing…' : 'Complete work'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
            <Badge label={workOrder.priority || 'normal'} tone={['urgent', 'high', 'emergency'].includes((workOrder.priority || '').toLowerCase()) ? 'red' : 'amber'} />
            <Badge label={formatStatus(workOrder.status)} tone={workOrder.status === 'completed' ? 'teal' : 'blue'} />
          </View>
          <Text style={styles.metaText}>Status: {formatStatus(workOrder.status)}</Text>
          {workOrder.due_at && <Text style={styles.metaText}>Due: {new Date(workOrder.due_at).toLocaleString()}</Text>}
          {workOrder.description && <Text style={styles.description}>{workOrder.description}</Text>}
        </Card>
      ) : (
        <EmptyState icon="construct-outline" title="Task not loaded" message="This task has no visible work-order details." />
      )}

      {storedEvidence.length ? (
        <Card style={styles.card}>
          <Text style={styles.subTitle}>Saved completion evidence</Text>
          <Text style={styles.metaText}>{storedEvidence.length} saved {storedEvidence.length === 1 ? 'photo' : 'photos'} attached to this assignment.</Text>
          <View style={styles.savedPhotoGrid}>
            {storedEvidence.map((item) => (
              <View key={item.id} style={styles.savedPhotoWrap}>
                <Image source={{ uri: item.signedUrl }} style={styles.savedPhoto} />
                <Text style={styles.savedPhotoDate}>{new Date(item.capturedAt).toLocaleString()}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

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
              <Pressable onPress={() => setReasonModal({ title: 'Decline assignment', message: 'Please provide a reason.', fallback: 'No reason provided' })} style={styles.secondary}><Text style={styles.secondaryText}>Decline</Text></Pressable>
            </View>
          )}

          {status === 'accepted' && (
            <View style={styles.buttonRow}>
              <Pressable onPress={() => void handleAction('start')} style={styles.primary}>
                <Text style={styles.primaryText}>Start</Text>
              </Pressable>
            </View>
          )}

          {status === 'paused' && (
            <View style={styles.buttonRow}>
              <Pressable onPress={() => void handleAction('resume')} style={styles.secondary}>
                <Text style={styles.secondaryText}>Resume</Text>
              </Pressable>
              <Pressable onPress={openCompletion} style={styles.primary}>
                <Icon name="camera-outline" color={colors.background} size={18} />
                <Text style={styles.primaryText}>Complete work</Text>
              </Pressable>
            </View>
          )}

          {status === 'active' && (
            <View style={styles.buttonRow}>
              <Pressable onPress={() => void handleAction('pause')} style={styles.secondary}><Text style={styles.secondaryText}>Pause</Text></Pressable>
              <Pressable onPress={openCompletion} style={styles.primary}>
                <Icon name="camera-outline" color={colors.background} size={18} />
                <Text style={styles.primaryText}>Complete work</Text>
              </Pressable>
            </View>
          )}

          {status === 'submitted' && <Text style={styles.metaText}>Legacy submission from the previous workflow. Management can complete this item once; new submissions complete automatically.</Text>}
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
  primary: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, flex: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 48, paddingHorizontal: spacing.md },
  primaryText: { color: colors.background, fontWeight: '800', textAlign: 'center' },
  secondary: { alignItems: 'center', backgroundColor: colors.surfaceSoft, borderRadius: 12, flex: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 48, paddingHorizontal: spacing.md },
  secondaryText: { color: colors.text, fontWeight: '800', textAlign: 'center' },
  disabled: { opacity: 0.55 },
  error: { color: colors.red, fontSize: 12, marginTop: spacing.md },
  modalShade: { backgroundColor: 'rgba(0,0,0,0.72)', flex: 1, justifyContent: 'flex-end' },
  completionModal: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%', padding: spacing.lg, paddingBottom: 36 },
  modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  modalEyebrow: { color: colors.teal, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  modalTitle: { color: colors.text, fontSize: 22, fontWeight: '900', marginTop: 3 },
  closeButton: { alignItems: 'center', backgroundColor: colors.surfaceSoft, borderRadius: 999, height: 42, justifyContent: 'center', width: 42 },
  modalCopy: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.md },
  cameraButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.md, minHeight: 54 },
  cameraText: { color: colors.background, fontSize: 14, fontWeight: '900' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  photoWrap: { borderRadius: 12, height: 92, overflow: 'hidden', position: 'relative', width: 92 },
  photo: { height: '100%', width: '100%' },
  removePhoto: { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, position: 'absolute', right: 4, top: 4 },
  photoEmpty: { alignItems: 'center', borderColor: colors.border, borderRadius: 14, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md },
  photoEmptyText: { color: colors.subtle, flex: 1, fontSize: 12 },
  savedPhotoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  savedPhotoWrap: { width: 108 },
  savedPhoto: { borderRadius: 12, height: 108, width: 108 },
  savedPhotoDate: { color: colors.subtle, fontSize: 9, lineHeight: 13, marginTop: 5 },
  fieldLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: spacing.lg, textTransform: 'uppercase' },
  noteInput: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 14, borderWidth: 1, color: colors.text, marginTop: spacing.sm, minHeight: 90, padding: spacing.md, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  message: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 18, borderWidth: 1, flex: 1, justifyContent: 'center', margin: spacing.lg, padding: spacing.xl },
  messageTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing.md },
  messageText: { color: colors.muted, fontSize: 13, marginTop: spacing.sm, textAlign: 'center' },
  backButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, marginTop: spacing.lg, minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  backText: { color: colors.background, fontWeight: '800' },
});
