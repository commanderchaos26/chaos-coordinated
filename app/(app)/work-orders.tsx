import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Badge, Card, EmptyState, Icon, SectionHeader } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { formatStatus } from '../../src/lib/employeeData';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type WorkOrderRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  property_id: string;
  building_id: string | null;
  unit_id: string | null;
  department_id: string | null;
};

type Row = WorkOrderRow & {
  assignment_status: string | null;
  employee_name: string | null;
  property_name: string | null;
  building_name: string | null;
  unit_number: string | null;
  department_name: string | null;
};

const canCreate = (membership: Membership | null) => Boolean(membership?.roles.some((role) => ['owner','operations_manager','supervisor','dispatcher','crew_lead'].includes(role)));
const canWalk = (membership: Membership | null) => Boolean(membership?.roles.some((role) => ['owner','operations_manager','supervisor','dispatcher','crew_lead','technician'].includes(role)));

export default function WorkOrdersScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (!current) return;

      const { data, error: orderError } = await supabase
        .from('work_orders')
        .select('id,title,status,priority,due_at,property_id,building_id,unit_id,department_id')
        .eq('company_id', current.companyId)
        .order('created_at', { ascending: false });
      if (orderError) throw orderError;

      const orders = (data ?? []) as WorkOrderRow[];
      const orderIds = orders.map((item) => item.id);
      const propertyIds = [...new Set(orders.map((item) => item.property_id).filter(Boolean))];
      const buildingIds = [...new Set(orders.map((item) => item.building_id).filter(Boolean) as string[])];
      const unitIds = [...new Set(orders.map((item) => item.unit_id).filter(Boolean) as string[])];
      const departmentIds = [...new Set(orders.map((item) => item.department_id).filter(Boolean) as string[])];

      const [assignmentsResult, propertiesResult, buildingsResult, unitsResult, departmentsResult] = await Promise.all([
        orderIds.length ? supabase.from('assignments').select('id,work_order_id,employee_id,status,created_at').in('work_order_id', orderIds).order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
        propertyIds.length ? supabase.from('properties').select('id,name').in('id', propertyIds) : Promise.resolve({ data: [], error: null }),
        buildingIds.length ? supabase.from('buildings').select('id,name').in('id', buildingIds) : Promise.resolve({ data: [], error: null }),
        unitIds.length ? supabase.from('units').select('id,unit_number').in('id', unitIds) : Promise.resolve({ data: [], error: null }),
        departmentIds.length ? supabase.from('departments').select('id,name').in('id', departmentIds) : Promise.resolve({ data: [], error: null }),
      ]);

      const failure = [assignmentsResult, propertiesResult, buildingsResult, unitsResult, departmentsResult].find((result) => result.error);
      if (failure?.error) throw failure.error;

      const assignmentMap = new Map<string, any>();
      for (const assignment of assignmentsResult.data ?? []) if (!assignmentMap.has(assignment.work_order_id)) assignmentMap.set(assignment.work_order_id, assignment);
      const employeeIds = [...new Set(Array.from(assignmentMap.values()).map((item) => item.employee_id).filter(Boolean))];
      const employeeMap = new Map<string, string>();
      if (employeeIds.length) {
        const { data: employees, error: employeeError } = await supabase.from('employees').select('id,display_name').in('id', employeeIds);
        if (employeeError) throw employeeError;
        for (const employee of employees ?? []) employeeMap.set(employee.id, employee.display_name);
      }

      const pMap = new Map((propertiesResult.data ?? []).map((item: any) => [item.id, item.name]));
      const bMap = new Map((buildingsResult.data ?? []).map((item: any) => [item.id, item.name]));
      const uMap = new Map((unitsResult.data ?? []).map((item: any) => [item.id, item.unit_number]));
      const dMap = new Map((departmentsResult.data ?? []).map((item: any) => [item.id, item.name]));

      setRows(orders.map((item) => {
        const assignment = assignmentMap.get(item.id);
        return {
          ...item,
          assignment_status: assignment?.status ?? null,
          employee_name: assignment?.employee_id ? employeeMap.get(assignment.employee_id) ?? null : null,
          property_name: pMap.get(item.property_id) ?? null,
          building_name: item.building_id ? bMap.get(item.building_id) ?? null : null,
          unit_number: item.unit_id ? uMap.get(item.unit_id) ?? null : null,
          department_name: item.department_id ? dMap.get(item.department_id) ?? null : null,
        };
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load work orders.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const visibleRows = useMemo(() => rows.filter((item) => `${item.title} ${item.status} ${item.priority} ${item.employee_name ?? ''} ${item.property_name ?? ''} ${item.unit_number ?? ''} ${item.department_name ?? ''}`.toLowerCase().includes(query.toLowerCase())), [query, rows]);

  if (loading) return <LoadingScreen label="Loading work orders..." />;

  return <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
    <View style={styles.header}><View><Text style={styles.eyebrow}>FIELD QUEUE</Text><Text style={styles.heading}>Work orders</Text></View><View style={styles.count}><Text style={styles.countValue}>{rows.length}</Text><Text style={styles.countLabel}>TOTAL</Text></View></View>
    {canWalk(membership) ? <Pressable onPress={() => router.push('/(app)/ai-walkthrough' as never)} style={styles.aiCreate}><View style={styles.aiIcon}><Icon name="mic" color={colors.teal} size={22}/></View><View style={styles.aiCopy}><Text style={styles.aiEyebrow}>PRIMARY WORKFLOW</Text><Text style={styles.aiTitle}>Start AI Walkthrough</Text><Text style={styles.aiText}>Walk the unit, describe the work, and turn observations into departmental jobs.</Text></View><Icon name="arrow-forward" color={colors.teal} size={20}/></Pressable> : null}
    {canCreate(membership) ? <Pressable onPress={() => router.push('/(app)/new-work-order' as never)} style={styles.create}><Icon name="add" color={colors.background} size={20}/><Text style={styles.createText}>New manual work order</Text></Pressable> : null}
    <View style={styles.search}><Icon name="search-outline" color={colors.subtle} size={19} /><TextInput placeholder="Search work orders" placeholderTextColor={colors.subtle} value={query} onChangeText={setQuery} style={styles.searchInput} /></View>
    {error ? <Card style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></Card> : null}
    <SectionHeader title="Latest activity" />
    {visibleRows.length ? visibleRows.map((item) => <Pressable key={item.id} onPress={() => router.push({ pathname: '/(app)/task-detail' as never, params: { id: item.id } })} style={({ pressed }) => [styles.orderCard, pressed && styles.pressed]}><Card style={styles.card}>
      <View style={styles.orderTop}><Badge label={item.priority || 'normal'} tone={['emergency', 'high'].includes((item.priority || '').toLowerCase()) ? 'red' : 'amber'} /><Text style={styles.status}>{formatStatus(item.status)}</Text></View>
      <Text style={styles.orderTitle}>{item.title}</Text>
      <Text style={styles.location}>{[item.property_name, item.building_name, item.unit_number ? `Unit ${item.unit_number}` : item.building_name ? 'Common area' : null].filter(Boolean).join(' · ') || 'Location not resolved'}</Text>
      {item.department_name ? <Text style={styles.department}>{item.department_name}</Text> : null}
      <View style={styles.metaLine}><Icon name="person-outline" size={15} color={colors.subtle} /><Text style={styles.metaText}>{item.employee_name ? `Assigned to ${item.employee_name}` : item.assignment_status ? `Assignment: ${formatStatus(item.assignment_status)}` : 'Unassigned'}</Text></View>
      <View style={styles.metaLine}><Icon name="time-outline" size={15} color={colors.subtle} /><Text style={styles.metaText}>{item.due_at ? `Due ${new Date(item.due_at).toLocaleString()}` : 'Due date not set'}</Text></View>
    </Card></Pressable>) : <EmptyState icon="construct-outline" title="Queue is clear" message={canCreate(membership) ? 'Use AI Walkthrough for a unit turn, or create a manual work order for an exception.' : 'New work orders will appear here when assigned.'} />}
  </ScrollView>;
}

const styles = StyleSheet.create({ root: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg, paddingBottom: 110 }, header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.lg, paddingTop: spacing.sm }, eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }, heading: { color: colors.text, ...typography.title, marginTop: 4 }, count: { alignItems: 'flex-end' }, countValue: { color: colors.text, fontSize: 26, fontWeight: '800' }, countLabel: { color: colors.subtle, fontSize: 10, fontWeight: '800', letterSpacing: 1 }, aiCreate: { alignItems: 'center', backgroundColor: colors.tealDeep, borderColor: colors.teal, borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md, padding: spacing.md }, aiIcon: { alignItems: 'center', backgroundColor: colors.background, borderRadius: 999, height: 48, justifyContent: 'center', width: 48 }, aiCopy: { flex: 1 }, aiEyebrow: { color: colors.teal, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, aiTitle: { color: colors.text, fontSize: 16, fontWeight: '900', marginTop: 3 }, aiText: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 3 }, create: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 52, marginBottom: spacing.md }, createText: { color: colors.background, fontSize: 14, fontWeight: '900' }, search: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', minHeight: 52, paddingHorizontal: spacing.md }, searchInput: { color: colors.text, flex: 1, fontSize: 15, marginLeft: spacing.sm }, orderCard: { marginBottom: spacing.sm }, card: { padding: spacing.md }, orderTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, status: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }, orderTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: spacing.md }, location: { color: colors.text, fontSize: 13, marginTop: spacing.sm }, department: { color: colors.teal, fontSize: 12, fontWeight: '800', marginTop: 5 }, metaLine: { alignItems: 'center', flexDirection: 'row', marginTop: spacing.md }, metaText: { color: colors.muted, fontSize: 13, marginLeft: 7 }, pressed: { opacity: 0.75 }, errorCard: { backgroundColor: colors.redDeep, marginTop: spacing.md }, errorText: { color: colors.text } });
