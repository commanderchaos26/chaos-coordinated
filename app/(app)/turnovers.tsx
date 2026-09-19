import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Badge, Card, EmptyState, Icon, SectionHeader } from '../../src/components/FieldUI';
import { DateTimePickerField } from '../../src/components/DateTimePickerField';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { loadMembership } from '../../src/lib/membership';
import { createTurnover, transitionTurnover, type TurnoverStatus } from '../../src/lib/turnoverCommands';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type Property = { id: string; name: string };
type Building = { id: string; property_id: string; name: string };
type Unit = { id: string; building_id: string; unit_number: string };
type Turnover = {
  id: string;
  status: TurnoverStatus;
  target_completion_at: string | null;
  move_in_at: string | null;
  property_id: string;
  building_id: string | null;
  unit_id: string;
  rough_clean_required: boolean;
  created_at: string;
  property_name?: string | null;
  building_name?: string | null;
  unit_number?: string | null;
  work_order_count?: number;
};

const managerRoles = new Set(['owner', 'operations_manager', 'supervisor', 'dispatcher']);

const progression: Partial<Record<TurnoverStatus, TurnoverStatus>> = {
  intake: 'walkthrough_assigned',
  walkthrough_assigned: 'walkthrough_in_progress',
  walkthrough_in_progress: 'walkthrough_review',
  walkthrough_review: 'maintenance_active',
  maintenance_active: 'ready_for_paint',
  mud_texture_drying: 'ready_for_paint',
  ready_for_paint: 'painting_active',
  painting_active: 'ready_for_final_clean',
  paint_drying: 'ready_for_final_clean',
  ready_for_final_clean: 'cleaning_active',
  cleaning_active: 'awaiting_inspection',
  awaiting_inspection: 'ready_for_occupancy',
  ready_for_occupancy: 'closed',
};

const statusLabels: Record<TurnoverStatus, string> = {
  intake: 'Intake',
  walkthrough_assigned: 'Walkthrough assigned',
  walkthrough_in_progress: 'Walkthrough in progress',
  walkthrough_review: 'Walkthrough review',
  maintenance_active: 'Maintenance active',
  mud_texture_drying: 'Drying',
  ready_for_paint: 'Ready for paint',
  painting_active: 'Painting active',
  paint_drying: 'Paint drying',
  ready_for_final_clean: 'Ready for final clean',
  cleaning_active: 'Cleaning active',
  awaiting_inspection: 'Awaiting inspection',
  ready_for_occupancy: 'Ready for occupancy',
  cancelled: 'Cancelled',
  closed: 'Closed',
};

const pipeline: TurnoverStatus[] = [
  'intake',
  'walkthrough_assigned',
  'walkthrough_in_progress',
  'walkthrough_review',
  'maintenance_active',
  'mud_texture_drying',
  'ready_for_paint',
  'painting_active',
  'paint_drying',
  'ready_for_final_clean',
  'cleaning_active',
  'awaiting_inspection',
  'ready_for_occupancy',
  'closed',
];

