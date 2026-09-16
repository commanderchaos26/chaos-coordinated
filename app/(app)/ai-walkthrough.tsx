import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Badge, Card, EmptyState, Icon } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { appendAiWalkthroughChunk, finalizeAiWalkthrough, startAiWalkthrough, type AiWalkthroughFinalizeResult, type AiWalkthroughSession } from '../../src/lib/aiWalkthroughCommands';
import { loadMyFeaturePermissions } from '../../src/lib/featurePermissionCommands';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type Property = { id: string; name: string };
type Building = { id: string; property_id: string; name: string };
type Unit = { id: string; building_id: string; unit_number: string };
type WorkSite = { id: string; property_id: string; name: string };
type Chunk = { id: string; sequence_no: number; transcript_text: string; source: string; captured_at: string };

export default function AiWalkthroughScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [properties, setProperties] = useState<Property[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [workSites, setWorkSites] = useState<WorkSite[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [session, setSession] = useState<AiWalkthroughSession | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [observation, setObservation] = useState('');
  const [finalizationKey, setFinalizationKey] = useState('');
  const [result, setResult] = useState<AiWalkthroughFinalizeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const current = await loadMembership();
        setMembership(current);
        if (!current) return;
        const permissions = await loadMyFeaturePermissions(current.companyId, current.employeeId);
        setAuthorized(permissions.has('ai_walkthrough'));
        if (!permissions.has('ai_walkthrough')) return;
        const [p, b, u, w] = await Promise.all([
          supabase.from('properties').select('id,name').eq('company_id', current.companyId).order('name'),
          supabase.from('buildings').select('id,property_id,name').eq('company_id', current.companyId).order('name'),
          supabase.from('units').select('id,building_id,unit_number').eq('company_id', current.companyId).order('unit_number'),
          supabase.from('work_sites').select('id,property_id,name').eq('company_id', current.companyId).order('name'),
        ]);
        const failure = [p,b,u,w].find((item) => item.error);
        if (failure?.error) throw failure.error;
        setProperties((p.data ?? []) as Property[]);
        setBuildings((b.data ?? []) as Building[]);
        setUnits((u.data ?? []) as Unit[]);
        setWorkSites((w.data ?? []) as WorkSite[]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not prepare AI walkthrough.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const visibleBuildings = useMemo(() => buildings.filter((item) => item.property_id === propertyId), [buildings, propertyId]);
  const visibleUnits = useMemo(() => units.filter((item) => item.building_id === buildingId), [units, buildingId]);
  const selectedProperty = properties.find((item) => item.id === propertyId);
  const selectedBuilding = buildings.find((item) => item.id === buildingId);
  const selectedUnit = units.find((item) => item.id === unitId);

  const chooseProperty = (id: string) => {
    setPropertyId(id);
    setBuildingId('');
    setUnitId('');
  };

  const chooseBuilding = (id: string) => {
    setBuildingId(id);
    setUnitId('');
  };

  const begin = async () => {
    if (!membership || !propertyId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const site = workSites.find((item) => item.property_id === propertyId) ?? null;
      const started = await startAiWalkthrough({
        p_company_id: membership.companyId,
        p_property_id: propertyId,
        p_building_id: buildingId || null,
        p_unit_id: unitId || null,
        p_turnover_id: null,
        p_work_site_id: site?.id ?? null,
      });
      setSession(started.session);
      setChunks([]);
      setResult(null);
      setFinalizationKey(Crypto.randomUUID());
    } catch (cause) {
      Alert.alert('Could not start walkthrough', cause instanceof Error ? cause.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const addObservation = async () => {
    if (!membership || !session || !observation.trim() || busy || result) return;
    const text = observation.trim();
    setBusy(true);
    setError(null);
    try {
      const added = await appendAiWalkthroughChunk({
        p_company_id: membership.companyId,
        p_session_id: session.id,
        p_transcript_text: text,
        p_source: 'typed',
        p_is_final: true,
        p_captured_at: new Date().toISOString(),
      });
      setChunks((current) => [...current, { ...added.chunk, source: 'typed', captured_at: new Date().toISOString() }]);
      setObservation('');
    } catch (cause) {
      Alert.alert('Could not save observation', cause instanceof Error ? cause.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!membership || !session || !chunks.length || busy || result) return;
    setBusy(true);
    setError(null);
    try {
      const finalized = await finalizeAiWalkthrough({
        companyId: membership.companyId,
        sessionId: session.id,
        finalizationKey: finalizationKey || Crypto.randomUUID(),
      });
      setResult(finalized);
      setSession((current) => current ? { ...current, status: 'completed', finalized_at: new Date().toISOString(), ai_summary: finalized.summary ?? null } : current);
    } catch (cause) {
      Alert.alert('AI walkthrough could not finish', cause instanceof Error ? cause.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingScreen label="Preparing AI walkthrough..." />;
  if (!membership) return <Message title="Session unavailable" message="Sign in again to use AI walkthroughs." />;
  if (!authorized) return <Message title="AI Walkthrough access required" message="This tool is restricted to employee profiles specifically authorized by management." />;

  return <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
    <View style={styles.topbar}>
      <Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21} /></Pressable>
      <View style={styles.headerCopy}><Text style={styles.eyebrow}>CHAOS COORDINATED AI</Text><Text style={styles.title}>AI Walkthrough</Text></View>
      <View style={styles.aiIcon}><Icon name="mic" color={colors.teal} size={22} /></View>
    </View>

    {error ? <Card style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></Card> : null}

    {!session ? <>
      <Card style={styles.hero}>
        <Text style={styles.heroTitle}>Walk it. Say it. Work orders come out the other side.</Text>
        <Text style={styles.heroText}>Choose the location first. The walkthrough keeps the property, building, unit, transcript, and later photos tied together so the AI can create the correct departmental jobs.</Text>
      </Card>
      {properties.length ? <>
        <Selector title="Property" items={properties.map((item) => ({ id: item.id, label: item.name }))} selected={propertyId} onSelect={chooseProperty} />
        {propertyId ? <Selector title="Building" optional items={visibleBuildings.map((item) => ({ id: item.id, label: item.name }))} selected={buildingId} onSelect={chooseBuilding} /> : null}
        {buildingId ? <Selector title="Unit" optional items={visibleUnits.map((item) => ({ id: item.id, label: `Unit ${item.unit_number}` }))} selected={unitId} onSelect={setUnitId} /> : null}
        <Pressable disabled={!propertyId || busy} onPress={() => void begin()} style={[styles.primary, (!propertyId || busy) && styles.disabled]}>
          <Icon name="mic" color={colors.background} size={22} /><Text style={styles.primaryText}>{busy ? 'Starting...' : 'Start AI Walkthrough'}</Text>
        </Pressable>
      </> : <EmptyState icon="location-outline" title="No property yet" message="Create a property before starting a walkthrough." />}
    </> : result ? <>
      <Card style={styles.completeCard}>
        <View style={styles.completeIcon}><Icon name="checkmark-circle" color={colors.teal} size={30} /></View>
        <Text style={styles.completeTitle}>{result.issues.length} work order{result.issues.length === 1 ? '' : 's'} created</Text>
        <Text style={styles.completeText}>{result.summary || 'The walkthrough was interpreted and converted into new work orders.'}</Text>
      </Card>
      <Text style={styles.sectionTitle}>Walkthrough results</Text>
      {result.issues.length ? result.issues.map((issue) => <Card key={issue.id} style={styles.issueCard}>
        <View style={styles.issueTop}><Badge label={issue.priority || 'normal'} tone={['high','emergency'].includes(issue.priority) ? 'red' : 'amber'} />{issue.needs_review ? <Badge label="Needs review" tone="amber" /> : <Badge label="Created" tone="teal" />}</View>
        <Text style={styles.issueTitle}>{issue.title}</Text>
        {issue.room_area ? <Text style={styles.issueMeta}>{issue.room_area}</Text> : null}
        {issue.review_reason ? <Text style={styles.reviewReason}>{issue.review_reason}</Text> : null}
        {issue.depends_on_issue_keys?.length ? <Text style={styles.dependency}>Depends on: {issue.depends_on_issue_keys.join(', ')}</Text> : null}
      </Card>) : <EmptyState icon="checkmark-circle-outline" title="No work detected" message="The AI did not find an actionable work item in this walkthrough." />}
      <Pressable onPress={() => router.replace('/(app)/work-orders' as never)} style={styles.primary}><Icon name="construct-outline" color={colors.background} size={20} /><Text style={styles.primaryText}>Open work orders</Text></Pressable>
    </> : <>
      <Card style={styles.activeCard}>
        <View style={styles.activeTop}><View style={styles.liveDot} /><Text style={styles.live}>WALKTHROUGH ACTIVE</Text></View>
        <Text style={styles.location}>{[selectedProperty?.name, selectedBuilding?.name, selectedUnit ? `Unit ${selectedUnit.unit_number}` : null].filter(Boolean).join(' · ')}</Text>
        <Text style={styles.sessionId}>Session {session.id.slice(0, 8)}</Text>
      </Card>

      <View style={styles.voicePreview}>
        <View style={styles.micCircle}><Icon name="mic" color={colors.teal} size={30} /></View>
        <View style={styles.voiceCopy}><Text style={styles.voiceTitle}>AI interpretation is now connected</Text><Text style={styles.voiceText}>For this validation build, enter observations as text. Finish Walkthrough sends the complete transcript to the secure AI service and automatically creates the resulting work orders. Microphone capture is the next layer.</Text></View>
      </View>

      <Text style={styles.sectionTitle}>Running observations</Text>
      {chunks.length ? chunks.map((chunk) => <Card key={chunk.id} style={styles.chunkCard}><Text style={styles.sequence}>#{chunk.sequence_no}</Text><Text style={styles.chunkText}>{chunk.transcript_text}</Text></Card>) : <Text style={styles.emptyText}>No observations captured yet.</Text>}

      <TextInput
        value={observation}
        onChangeText={setObservation}
        multiline
        placeholder="Example: Bedroom one has two drywall holes. Patch those, then paint the whole wall."
        placeholderTextColor={colors.subtle}
        style={styles.input}
      />
      <Pressable disabled={!observation.trim() || busy} onPress={() => void addObservation()} style={[styles.secondary, (!observation.trim() || busy) && styles.disabled]}>
        <Icon name="add-circle-outline" color={colors.teal} size={20} /><Text style={styles.secondaryText}>{busy ? 'Saving...' : 'Add observation'}</Text>
      </Pressable>

      <Pressable disabled={!chunks.length || busy} onPress={() => void finish()} style={[styles.finish, (!chunks.length || busy) && styles.disabled]}>
        <Icon name="sparkles" color={colors.background} size={20} /><Text style={styles.finishText}>{busy ? 'AI is building work orders...' : 'Finish Walkthrough & Create Work Orders'}</Text>
      </Pressable>
      <Text style={styles.finishNote}>The AI can create jobs, dependencies, and review flags. It does not dispatch employees automatically.</Text>
    </>}
  </ScrollView>;
}

function Selector({ title, items, selected, onSelect, optional = false }: { title: string; items: Array<{ id: string; label: string }>; selected: string; onSelect: (id: string) => void; optional?: boolean }) {
  return <View style={styles.selectorBlock}><Text style={styles.selectorTitle}>{title}{optional ? ' · optional' : ''}</Text><View style={styles.chips}>{items.length ? items.map((item) => <Pressable key={item.id} onPress={() => onSelect(item.id)} style={[styles.chip, selected === item.id && styles.chipActive]}><Text style={[styles.chipText, selected === item.id && styles.chipTextActive]}>{item.label}</Text></Pressable>) : <Text style={styles.emptyText}>No {title.toLowerCase()} options.</Text>}</View></View>;
}

function Message({ title, message }: { title: string; message: string }) {
  return <View style={styles.message}><Icon name="alert-circle-outline" color={colors.amber} size={28} /><Text style={styles.messageTitle}>{title}</Text><Text style={styles.messageText}>{message}</Text><Pressable onPress={() => router.back()} style={styles.primary}><Text style={styles.primaryText}>Back</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flexGrow: 1, gap: spacing.md, padding: spacing.lg, paddingBottom: 110 },
  topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm },
  back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  headerCopy: { flex: 1, marginLeft: spacing.md },
  eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: colors.text, ...typography.title, marginTop: 3 },
  aiIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 44, justifyContent: 'center', width: 44 },
  hero: { padding: spacing.lg },
  heroTitle: { color: colors.text, fontSize: 19, fontWeight: '900', lineHeight: 26 },
  heroText: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: spacing.sm },
  selectorBlock: { gap: spacing.sm },
  selectorTitle: { color: colors.muted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipActive: { backgroundColor: colors.tealDeep, borderColor: colors.teal },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: colors.teal },
  primary: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 54, paddingHorizontal: spacing.lg },
  primaryText: { color: colors.background, fontSize: 15, fontWeight: '900' },
  secondary: { alignItems: 'center', backgroundColor: colors.tealDeep, borderColor: colors.teal, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 50 },
  secondaryText: { color: colors.teal, fontSize: 14, fontWeight: '800' },
  finish: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 15, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 58, marginTop: spacing.sm, paddingHorizontal: spacing.md },
  finishText: { color: colors.background, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  finishNote: { color: colors.subtle, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  activeCard: { padding: spacing.md },
  activeTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  liveDot: { backgroundColor: colors.teal, borderRadius: 99, height: 9, width: 9 },
  live: { color: colors.teal, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  location: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: spacing.sm },
  sessionId: { color: colors.subtle, fontSize: 11, marginTop: 5 },
  voicePreview: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  micCircle: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 58, justifyContent: 'center', width: 58 },
  voiceCopy: { flex: 1 },
  voiceTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  voiceText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  sectionTitle: { color: colors.text, ...typography.heading },
  chunkCard: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  sequence: { color: colors.teal, fontSize: 12, fontWeight: '900' },
  chunkText: { color: colors.text, flex: 1, fontSize: 14, lineHeight: 20 },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, color: colors.text, minHeight: 120, padding: spacing.md, textAlignVertical: 'top' },
  completeCard: { alignItems: 'center', backgroundColor: colors.tealDeep, padding: spacing.lg },
  completeIcon: { alignItems: 'center', backgroundColor: colors.background, borderRadius: 999, height: 58, justifyContent: 'center', width: 58 },
  completeTitle: { color: colors.text, fontSize: 19, fontWeight: '900', marginTop: spacing.md },
  completeText: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: spacing.sm, textAlign: 'center' },
  issueCard: { padding: spacing.md },
  issueTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  issueTitle: { color: colors.text, fontSize: 16, fontWeight: '900', marginTop: spacing.md },
  issueMeta: { color: colors.teal, fontSize: 12, fontWeight: '800', marginTop: 5 },
  reviewReason: { color: colors.amber, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  dependency: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: spacing.sm },
  emptyText: { color: colors.subtle, fontSize: 12, lineHeight: 18 },
  errorCard: { backgroundColor: colors.redDeep },
  errorText: { color: colors.text, fontSize: 13 },
  message: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl },
  messageTitle: { color: colors.text, fontSize: 18, fontWeight: '900', marginTop: spacing.md },
  messageText: { color: colors.muted, fontSize: 14, lineHeight: 21, marginBottom: spacing.lg, marginTop: spacing.sm, textAlign: 'center' },
});
