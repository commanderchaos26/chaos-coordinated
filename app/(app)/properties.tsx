import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Badge, Card, EmptyState, Icon } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { loadMembership } from '../../src/lib/membership';
import { archiveProperty, createBuilding, createProperty, createUnit, setCircleGeofence } from '../../src/lib/operationsCommands';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type PropertyRow = { id: string; name: string; address_line1: string | null; city: string | null; region: string | null; postal_code: string | null; active: boolean };
type BuildingRow = { id: string; property_id: string; name: string; code: string | null; active: boolean };
type UnitRow = { id: string; property_id: string; building_id: string; unit_number: string; layout_name: string | null; active: boolean };
type SiteRow = { id: string; property_id: string | null; label: string; site_type: string; active: boolean; reviewed: boolean };

type ModalKind = 'property' | 'building' | 'unit' | 'geofence' | null;

const canManage = (membership: Membership | null) => Boolean(membership?.roles.some((role) => role === 'owner' || role === 'operations_manager'));

const deleteErrorMessage = (message: string) => {
  if (message.includes('property_has_active_work')) return 'This property still has open work orders. Complete or cancel them before deleting the property.';
  if (message.includes('property_has_active_turnovers')) return 'This property still has active turnovers. Close or cancel them before deleting the property.';
  if (message.includes('property_not_found')) return 'This property is already deleted or is no longer available.';
  return message || 'Could not delete property.';
};