function toIsoOrNull(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export default function TurnoversScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [rows, setRows] = useState<Turnover[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [propertyId, setPropertyId] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [targetAt, setTargetAt] = useState('');
  const [moveInAt, setMoveInAt] = useState('');
  const [roughClean, setRoughClean] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (!current) return;

      const [turnoverResult, propertyResult, buildingResult, unitResult, workOrderResult] = await Promise.all([
        supabase.from('turnovers').select('id,status,target_completion_at,move_in_at,property_id,building_id,unit_id,rough_clean_required,created_at').eq('company_id', current.companyId).order('created_at', { ascending: false }),
        supabase.from('properties').select('id,name').eq('company_id', current.companyId).order('name'),
        supabase.from('buildings').select('id,property_id,name').eq('company_id', current.companyId).order('name'),
        supabase.from('units').select('id,building_id,unit_number').eq('company_id', current.companyId).order('unit_number'),
        supabase.from('work_orders').select('id,turnover_id').eq('company_id', current.companyId).not('turnover_id', 'is', null),
      ]);

      const failure = [turnoverResult, propertyResult, buildingResult, unitResult, workOrderResult].find((result) => result.error);
      if (failure?.error) throw failure.error;

      const props = (propertyResult.data ?? []) as Property[];
      const blds = (buildingResult.data ?? []) as Building[];
      const uns = (unitResult.data ?? []) as Unit[];
      setProperties(props);
      setBuildings(blds);
      setUnits(uns);

      const pMap = new Map(props.map((item) => [item.id, item.name]));
      const bMap = new Map(blds.map((item) => [item.id, item.name]));
      const uMap = new Map(uns.map((item) => [item.id, item.unit_number]));
      const workCounts = new Map<string, number>();
      for (const work of workOrderResult.data ?? []) {
        if (work.turnover_id) workCounts.set(work.turnover_id, (workCounts.get(work.turnover_id) ?? 0) + 1);
      }

      setRows(((turnoverResult.data ?? []) as Turnover[]).map((item) => ({
        ...item,
        property_name: pMap.get(item.property_id) ?? null,
        building_name: item.building_id ? bMap.get(item.building_id) ?? null : null,
        unit_number: uMap.get(item.unit_id) ?? null,
        work_order_count: workCounts.get(item.id) ?? 0,
      })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load turnovers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const canManage = Boolean(membership?.roles.some((role) => managerRoles.has(role)));
  const visibleBuildings = useMemo(() => buildings.filter((item) => item.property_id === propertyId), [buildings, propertyId]);
  const visibleUnits = useMemo(() => units.filter((item) => item.building_id === buildingId), [units, buildingId]);
  const activeRows = rows.filter((item) => !['closed', 'cancelled'].includes(item.status));
  const finishedRows = rows.filter((item) => ['closed', 'cancelled'].includes(item.status));

  const resetCreate = () => {
    setPropertyId('');
    setBuildingId('');
    setUnitId('');
    setTargetAt('');
    setMoveInAt('');
    setRoughClean(false);
  };

  const submitCreate = async () => {
    if (!membership || !propertyId || !buildingId || !unitId) {
      Alert.alert('Location required', 'Choose a property, building, and unit.');
      return;
    }
    setBusyId('create');
    try {
      await createTurnover({
        p_company_id: membership.companyId,
        p_property_id: propertyId,
        p_building_id: buildingId,
        p_unit_id: unitId,
        p_target_completion_at: toIsoOrNull(targetAt),
        p_move_in_at: toIsoOrNull(moveInAt),
        p_rough_clean_required: roughClean,
      });
      setCreateOpen(false);
      resetCreate();
      await load();
      Alert.alert('Turnover started', 'The unit is now in the turnover pipeline.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not start turnover.';
      Alert.alert('Could not start turnover', message.includes('active_turnover_exists') ? 'This unit already has an active turnover.' : message);
    } finally {
      setBusyId(null);
    }
  };

  const advance = async (item: Turnover, to: TurnoverStatus, reason?: string) => {
    if (!membership) return;
    setBusyId(item.id);
    try {
      await transitionTurnover({
        p_company_id: membership.companyId,
        p_turnover_id: item.id,
        p_to_status: to,
        p_reason: reason ?? null,
      });
      await load();
    } catch (cause) {
      Alert.alert('Could not update turnover', cause instanceof Error ? cause.message : 'Try again.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !membership) return <LoadingScreen label="Loading turnovers..." />;

  return (
    <>
      <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>OPERATIONS BOARD</Text>
            <Text style={styles.heading}>Turnovers</Text>
          </View>
          <View style={styles.count}><Text style={styles.countValue}>{activeRows.length}</Text><Text style={styles.countLabel}>ACTIVE</Text></View>
        </View>

        {canManage && (
          <Pressable onPress={() => setCreateOpen(true)} style={styles.createButton}>
            <Icon name="add-circle-outline" color={colors.background} size={21} />
            <Text style={styles.createText}>Start unit turnover</Text>
          </Pressable>
        )}

        {error ? <Card style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></Card> : null}

        <SectionHeader title="Readiness pipeline" />
        {activeRows.length ? activeRows.map((item) => (
          <TurnoverCard
            key={item.id}
            item={item}
            canManage={canManage}
            busy={busyId === item.id}
            onAdvance={(to) => void advance(item, to)}
          />
        )) : (
          <EmptyState icon="sync-outline" title="No active turnovers" message={canManage ? 'Tap “Start unit turnover” to put a unit into the readiness pipeline.' : 'Active unit turnovers will appear here.'} />
        )}

        {finishedRows.length ? (
          <>
            <SectionHeader title="Finished / cancelled" />
            {finishedRows.map((item) => <TurnoverCard key={item.id} item={item} canManage={false} busy={false} onAdvance={() => undefined} />)}
          </>
        ) : null}
      </ScrollView>

      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => !busyId && setCreateOpen(false)}>
        <View style={styles.modalShade}>
          <ScrollView contentContainerStyle={styles.modal}>
            <View style={styles.modalHeader}>
              <View><Text style={styles.modalEyebrow}>NEW TURNOVER</Text><Text style={styles.modalTitle}>Put a unit in the pipeline</Text></View>
              <Pressable onPress={() => setCreateOpen(false)} style={styles.close}><Icon name="close" color={colors.text} size={22} /></Pressable>
            </View>

            <Selector title="Property" items={properties.map((item) => ({ id: item.id, label: item.name }))} selected={propertyId} onSelect={(id) => { setPropertyId(id); setBuildingId(''); setUnitId(''); }} />
            <Selector title="Building" items={visibleBuildings.map((item) => ({ id: item.id, label: item.name }))} selected={buildingId} onSelect={(id) => { setBuildingId(id); setUnitId(''); }} />
            <Selector title="Unit" items={visibleUnits.map((item) => ({ id: item.id, label: `Unit ${item.unit_number}` }))} selected={unitId} onSelect={setUnitId} />

            <DateTimePickerField label="Target completion" value={targetAt} onChange={setTargetAt} mode="datetime" optional placeholder="Choose target date and time" />
            <DateTimePickerField label="Expected move-in" value={moveInAt} onChange={setMoveInAt} mode="datetime" optional placeholder="Choose move-in date and time" />

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchTitle}>Rough clean required</Text>
                <Text style={styles.switchText}>Include a rough-clean step before the later finishing phases.</Text>
              </View>
              <Switch value={roughClean} onValueChange={setRoughClean} trackColor={{ true: colors.teal }} />
            </View>

            <Pressable disabled={busyId === 'create'} onPress={() => void submitCreate()} style={[styles.createButton, busyId === 'create' && styles.disabled]}>
              <Text style={styles.createText}>{busyId === 'create' ? 'Starting turnover…' : 'Start turnover'}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function TurnoverCard({ item, canManage, busy, onAdvance }: { item: Turnover; canManage: boolean; busy: boolean; onAdvance: (status: TurnoverStatus) => void }) {
  const complete = ['closed', 'ready_for_occupancy'].includes(item.status);
  const tone = item.status === 'cancelled' ? 'red' : complete ? 'teal' : item.status.includes('drying') ? 'amber' : 'blue';
  const index = Math.max(0, pipeline.indexOf(item.status));
  const progress = item.status === 'cancelled' ? 0 : Math.round((index / (pipeline.length - 1)) * 100);
  const next = progression[item.status];

  return (
    <Card style={styles.card}>
      <View style={styles.cardTop}>
        <Badge label={statusLabels[item.status]} tone={tone as any} />
        <Text style={styles.date}>{item.target_completion_at ? new Date(item.target_completion_at).toLocaleString() : 'Target pending'}</Text>
      </View>

      <Text style={styles.title}>{item.property_name || 'Property'} · {item.unit_number ? `Unit ${item.unit_number}` : 'Unit'}</Text>
      <Text style={styles.location}>{item.building_name || 'Building'}{item.move_in_at ? ` · Move-in ${new Date(item.move_in_at).toLocaleDateString()}` : ''}</Text>

      <View style={styles.metaRow}>
        <View style={styles.metaPill}><Icon name="construct-outline" color={colors.teal} size={15} /><Text style={styles.metaText}>{item.work_order_count ?? 0} work orders</Text></View>
        {item.rough_clean_required ? <View style={styles.metaPill}><Icon name="sparkles-outline" color={colors.teal} size={15} /><Text style={styles.metaText}>Rough clean</Text></View> : null}
      </View>

      <View style={styles.progressRow}><Text style={styles.progressLabel}>Readiness</Text><Text style={styles.progressValue}>{progress}%</Text></View>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>

      {canManage && !['closed', 'cancelled'].includes(item.status) ? (
        <View style={styles.actions}>
          <Pressable
            onPress={() => router.push({ pathname: '/(app)/ai-walkthrough' as never, params: { turnoverId: item.id } })}
            style={styles.secondaryAction}
          >
            <Icon name="mic-outline" color={colors.teal} size={18} />
            <Text style={styles.secondaryActionText}>AI Walkthrough</Text>
          </Pressable>

          {item.status === 'maintenance_active' ? (
            <Pressable disabled={busy} onPress={() => onAdvance('mud_texture_drying')} style={styles.secondaryAction}>
              <Text style={styles.secondaryActionText}>Start drying</Text>
            </Pressable>
          ) : null}

          {item.status === 'painting_active' ? (
            <Pressable disabled={busy} onPress={() => onAdvance('paint_drying')} style={styles.secondaryAction}>
              <Text style={styles.secondaryActionText}>Start paint drying</Text>
            </Pressable>
          ) : null}

          {item.status === 'awaiting_inspection' ? (
            <Pressable disabled={busy} onPress={() => onAdvance('maintenance_active')} style={styles.secondaryAction}>
              <Text style={styles.secondaryActionText}>Return to maintenance</Text>
            </Pressable>
          ) : null}

          {next ? (
            <Pressable disabled={busy} onPress={() => onAdvance(next)} style={[styles.primaryAction, busy && styles.disabled]}>
              <Text style={styles.primaryActionText}>{busy ? 'Updating…' : `Next: ${statusLabels[next]}`}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function Selector({ title, items, selected, onSelect }: { title: string; items: Array<{ id: string; label: string }>; selected: string; onSelect: (id: string) => void }) {
  return (
    <View style={styles.selector}>
      <Text style={styles.selectorTitle}>{title}</Text>
      <View style={styles.chips}>
        {items.length ? items.map((item) => (
          <Pressable key={item.id} onPress={() => onSelect(item.id)} style={[styles.chip, selected === item.id && styles.chipActive]}>
            <Text style={[styles.chipText, selected === item.id && styles.chipTextActive]}>{item.label}</Text>
          </Pressable>
        )) : <Text style={styles.emptyText}>Choose the previous location first.</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg, paddingBottom: 110 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.lg, paddingTop: spacing.sm },
  eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  heading: { color: colors.text, ...typography.title, marginTop: 4 },
  count: { alignItems: 'flex-end' },
  countValue: { color: colors.text, fontSize: 26, fontWeight: '800' },
  countLabel: { color: colors.subtle, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  createButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginBottom: spacing.lg, minHeight: 54, paddingHorizontal: spacing.md },
  createText: { color: colors.background, fontSize: 14, fontWeight: '900' },
  errorCard: { backgroundColor: colors.redDeep, marginBottom: spacing.md, padding: spacing.md },
  errorText: { color: colors.text },
  card: { marginBottom: spacing.md, padding: spacing.md },
  cardTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  date: { color: colors.muted, flex: 1, fontSize: 11, textAlign: 'right' },
  title: { color: colors.text, fontSize: 18, fontWeight: '900', marginTop: spacing.md },
  location: { color: colors.muted, fontSize: 13, marginTop: 5 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  metaPill: { alignItems: 'center', backgroundColor: colors.surfaceSoft, borderRadius: 999, flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 7 },
  metaText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.lg },
  progressLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  progressValue: { color: colors.teal, fontSize: 12, fontWeight: '800' },
  progressTrack: { backgroundColor: colors.surfaceSoft, borderRadius: 99, height: 7, marginTop: 8, overflow: 'hidden' },
  progressFill: { backgroundColor: colors.teal, borderRadius: 99, height: 7 },
  actions: { gap: spacing.sm, marginTop: spacing.md },
  primaryAction: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, justifyContent: 'center', minHeight: 46, paddingHorizontal: spacing.md },
  primaryActionText: { color: colors.background, fontSize: 13, fontWeight: '900', textAlign: 'center' },
  secondaryAction: { alignItems: 'center', backgroundColor: colors.tealDeep, borderColor: colors.teal, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing.md },
  secondaryActionText: { color: colors.teal, fontSize: 12, fontWeight: '800' },
  disabled: { opacity: 0.55 },
  modalShade: { backgroundColor: 'rgba(0,0,0,0.72)', flex: 1, justifyContent: 'flex-end' },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: spacing.lg, padding: spacing.lg, paddingBottom: 40 },
  modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  modalEyebrow: { color: colors.teal, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  modalTitle: { color: colors.text, fontSize: 22, fontWeight: '900', marginTop: 3 },
  close: { alignItems: 'center', backgroundColor: colors.surfaceSoft, borderRadius: 999, height: 42, justifyContent: 'center', width: 42 },
  selector: { gap: spacing.sm },
  selectorTitle: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipActive: { backgroundColor: colors.tealDeep, borderColor: colors.teal },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: colors.teal },
  emptyText: { color: colors.subtle, fontSize: 12 },
  switchRow: { alignItems: 'center', backgroundColor: colors.background, borderColor: colors.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  switchTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  switchText: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
});
