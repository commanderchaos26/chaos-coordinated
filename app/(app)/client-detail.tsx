import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge, Card, EmptyState, Icon, SectionHeader } from '../../src/components/FieldUI';
import { getClientDocumentLink, uploadClientDocument } from '../../src/lib/clientPortalCommands';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type Client = { id: string; name: string; phone: string | null; email: string | null };
type Property = { id: string; name: string; address_line1: string | null; city: string | null; region: string | null; postal_code: string | null };
type DocumentRow = { id: string; document_type: 'contract' | 'turn_list'; version_no: number; original_file_name: string; status: string; created_at: string };
type ImportRow = { id: string; status: string; total_items: number; pending_count: number; needs_review_count: number; created_at: string };

export default function ClientDetailScreen() {
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (!current) return;

      const { data: clientRow, error: clientError } = await supabase
        .from('clients')
        .select('id,name,phone,email')
        .eq('company_id', current.companyId)
        .eq('id', clientId)
        .eq('active', true)
        .maybeSingle();
      if (clientError) throw clientError;
      if (!clientRow) throw new Error('Client not found.');
      setClient(clientRow as Client);

      const { data: links, error: linksError } = await supabase
        .from('client_properties')
        .select('property_id,is_primary')
        .eq('company_id', current.companyId)
        .eq('client_id', clientId)
        .order('is_primary', { ascending: false });
      if (linksError) throw linksError;

      let activeProperty: Property | null = null;
      const propertyIds = [...new Set((links ?? []).map((item) => item.property_id))];
      if (propertyIds.length) {
        const { data: propertyRows, error: propertyError } = await supabase
          .from('properties')
          .select('id,name,address_line1,city,region,postal_code')
          .eq('company_id', current.companyId)
          .eq('active', true)
          .in('id', propertyIds);
        if (propertyError) throw propertyError;

        const activeMap = new Map((propertyRows ?? []).map((item) => [item.id, item as Property]));
        for (const link of links ?? []) {
          const candidate = activeMap.get(link.property_id);
          if (candidate) {
            activeProperty = candidate;
            break;
          }
        }
      }
      setProperty(activeProperty);

      const documentResult = await supabase
        .from('client_documents')
        .select('id,document_type,version_no,original_file_name,status,created_at')
        .eq('company_id', current.companyId)
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      if (documentResult.error) throw documentResult.error;
      setDocuments((documentResult.data ?? []) as DocumentRow[]);

      if (activeProperty) {
        const importResult = await supabase
          .from('turn_list_imports')
          .select('id,status,total_items,pending_count,needs_review_count,created_at')
          .eq('company_id', current.companyId)
          .eq('client_id', clientId)
          .eq('property_id', activeProperty.id)
          .order('created_at', { ascending: false });
        if (importResult.error) throw importResult.error;
        setImports((importResult.data ?? []) as ImportRow[]);
      } else {
        setImports([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load client.');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const uploadAsset = async (asset: { uri: string; name: string; mimeType: string; size?: number | null }) => {
    if (!membership || !client || !property) return;
    setBusy(true);
    try {
      await uploadClientDocument({
        companyId: membership.companyId,
        clientId: client.id,
        propertyId: property.id,
        documentType: 'contract',
        uri: asset.uri,
        fileName: asset.name,
        mimeType: asset.mimeType,
        byteSize: asset.size ?? null,
      });
      await load();
      Alert.alert('Contract uploaded', 'The contract is now stored with this client.');
    } catch (cause) {
      Alert.alert('Upload failed', cause instanceof Error ? cause.message : 'Could not upload contract.');
    } finally {
      setBusy(false);
    }
  };

  const takeContractPhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera permission required', 'Allow camera access to photograph the contract.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85, allowsEditing: false });
    const asset = !result.canceled ? result.assets?.[0] : null;
    if (!asset) return;
    await uploadAsset({
      uri: asset.uri,
      name: asset.fileName || `contract-${Date.now()}.jpg`,
      mimeType: asset.mimeType || 'image/jpeg',
      size: asset.fileSize,
    });
  };

  const chooseContractFile = async () => {
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

  const chooseContractSource = () => {
    Alert.alert('Upload Contract', 'Choose how you want to add the contract.', [
      { text: 'Take Picture', onPress: () => { void takeContractPhoto(); } },
      { text: 'Choose File', onPress: () => { void chooseContractFile(); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const openDocument = async (documentId: string) => {
    if (!membership) return;
    setBusy(true);
    try {
      const link = await getClientDocumentLink(membership.companyId, documentId);
      await Linking.openURL(link.signed_url);
    } catch (cause) {
      Alert.alert('Could not open document', cause instanceof Error ? cause.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !client) return <LoadingScreen label="Loading client..." />;

  const contracts = documents.filter((item) => item.document_type === 'contract');
  const latestImport = imports[0] ?? null;
  const address = property ? [property.address_line1, property.city, property.region, property.postal_code].filter(Boolean).join(', ') : '';

  return (
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21}/></Pressable>
        <View style={styles.titleWrap}><Text style={styles.eyebrow}>CLIENT PORTAL</Text><Text style={styles.title}>{client?.name || 'Client'}</Text></View>
      </View>

      {error ? <Card style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></Card> : null}

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Client information</Text>
        <Info icon="call-outline" text={client?.phone || 'No phone number'} />
        <Info icon="mail-outline" text={client?.email || 'No email address'} />
        <Info icon="business-outline" text={property?.name || 'No active property'} />
        <Info icon="location-outline" text={address || 'No property address'} />
      </Card>

      <View style={styles.actionGrid}>
        <Pressable disabled={busy || !property} onPress={chooseContractSource} style={[styles.actionCard, (busy || !property) && styles.disabled]}>
          <Icon name="document-attach-outline" color={colors.teal} size={28}/>
          <Text style={styles.actionTitle}>Upload Contract</Text>
          <Text style={styles.actionText}>Take a picture or choose a file.</Text>
        </Pressable>
        <Pressable
          disabled={busy || !property}
          onPress={() => property && router.push({ pathname: '/(app)/turn-list-import' as never, params: { clientId: client?.id, propertyId: property.id } })}
          style={[styles.actionCard, (busy || !property) && styles.disabled]}
        >
          <Icon name="list-outline" color={colors.teal} size={28}/>
          <Text style={styles.actionTitle}>Turn List Import</Text>
          <Text style={styles.actionText}>Upload a document or picture and extract building/unit numbers.</Text>
        </Pressable>
      </View>

      <SectionHeader title="Contracts" />
      {contracts.length ? contracts.map((document, index) => (
        <Pressable key={document.id} disabled={busy} onPress={() => void openDocument(document.id)}>
          <Card style={styles.documentCard}>
            <View style={styles.documentIcon}><Icon name="document-text-outline" color={colors.teal} size={22}/></View>
            <View style={styles.documentCopy}>
              <Text style={styles.documentLink}>{index === 0 ? 'Contract' : `Contract · version ${document.version_no}`}</Text>
              <Text style={styles.documentMeta}>{document.original_file_name} · {new Date(document.created_at).toLocaleDateString()}</Text>
            </View>
            <Icon name="open-outline" color={colors.subtle} size={18}/>
          </Card>
        </Pressable>
      )) : <EmptyState icon="document-outline" title="No contract uploaded" message="Use Upload Contract to photograph or choose the client's contract." />}

      <SectionHeader title="Turn list status" />
      {latestImport ? (
        <Card style={styles.card}>
          <View style={styles.importTop}><Text style={styles.cardTitle}>Latest import</Text><Badge label={latestImport.status.replaceAll('_',' ')} tone={latestImport.needs_review_count ? 'amber' : latestImport.status === 'committed' ? 'teal' : 'blue'} /></View>
          <View style={styles.stats}>
            <Stat label="TOTAL" value={latestImport.total_items} />
            <Stat label="PENDING" value={latestImport.pending_count} />
            <Stat label="REVIEW" value={latestImport.needs_review_count} />
          </View>
          <Pressable onPress={() => router.push('/(app)/ai-walkthrough' as never)} style={styles.queueButton}>
            <Icon name="mic-outline" color={colors.background} size={18}/><Text style={styles.queueText}>Open AI Walkthrough Queue</Text>
          </Pressable>
        </Card>
      ) : <EmptyState icon="list-outline" title="No turn list imported" message="Turn List Import creates the apartment queue for AI walkthroughs." />}
    </ScrollView>
  );
}

function Info({ icon, text }: { icon: string; text: string }) {
  return <View style={styles.infoRow}><Icon name={icon as any} color={colors.subtle} size={17}/><Text style={styles.infoText}>{text}</Text></View>;
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
  card: { padding: spacing.md },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  infoRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  infoText: { color: colors.muted, flex: 1, fontSize: 13 },
  actionGrid: { flexDirection: 'row', gap: spacing.sm },
  actionCard: { alignItems: 'center', backgroundColor: colors.tealDeep, borderColor: colors.teal, borderRadius: 16, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 150, padding: spacing.md },
  actionTitle: { color: colors.text, fontSize: 14, fontWeight: '900', marginTop: spacing.sm, textAlign: 'center' },
  actionText: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 5, textAlign: 'center' },
  disabled: { opacity: 0.5 },
  documentCard: { alignItems: 'center', flexDirection: 'row', padding: spacing.md },
  documentIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 12, height: 44, justifyContent: 'center', width: 44 },
  documentCopy: { flex: 1, marginLeft: spacing.md },
  documentLink: { color: colors.teal, fontSize: 15, fontWeight: '900', textDecorationLine: 'underline' },
  documentMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  importTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  stats: { flexDirection: 'row', marginTop: spacing.lg },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '900' },
  statLabel: { color: colors.subtle, fontSize: 9, fontWeight: '900', letterSpacing: 0.8, marginTop: 3 },
  queueButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, flexDirection: 'row', gap: 7, justifyContent: 'center', marginTop: spacing.lg, minHeight: 48 },
  queueText: { color: colors.background, fontSize: 13, fontWeight: '900' },
  errorCard: { backgroundColor: colors.redDeep, padding: spacing.md },
  errorText: { color: colors.text },
});
