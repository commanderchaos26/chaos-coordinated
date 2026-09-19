import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Badge, Card, EmptyState, Icon, SectionHeader } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { commitTurnListImport, correctTurnListItem, scanTurnList, uploadClientDocument } from '../../src/lib/clientPortalCommands';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type ImportRow = {
  id: string;
  status: string;
  total_items: number;
  pending_count: number;
  needs_review_count: number;
  error_message: string | null;
  created_at: string;
};

type ItemRow = {
  id: string;
  building_label: string;
  unit_number: string;
  source_page: number | null;
  status: string;
  confidence: number | null;
  review_reason: string | null;
  raw_text: string | null;
};

export default function TurnListImportScreen() {
  const { clientId, propertyId } = useLocalSearchParams<{ clientId?: string; propertyId?: string }>();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [turnImport, setTurnImport] = useState<ImportRow | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [clientName, setClientName] = useState('');
  const [propertyName, setPropertyName] = useState('');
  const [propertyActive, setPropertyActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<ItemRow | null>(null);
  const [editBuilding, setEditBuilding] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId || !propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (!current) return;

      const [clientResult, propertyResult, importResult] = await Promise.all([
        supabase.from('clients').select('name,active').eq('company_id', current.companyId).eq('id', clientId).maybeSingle(),
        supabase.from('properties').select('name,active').eq('company_id', current.companyId).eq('id', propertyId).maybeSingle(),
        supabase
          .from('turn_list_imports')
          .select('id,status,total_items,pending_count,needs_review_count,error_message,created_at')
          .eq('company_id', current.companyId)
          .eq('client_id', clientId)
          .eq('property_id', propertyId)
          .order('created_at', { ascending: false })
          .limit(1),
      ]);
      if (clientResult.error) throw clientResult.error;
      if (propertyResult.error) throw propertyResult.error;
      if (importResult.error) throw importResult.error;
      setClientName(clientResult.data?.name ?? 'Client');
      setPropertyName(propertyResult.data?.name ?? 'Property');
      const isActive = Boolean(clientResult.data?.active && propertyResult.data?.active);
      setPropertyActive(isActive);

      const latest = (importResult.data ?? [])[0] as ImportRow | undefined;
      setTurnImport(latest ?? null);

      if (latest) {
        const { data: itemRows, error: itemError } = await supabase
          .from('turn_list_items')
          .select('id,building_label,unit_number,source_page,status,confidence,review_reason,raw_text')
          .eq('company_id', current.companyId)
          .eq('import_id', latest.id)
          .order('building_label')
          .order('unit_number');
        if (itemError) throw itemError;
        setItems((itemRows ?? []) as ItemRow[]);
      } else {
        setItems([]);
      }

      if (!isActive) {
        setError('This client or property is archived. Turn-list uploads, scans, corrections, and queue changes are disabled.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load turn-list import.');
    } finally {
      setLoading(false);
    }
  }, [clientId, propertyId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const scanUploadedImport = async (importId: string) => {
    if (!membership) return;
    setBusy('scan');
    try {
      const result = await scanTurnList(membership.companyId, importId);
      await load();
      Alert.alert('Turn list scanned', `${result.total_items} unique apartment${result.total_items === 1 ? '' : 's'} found.${result.needs_review_count ? ` ${result.needs_review_count} need review.` : ''}`);
    } catch (cause) {
      Alert.alert('AI scan failed', cause instanceof Error ? cause.message : 'Could not scan the turn list.');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const uploadAsset = async (asset: { uri: string; name: string; mimeType: string; size?: number | null }) => {
    if (!membership || !clientId || !propertyId) return;
    if (!propertyActive) {
      Alert.alert('Property archived', 'Turn-list uploads are disabled for archived properties.');
      return;
    }
    setBusy('upload');
    try {
      const uploaded = await uploadClientDocument({
        companyId: membership.companyId,
        clientId,
        propertyId,
        documentType: 'turn_list',
        uri: asset.uri,
        fileName: asset.name,
        mimeType: asset.mimeType,
        byteSize: asset.size ?? null,
      });
      if (!uploaded.import_id) throw new Error('Turn-list import was not created.');
      await load();
      await scanUploadedImport(uploaded.import_id);
    } catch (cause) {
      Alert.alert('Upload failed', cause instanceof Error ? cause.message : 'Could not upload turn list.');
    } finally {
      setBusy(null);
    }
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera permission required', 'Allow camera access to photograph the turn list.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: false });
    const asset = !result.canceled ? result.assets?.[0] : null;
    if (!asset) return;
    await uploadAsset({
      uri: asset.uri,
      name: asset.fileName || `turn-list-${Date.now()}.jpg`,
      mimeType: asset.mimeType || 'image/jpeg',
      size: asset.fileSize,
    });
  };

  const chooseFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf','image/jpeg','image/png','image/webp','text/plain'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    await uploadAsset({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType || 'application/pdf',
      size: asset.size,
    });
  };

  const chooseSource = () => {
    Alert.alert('Turn List Import', 'Choose the source document.', [
      { text: 'Take Picture', onPress: () => { void takePhoto(); } },
      { text: 'Choose File', onPress: () => { void chooseFile(); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const openEdit = (item: ItemRow) => {
    setEditItem(item);
    setEditBuilding(item.building_label === 'Unknown' ? '' : item.building_label);
    setEditUnit(item.unit_number);
  };

  const saveCorrection = async () => {
    if (!membership || !propertyActive || !editItem || !editBuilding.trim() || !editUnit.trim()) return;
    setBusy(editItem.id);
    try {
      await correctTurnListItem(membership.companyId, editItem.id, editBuilding.trim(), editUnit.trim());
      setEditItem(null);
      await load();
    } catch (cause) {
      Alert.alert('Correction failed', cause instanceof Error ? cause.message : 'Could not update this apartment.');
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!membership || !propertyActive || !turnImport) return;
    const reviewCount = items.filter((item) => item.status === 'needs_review').length;
    if (reviewCount) {
      Alert.alert('Review required', `Correct the ${reviewCount} highlighted item${reviewCount === 1 ? '' : 's'} before adding this list to the walkthrough queue.`);
      return;
    }
    setBusy('commit');
    try {
      const result = await commitTurnListImport(membership.companyId, turnImport.id);
      await load();
      Alert.alert('Walkthrough queue ready', `${result.pending_count} apartment${result.pending_count === 1 ? '' : 's'} added to the AI Walkthrough queue.`);
    } catch (cause) {
      Alert.alert('Could not approve import', cause instanceof Error ? cause.message : 'Try again.');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !membership) return <LoadingScreen label="Loading turn list..." />;

  const reviewCount = items.filter((item) => item.status === 'needs_review').length;
  const committed = turnImport?.status === 'committed';

  return (
    <>
      <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
        <View style={styles.topbar}>
          <Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21}/></Pressable>
          <View style={styles.titleWrap}><Text style={styles.eyebrow}>CLIENT PORTAL</Text><Text style={styles.title}>Turn List Import</Text></View>
        </View>

        <Card style={styles.hero}>
          <Text style={styles.heroTitle}>{clientName}</Text>
          <Text style={styles.heroProperty}>{propertyName}</Text>
          <Text style={styles.heroText}>Upload the client’s turn list. The AI extracts only building and apartment numbers. The walkthrough determines what work the apartment actually needs.</Text>
        </Card>

        <Pressable disabled={Boolean(busy) || !propertyActive} onPress={chooseSource} style={[styles.uploadButton, (Boolean(busy) || !propertyActive) && styles.disabled]}>
          <Icon name="cloud-upload-outline" color={colors.background} size={22}/>
          <Text style={styles.uploadText}>{busy === 'upload' ? 'Uploading…' : busy === 'scan' ? 'AI is scanning…' : 'Upload New Turn List'}</Text>
        </Pressable>

        {error ? <Card style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></Card> : null}

        {turnImport ? (
          <Card style={styles.summaryCard}>
            <View style={styles.summaryTop}><Text style={styles.summaryTitle}>Latest import</Text><Badge label={turnImport.status} tone={reviewCount ? 'amber' : committed ? 'teal' : 'blue'} /></View>
            <View style={styles.stats}>
              <Stat label="FOUND" value={turnImport.total_items} />
              <Stat label="PENDING" value={turnImport.pending_count} />
              <Stat label="REVIEW" value={reviewCount || turnImport.needs_review_count} />
            </View>
            {turnImport.error_message ? <Text style={styles.errorText}>{turnImport.error_message}</Text> : null}
          </Card>
        ) : null}

        <SectionHeader title={committed ? 'Walkthrough queue' : 'AI extraction review'} />
        {items.length ? items.map((item) => (
          <Card key={item.id} style={[styles.itemCard, item.status === 'needs_review' && styles.reviewCard]}>
            <View style={styles.itemTop}>
              <View>
                <Text style={styles.itemTitle}>Building {item.building_label} · Unit {item.unit_number}</Text>
                <Text style={styles.itemMeta}>
                  {item.source_page ? `Source page ${item.source_page} · ` : ''}
                  {item.confidence != null ? `${Math.round(Number(item.confidence) * 100)}% confidence` : 'Confidence unavailable'}
                </Text>
              </View>
              <Badge label={item.status.replaceAll('_',' ')} tone={item.status === 'needs_review' ? 'amber' : item.status === 'pending' ? 'teal' : 'blue'} />
            </View>
            {item.review_reason ? <Text style={styles.reviewReason}>{item.review_reason}</Text> : null}
            {item.raw_text ? <Text style={styles.sourceText}>Source: {item.raw_text}</Text> : null}
            {!committed && ['draft','needs_review'].includes(item.status) ? (
              <Pressable onPress={() => openEdit(item)} style={styles.editButton}>
                <Icon name="create-outline" color={colors.teal} size={17}/><Text style={styles.editText}>Correct building / unit</Text>
              </Pressable>
            ) : null}
          </Card>
        )) : (
          <EmptyState icon="scan-outline" title="No apartments extracted yet" message="Upload a photo, PDF, or text document to build the turn queue." />
        )}

        {propertyActive && turnImport && !committed && items.length ? (
          <Pressable disabled={Boolean(busy)} onPress={() => void approve()} style={[styles.approveButton, (Boolean(busy) || reviewCount > 0) && styles.disabled]}>
            <Icon name="checkmark-done-outline" color={colors.background} size={21}/>
            <Text style={styles.approveText}>{busy === 'commit' ? 'Building queue…' : reviewCount ? `Review ${reviewCount} item${reviewCount === 1 ? '' : 's'} first` : 'Approve & Add to Walkthrough Queue'}</Text>
          </Pressable>
        ) : null}

        {propertyActive && committed ? (
          <Pressable onPress={() => router.replace('/(app)/ai-walkthrough' as never)} style={styles.approveButton}>
            <Icon name="mic-outline" color={colors.background} size={21}/><Text style={styles.approveText}>Open AI Walkthrough Queue</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal visible={Boolean(editItem)} transparent animationType="fade" onRequestClose={() => setEditItem(null)}>
        <View style={styles.modalShade}>
          <View style={styles.modal}>
            <View style={styles.modalTop}><Text style={styles.modalTitle}>Correct apartment</Text><Pressable onPress={() => setEditItem(null)}><Icon name="close" color={colors.text} size={22}/></Pressable></View>
            <Text style={styles.fieldLabel}>Building</Text>
            <TextInput value={editBuilding} onChangeText={setEditBuilding} placeholder="Building number or name" placeholderTextColor={colors.subtle} style={styles.input}/>
            <Text style={styles.fieldLabel}>Apartment / Unit</Text>
            <TextInput value={editUnit} onChangeText={setEditUnit} placeholder="Unit number" placeholderTextColor={colors.subtle} style={styles.input}/>
            <Pressable disabled={Boolean(busy) || !editBuilding.trim() || !editUnit.trim()} onPress={() => void saveCorrection()} style={[styles.approveButton, (Boolean(busy) || !editBuilding.trim() || !editUnit.trim()) && styles.disabled]}>
              <Text style={styles.approveText}>Save correction</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flexGrow: 1, gap: spacing.md, padding: spacing.lg, paddingBottom: 110 },
  topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm },
  back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  titleWrap: { flex: 1, marginLeft: spacing.md },
  eyebrow: { color: colors.teal, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: colors.text, ...typography.title, marginTop: 3 },
  hero: { padding: spacing.lg },
  heroTitle: { color: colors.text, fontSize: 20, fontWeight: '900' },
  heroProperty: { color: colors.teal, fontSize: 13, fontWeight: '800', marginTop: 3 },
  heroText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: spacing.md },
  uploadButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 54 },
  uploadText: { color: colors.background, fontSize: 14, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  summaryCard: { padding: spacing.md },
  summaryTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  summaryTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  stats: { flexDirection: 'row', marginTop: spacing.lg },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '900' },
  statLabel: { color: colors.subtle, fontSize: 9, fontWeight: '900', letterSpacing: 0.8, marginTop: 3 },
  itemCard: { padding: spacing.md },
  reviewCard: { borderColor: colors.amber, borderWidth: 1 },
  itemTop: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  itemTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  itemMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  reviewReason: { color: colors.amber, fontSize: 11, lineHeight: 16, marginTop: spacing.sm },
  sourceText: { color: colors.subtle, fontSize: 10, lineHeight: 15, marginTop: spacing.sm },
  editButton: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 6, marginTop: spacing.md },
  editText: { color: colors.teal, fontSize: 12, fontWeight: '800' },
  approveButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 54, paddingHorizontal: spacing.md },
  approveText: { color: colors.background, fontSize: 13, fontWeight: '900', textAlign: 'center' },
  errorCard: { backgroundColor: colors.redDeep, padding: spacing.md },
  errorText: { color: colors.text, fontSize: 11, marginTop: spacing.sm },
  modalShade: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.72)', flex: 1, justifyContent: 'center', padding: spacing.lg },
  modal: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 20, borderWidth: 1, padding: spacing.lg, width: '100%' },
  modalTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  fieldLabel: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginTop: spacing.lg, textTransform: 'uppercase' },
  input: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 12, borderWidth: 1, color: colors.text, marginBottom: spacing.sm, marginTop: 6, minHeight: 50, paddingHorizontal: spacing.md },
});