export default function PropertiesScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [buildings, setBuildings] = useState<BuildingRow[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingPropertyId, setDeletingPropertyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);

  const [propertyId, setPropertyId] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('MI');
  const [postalCode, setPostalCode] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [layoutName, setLayoutName] = useState('');
  const [radius, setRadius] = useState('150');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (!current) return;
      const [p, b, u, s] = await Promise.all([
        supabase.from('properties').select('id,name,address_line1,city,region,postal_code,active').eq('company_id', current.companyId).eq('active', true).order('name'),
        supabase.from('buildings').select('id,property_id,name,code,active').eq('company_id', current.companyId).eq('active', true).order('name'),
        supabase.from('units').select('id,property_id,building_id,unit_number,layout_name,active').eq('company_id', current.companyId).eq('active', true).order('unit_number'),
        supabase.from('work_sites').select('id,property_id,label,site_type,active,reviewed').eq('company_id', current.companyId).eq('active', true).order('label'),
      ]);
      const failed = [p, b, u, s].find((result) => result.error);
      if (failed?.error) throw failed.error;
      setProperties((p.data ?? []) as PropertyRow[]);
      setBuildings((b.data ?? []) as BuildingRow[]);
      setUnits((u.data ?? []) as UnitRow[]);
      setSites((s.data ?? []) as SiteRow[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load property setup.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const resetForm = () => {
    setPropertyId(''); setBuildingId(''); setName(''); setCode(''); setAddress(''); setCity(''); setRegion('MI'); setPostalCode(''); setUnitNumber(''); setLayoutName(''); setRadius('150');
  };

  const open = (kind: Exclude<ModalKind, null>, presetPropertyId = '') => {
    resetForm();
    setPropertyId(presetPropertyId);
    setModal(kind);
  };

  const saveProperty = async () => {
    if (!membership || !name.trim() || saving) return;
    setSaving(true);
    try {
      await createProperty({ p_company_id: membership.companyId, p_name: name.trim(), p_address_line1: address.trim() || null, p_address_line2: null, p_city: city.trim() || null, p_region: region.trim() || null, p_postal_code: postalCode.trim() || null, p_country_code: 'US', p_timezone: 'America/Detroit' });
      setModal(null); await load();
    } catch (cause) { Alert.alert('Could not create property', cause instanceof Error ? cause.message : 'Unknown error'); }
    finally { setSaving(false); }
  };

  const saveBuilding = async () => {
    if (!membership || !propertyId || !name.trim() || saving) return;
    setSaving(true);
    try {
      await createBuilding({ p_company_id: membership.companyId, p_property_id: propertyId, p_name: name.trim(), p_code: code.trim() || null });
      setModal(null); await load();
    } catch (cause) { Alert.alert('Could not create building', cause instanceof Error ? cause.message : 'Unknown error'); }
    finally { setSaving(false); }
  };

  const saveUnit = async () => {
    if (!membership || !propertyId || !buildingId || !unitNumber.trim() || saving) return;
    setSaving(true);
    try {
      await createUnit({ p_company_id: membership.companyId, p_property_id: propertyId, p_building_id: buildingId, p_unit_number: unitNumber.trim(), p_layout_name: layoutName.trim() || null });
      setModal(null); await load();
    } catch (cause) { Alert.alert('Could not create unit', cause instanceof Error ? cause.message : 'Unknown error'); }
    finally { setSaving(false); }
  };

  const saveGeofence = async () => {
    if (!membership || !propertyId || saving) return;
    const radiusMeters = Number(radius);
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) { Alert.alert('Invalid radius', 'Enter a radius greater than zero.'); return; }
    setSaving(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') { Alert.alert('Location permission required', 'Allow location while setting the property geofence. Employees are not continuously tracked.'); return; }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const property = properties.find((item) => item.id === propertyId);
      await setCircleGeofence({ p_company_id: membership.companyId, p_property_id: propertyId, p_label: `${property?.name ?? 'Property'} geofence`, p_latitude: position.coords.latitude, p_longitude: position.coords.longitude, p_radius_meters: radiusMeters, p_max_accuracy_meters: 75 });
      setModal(null); await load();
      Alert.alert('Geofence saved', 'The current location is now the center of this property geofence.');
    } catch (cause) { Alert.alert('Could not save geofence', cause instanceof Error ? cause.message : 'Unknown error'); }
    finally { setSaving(false); }
  };

  const deleteProperty = async (property: PropertyRow) => {
    if (!membership || deletingPropertyId) return;
    setDeletingPropertyId(property.id);
    try {
      await archiveProperty({ p_company_id: membership.companyId, p_property_id: property.id });
      await load();
      Alert.alert('Property deleted', `${property.name} was removed from active property setup. Existing completed history was preserved.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not delete property.';
      Alert.alert('Could not delete property', deleteErrorMessage(message));
    } finally {
      setDeletingPropertyId(null);
    }
  };

  const confirmDeleteProperty = (property: PropertyRow) => {
    Alert.alert(
      'Delete property?',
      `Delete ${property.name} from active property setup? Buildings, units, and geofences under it will also be removed from active setup. Completed history is preserved. Open work orders or active turnovers will block deletion.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete property', style: 'destructive', onPress: () => void deleteProperty(property) },
      ],
    );
  };

  const availableBuildings = useMemo(() => buildings.filter((item) => !propertyId || item.property_id === propertyId), [buildings, propertyId]);

  if (loading) return <LoadingScreen label="Loading properties..." />;
  if (!canManage(membership)) return <View style={styles.message}><Icon name="lock-closed-outline" color={colors.amber} size={26} /><Text style={styles.messageTitle}>Setup access required</Text><Text style={styles.messageText}>Property and geofence setup is available to Owner and Operations Manager roles.</Text></View>;

  return <>
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <View style={styles.header}><Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={22} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>OPERATIONS SETUP</Text><Text style={styles.title}>Properties & geofences</Text></View></View>
      <Text style={styles.intro}>Create properties, buildings, units, and event-based geofences. Location is checked at work events, not continuously.</Text>
      {error ? <Card style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></Card> : null}
      <Pressable onPress={() => open('property')} style={styles.primary}><Icon name="add" color={colors.background} size={19} /><Text style={styles.primaryText}>Add property</Text></Pressable>
      {properties.length ? properties.map((property) => {
        const propertyBuildings = buildings.filter((item) => item.property_id === property.id);
        const propertyUnits = units.filter((item) => item.property_id === property.id);
        const propertySites = sites.filter((item) => item.property_id === property.id);
        return <Card key={property.id} style={styles.propertyCard}>
          <View style={styles.rowBetween}><View style={styles.flex}><Text style={styles.propertyName}>{property.name}</Text><Text style={styles.address}>{[property.address_line1, property.city, property.region, property.postal_code].filter(Boolean).join(', ') || 'Address not entered'}</Text></View>{propertySites.length ? <Badge label="Geofence set" tone="teal" /> : <Badge label="No geofence" tone="amber" />}</View>
          <View style={styles.stats}><Text style={styles.stat}>{propertyBuildings.length} buildings</Text><Text style={styles.stat}>{propertyUnits.length} units</Text></View>
          {propertyBuildings.map((building) => <View key={building.id} style={styles.building}><View><Text style={styles.buildingName}>{building.name}{building.code ? ` · ${building.code}` : ''}</Text><Text style={styles.unitText}>{propertyUnits.filter((unit) => unit.building_id === building.id).map((unit) => unit.unit_number).join(', ') || 'No units yet'}</Text></View></View>)}
          <View style={styles.actions}><Pressable onPress={() => open('building', property.id)} style={styles.secondary}><Text style={styles.secondaryText}>Add building</Text></Pressable><Pressable onPress={() => open('unit', property.id)} style={styles.secondary}><Text style={styles.secondaryText}>Add unit</Text></Pressable><Pressable onPress={() => open('geofence', property.id)} style={styles.secondary}><Text style={styles.secondaryText}>{propertySites.length ? 'Update geofence' : 'Set geofence'}</Text></Pressable><Pressable disabled={deletingPropertyId === property.id} onPress={() => confirmDeleteProperty(property)} style={[styles.secondary, styles.danger, deletingPropertyId === property.id && styles.disabled]}><Icon name="trash-outline" color={colors.red} size={16} /><Text style={[styles.secondaryText, styles.dangerText]}>{deletingPropertyId === property.id ? 'Deleting…' : 'Delete property'}</Text></Pressable></View>
        </Card>;
      }) : <EmptyState icon="business-outline" title="No properties yet" message="Add the first property before creating unit work orders or geofences." />}
    </ScrollView>

    <Modal visible={Boolean(modal)} transparent animationType="slide" onRequestClose={() => !saving && setModal(null)}>
      <View style={styles.backdrop}><View style={styles.modal}><View style={styles.modalHead}><Text style={styles.modalTitle}>{modal === 'property' ? 'Add property' : modal === 'building' ? 'Add building' : modal === 'unit' ? 'Add unit' : 'Set property geofence'}</Text><Pressable onPress={() => !saving && setModal(null)}><Icon name="close" color={colors.muted} size={25} /></Pressable></View><ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {modal !== 'property' && <><Text style={styles.label}>PROPERTY</Text><ChipList items={properties.map((item) => ({ id: item.id, label: item.name }))} selected={propertyId} onSelect={(id) => { setPropertyId(id); setBuildingId(''); }} /></>}
        {modal === 'property' && <><Field label="PROPERTY NAME" value={name} onChangeText={setName} placeholder="Example: Riverbend Apartments" /><Field label="ADDRESS" value={address} onChangeText={setAddress} placeholder="123 Main St" /><Field label="CITY" value={city} onChangeText={setCity} placeholder="Lansing" /><Field label="STATE / REGION" value={region} onChangeText={setRegion} placeholder="MI" /><Field label="ZIP / POSTAL CODE" value={postalCode} onChangeText={setPostalCode} placeholder="48910" /></>}
        {modal === 'building' && <><Field label="BUILDING NAME" value={name} onChangeText={setName} placeholder="Building A" /><Field label="BUILDING CODE" value={code} onChangeText={setCode} placeholder="A" /></>}
        {modal === 'unit' && <><Text style={styles.label}>BUILDING</Text><ChipList items={availableBuildings.map((item) => ({ id: item.id, label: item.name }))} selected={buildingId} onSelect={setBuildingId} /><Field label="UNIT NUMBER" value={unitNumber} onChangeText={setUnitNumber} placeholder="214" /><Field label="LAYOUT" value={layoutName} onChangeText={setLayoutName} placeholder="2 bed / 1 bath" /></>}
        {modal === 'geofence' && <><Field label="RADIUS IN METERS" value={radius} onChangeText={setRadius} placeholder="150" keyboardType="numeric" /><Text style={styles.help}>Stand at a useful central point on the property, then save. The app records this position only to define the boundary.</Text></>}
        <Pressable disabled={saving} onPress={() => void (modal === 'property' ? saveProperty() : modal === 'building' ? saveBuilding() : modal === 'unit' ? saveUnit() : saveGeofence())} style={[styles.save, saving && styles.disabled]}><Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text></Pressable>
      </ScrollView></View></View>
    </Modal>
  </>;
}

