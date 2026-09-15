import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Badge, Card, EmptyState, Icon, SectionHeader } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { formatStatus } from '../../src/lib/employeeData';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type Row = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  assigned_employee_id: string | null;
  assignment_status: string | null;
  employee_name: string | null;
};

export default function WorkOrdersScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (!current) return;
      const { data, error } = await supabase.from('work_orders').select('id,title,status,priority,due_at,assigned_employee_id').eq('company_id', current.companyId).order('due_at', { ascending: true, nullsFirst: false });
      if (error) throw error;
      const orderIds = (data ?? []).map((item) => item.id);
      let assignmentRows: any[] = [];
      if (orderIds.length) {
        const { data: assignmentsData, error: assignmentError } = await supabase.from('assignments').select('id,work_order_id,employee_id,status').in('work_order_id', orderIds);
        if (assignmentError) throw assignmentError;
        assignmentRows = assignmentsData ?? [];
      }
      const assignmentMap = new Map<string, any>();
      for (const item of assignmentRows) assignmentMap.set(item.work_order_id, item);
      const employeeIds = [...new Set((assignmentRows as any[]).map((item) => item.employee_id))];
      let employeeMap = new Map<string, string>();
      if (employeeIds.length) {
        const { data: employeeData, error: employeeError } = await supabase.from('employees').select('id,display_name').in('id', employeeIds);
        if (!employeeError) {
          for (const employee of employeeData ?? []) employeeMap.set(employee.id, employee.display_name);
        }
      }
      const merged = (data ?? []).map((item) => {
        const assignment = assignmentMap.get(item.id);
        return {
          id: item.id,
          title: item.title,
          status: item.status,
          priority: item.priority,
          due_at: item.due_at,
          assigned_employee_id: item.assigned_employee_id ?? assignment?.employee_id ?? null,
          assignment_status: assignment?.status ?? null,
          employee_name: item.assigned_employee_id ? employeeMap.get(item.assigned_employee_id) ?? null : assignment?.employee_id ? employeeMap.get(assignment.employee_id) ?? null : null,
        } as Row;
      });
      setRows(merged);
    } catch (error) {
      console.warn('work orders load failed', error);
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const visibleRows = useMemo(() => rows.filter((item) => `${item.title} ${item.status} ${item.priority} ${item.employee_name ?? ''}`.toLowerCase().includes(query.toLowerCase())), [query, rows]);

  if (loading) return <LoadingScreen label="Loading work orders..." />;

  return <View style={styles.root}><View style={styles.header}><View><Text style={styles.eyebrow}>FIELD QUEUE</Text><Text style={styles.heading}>Work orders</Text></View><View style={styles.count}><Text style={styles.countValue}>{rows.length}</Text><Text style={styles.countLabel}>TOTAL</Text></View></View><View style={styles.search}><Icon name="search-outline" color={colors.subtle} size={19} /><TextInput placeholder="Search work orders" placeholderTextColor={colors.subtle} value={query} onChangeText={setQuery} style={styles.searchInput} /></View><SectionHeader title="Latest activity" />{visibleRows.length ? visibleRows.map((item) => <Pressable key={item.id} onPress={() => router.push({ pathname: '/(app)/task-detail' as never, params: { id: item.id } })} style={({ pressed }) => [styles.orderCard, pressed && styles.pressed]}><Card style={styles.card}><View style={styles.orderTop}><Badge label={item.priority || 'normal'} tone={['urgent', 'high'].includes((item.priority || '').toLowerCase()) ? 'red' : 'amber'} /><Text style={styles.status}>{formatStatus(item.status)}</Text></View><Text style={styles.orderTitle}>{item.title}</Text><View style={styles.metaLine}><Icon name="person-outline" size={15} color={colors.subtle} /><Text style={styles.metaText}>{item.employee_name ? `Assigned to ${item.employee_name}` : item.assignment_status ? `Status: ${formatStatus(item.assignment_status)}` : 'Unassigned'}</Text></View><View style={styles.metaLine}><Icon name="time-outline" size={15} color={colors.subtle} /><Text style={styles.metaText}>{item.due_at ? `Due ${new Date(item.due_at).toLocaleString()}` : 'Due date not set'}</Text></View></Card></Pressable>) : <EmptyState icon="construct-outline" title="Queue is clear" message="New work orders will appear here when assigned." />}</View>;
}

const styles = StyleSheet.create({ root: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg, paddingBottom: 110 }, header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.lg, paddingTop: spacing.sm }, eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }, heading: { color: colors.text, ...typography.title, marginTop: 4 }, count: { alignItems: 'flex-end' }, countValue: { color: colors.text, fontSize: 26, fontWeight: '800' }, countLabel: { color: colors.subtle, fontSize: 10, fontWeight: '800', letterSpacing: 1 }, search: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', minHeight: 52, paddingHorizontal: spacing.md }, searchInput: { color: colors.text, flex: 1, fontSize: 15, marginLeft: spacing.sm }, orderCard: { marginBottom: spacing.sm }, card: { padding: spacing.md }, orderTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, status: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }, orderTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: spacing.md }, metaLine: { alignItems: 'center', flexDirection: 'row', marginTop: spacing.md }, metaText: { color: colors.muted, fontSize: 13, marginLeft: 7 }, pressed: { opacity: 0.75 }, });
