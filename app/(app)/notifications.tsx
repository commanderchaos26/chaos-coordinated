import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge, Card, EmptyState, Icon } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { markNotification } from '../../src/lib/dispatchCommands';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type NotificationRow = {
  id: string;
  title: string | null;
  body: string | null;
  priority: string | null;
  created_at: string | null;
  acknowledged_at: string | null;
  read_at: string | null;
  entity_type: string | null;
  entity_id: string | null;
  assignment_id: string | null;
  payload: { work_order_id?: string; assignment_id?: string } | null;
};

export default function NotificationsScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => { setLoading(true); setError(null); try { const current = await loadMembership(); setMembership(current); if (!current) return; const { data, error: fetchError } = await supabase.from('employee_notifications').select('id,title,body,priority,created_at,acknowledged_at,read_at,entity_type,entity_id,assignment_id,payload').eq('company_id', current.companyId).eq('employee_id', current.employeeId).order('created_at', { ascending: false }); if (fetchError) throw fetchError; setRows((data ?? []) as NotificationRow[]); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load notifications.'); } finally { setLoading(false); } };

  useEffect(() => { void load(); }, []);
  const unreadCount = useMemo(() => rows.filter((item) => !(item.read_at || item.acknowledged_at)).length, [rows]);

  const openNotification = async (row: NotificationRow) => {
    if (!membership || !row.id) return;
    const workOrderId = row.entity_type === 'work_order'
      ? row.entity_id
      : row.payload?.work_order_id ?? null;
    const assignmentId = row.assignment_id ?? row.payload?.assignment_id ?? null;
    const openRelatedWork = () => {
      if (workOrderId) {
        router.push({ pathname: '/(app)/task-detail' as never, params: { id: workOrderId } });
      } else if (assignmentId) {
        router.push({ pathname: '/(app)/task-detail' as never, params: { assignmentId } });
      }
    };

    try {
      await markNotification({
        p_company_id: membership.companyId,
        p_notification_id: row.id,
        p_acknowledge: true,
      });
      await load();
    } catch {
      // Opening the related assignment should still work if acknowledgement fails.
    }
    openRelatedWork();
  };

  if (loading) return <LoadingScreen label="Loading notifications..." />;
  if (!membership) return <Message title="Notifications unavailable" message="Your account is not linked to a company." />;

  return <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}><View style={styles.topbar}><Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>COMMUNICATION</Text><Text style={styles.title}>Notifications</Text></View><View style={styles.headerIcon}><Icon name="notifications-outline" color={colors.teal} size={21} />{unreadCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unreadCount}</Text></View>}</View></View>{error && <Text style={styles.error}>{error}</Text>}{rows.length ? rows.map((item) => <Pressable key={item.id} onPress={() => void openNotification(item)} style={styles.notificationCard}><View style={styles.rowTop}><Text style={styles.titleText}>{item.title || 'Assignment update'}</Text><Badge label={(item.priority || 'normal').toUpperCase()} tone={item.priority === 'high' || item.priority === 'urgent' ? 'red' : 'amber'} /></View><Text style={styles.body}>{item.body || 'New field update.'}</Text><View style={styles.metaRow}><Text style={styles.meta}>{item.created_at ? new Date(item.created_at).toLocaleString() : 'Recently'}</Text>{!(item.read_at || item.acknowledged_at) && <Badge label="Unread" tone="teal" />}</View></Pressable>) : <EmptyState icon="notifications-off-outline" title="No notifications" message="Assignment and dispatch updates will appear here when they are sent." />}</ScrollView>;
}

function Message({ title, message }: { title: string; message: string }) { return <View style={styles.message}><Icon name="alert-circle-outline" color={colors.amber} size={25} /><Text style={styles.messageTitle}>{title}</Text><Text style={styles.messageText}>{message}</Text><Pressable onPress={() => router.back()} style={styles.backButton}><Text style={styles.backText}>Back</Text></Pressable></View>; }

const styles = StyleSheet.create({ root: { backgroundColor: colors.background, flexGrow: 1, gap: spacing.md, padding: spacing.lg, paddingBottom: 110 }, topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm }, back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 }, headerCopy: { flex: 1, marginLeft: spacing.md }, eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }, title: { color: colors.text, ...typography.title, marginTop: 3 }, headerIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 44, justifyContent: 'center', width: 44, position: 'relative' }, badge: { alignItems: 'center', backgroundColor: colors.red, borderRadius: 999, height: 18, justifyContent: 'center', minWidth: 18, position: 'absolute', right: -6, top: -6 }, badgeText: { color: colors.background, fontSize: 10, fontWeight: '800' }, error: { color: colors.red, fontSize: 13 }, notificationCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, padding: spacing.md }, rowTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, titleText: { color: colors.text, fontSize: 15, fontWeight: '800', flex: 1 }, body: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: spacing.sm }, metaRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between', marginTop: spacing.md }, meta: { color: colors.subtle, fontSize: 11, flex: 1 }, message: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl }, messageTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing.md }, messageText: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm, textAlign: 'center' }, backButton: { backgroundColor: colors.teal, borderRadius: 12, marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md }, backText: { color: colors.background, fontWeight: '800' }, });