function ChipList({ items, selected, onSelect }: { items: { id: string; label: string }[]; selected: string; onSelect: (id: string) => void }) {
  return <View style={styles.chips}>{items.length ? items.map((item) => <Pressable key={item.id} onPress={() => onSelect(item.id)} style={[styles.chip, selected === item.id && styles.chipActive]}><Text style={[styles.chipText, selected === item.id && styles.chipTextActive]}>{item.label}</Text></Pressable>) : <Text style={styles.help}>Nothing available yet.</Text>}</View>;
}

function Field({ label, value, onChangeText, placeholder, keyboardType }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; keyboardType?: 'default' | 'numeric' }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.subtle} keyboardType={keyboardType} style={styles.input} /></View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, gap: spacing.lg, padding: spacing.lg, paddingBottom: 110 }, header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, paddingTop: spacing.sm }, back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, height: 46, justifyContent: 'center', width: 46 }, headerCopy: { flex: 1 }, eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 }, title: { color: colors.text, ...typography.title, marginTop: 3 }, intro: { color: colors.muted, fontSize: 14, lineHeight: 21 }, primary: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 54 }, primaryText: { color: colors.background, fontSize: 15, fontWeight: '900' }, propertyCard: { gap: spacing.md }, rowBetween: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' }, flex: { flex: 1 }, propertyName: { color: colors.text, fontSize: 18, fontWeight: '900' }, address: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 4 }, stats: { flexDirection: 'row', gap: spacing.lg }, stat: { color: colors.teal, fontSize: 12, fontWeight: '800' }, building: { backgroundColor: colors.surfaceSoft, borderRadius: 12, padding: spacing.md }, buildingName: { color: colors.text, fontSize: 14, fontWeight: '800' }, unitText: { color: colors.muted, fontSize: 12, marginTop: 4 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, secondary: { backgroundColor: colors.surfaceSoft, borderColor: colors.border, borderRadius: 11, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, secondaryText: { color: colors.text, fontSize: 12, fontWeight: '800' }, danger: { alignItems: 'center', backgroundColor: colors.redDeep, borderColor: colors.red, flexDirection: 'row', gap: spacing.xs }, dangerText: { color: colors.red }, errorCard: { backgroundColor: colors.redDeep }, errorText: { color: colors.text }, message: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xxl }, messageTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: spacing.md }, messageText: { color: colors.muted, marginTop: spacing.sm, textAlign: 'center' }, backdrop: { backgroundColor: '#000000AA', flex: 1, justifyContent: 'flex-end' }, modal: { backgroundColor: colors.surface, borderColor: colors.border, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, maxHeight: '88%', padding: spacing.lg, paddingBottom: 36 }, modalHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.lg }, modalTitle: { color: colors.text, fontSize: 22, fontWeight: '900' }, field: { marginBottom: spacing.md }, label: { color: colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 0.8, marginBottom: spacing.sm }, input: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: 12, borderWidth: 1, color: colors.text, fontSize: 15, minHeight: 50, paddingHorizontal: spacing.md }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg }, chip: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: 12, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, chipActive: { backgroundColor: colors.tealDeep, borderColor: colors.teal }, chipText: { color: colors.muted, fontSize: 13, fontWeight: '800' }, chipTextActive: { color: colors.teal }, help: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: spacing.lg }, save: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, justifyContent: 'center', minHeight: 54, marginTop: spacing.sm }, saveText: { color: colors.background, fontSize: 15, fontWeight: '900' }, disabled: { opacity: 0.5 },
});
