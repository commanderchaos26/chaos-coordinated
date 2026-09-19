import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, Icon } from '../../src/components/FieldUI';
import { createClientWithProperty } from '../../src/lib/clientPortalCommands';
import { loadMembership } from '../../src/lib/membership';
import { colors, spacing, typography } from '../../src/theme';

export default function NewClientScreen() {
  const [clientName, setClientName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [propertyName, setPropertyName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [postal, setPostal] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!clientName.trim() || !address.trim()) {
      Alert.alert('Required information', 'Enter the client name and property street address.');
      return;
    }

    setBusy(true);

    let created: { ok: boolean; client: { id?: string } | null; property: { id?: string } | null } | null = null;
    try {
      const membership = await loadMembership();
      if (!membership) throw new Error('Sign in again before creating a client.');

      created = await createClientWithProperty({
        p_company_id: membership.companyId,
        p_client_name: clientName.trim(),
        p_phone: phone.trim() || null,
        p_email: email.trim() || null,
        p_property_name: propertyName.trim() || null,
        p_address_line1: address.trim(),
        p_city: city.trim() || null,
        p_region: region.trim() || null,
        p_postal_code: postal.trim() || null,
        p_country_code: 'US',
      });

      if (!created?.ok || !created.client?.id) {
        throw new Error('The server did not return the new client record.');
      }
    } catch (cause) {
      Alert.alert('Could not create client', getErrorMessage(cause, 'Try again.'));
      setBusy(false);
      return;
    }

    setBusy(false);

    try {
      if (created.property?.id) {
        router.replace({
          pathname: '/(app)/turn-list-import' as never,
          params: { clientId: created.client.id, propertyId: created.property.id },
        });
      } else {
        router.replace({
          pathname: '/(app)/client-detail' as never,
          params: { clientId: created.client.id },
        });
      }
    } catch (cause) {
      Alert.alert(
        'Client created',
        `The client was saved successfully, but the detail screen could not open. Open Client Portal to continue.\n\n${getErrorMessage(cause, 'Navigation failed.')}`,
        [{ text: 'OK', onPress: () => router.replace('/(app)/clients' as never) }],
      );
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21}/></Pressable>
        <View style={styles.titleWrap}><Text style={styles.eyebrow}>CLIENT PORTAL</Text><Text style={styles.title}>New Client</Text></View>
      </View>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Client information</Text>
        <Field label="Client name" value={clientName} onChangeText={setClientName} placeholder="Client or management company name" />
        <Field label="Phone number" value={phone} onChangeText={setPhone} placeholder="Phone number" keyboardType="phone-pad" />
        <Field label="Email address" value={email} onChangeText={setEmail} placeholder="Email address" keyboardType="email-address" autoCapitalize="none" />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Associated property</Text>
        <Field label="Property name · optional" value={propertyName} onChangeText={setPropertyName} placeholder="Example: Park Apartments" />
        <Field label="Street address" value={address} onChangeText={setAddress} placeholder="123 Main St" />
        <Field label="City" value={city} onChangeText={setCity} placeholder="City" />
        <View style={styles.row}>
          <View style={styles.flex}><Field label="State" value={region} onChangeText={setRegion} placeholder="MI" autoCapitalize="characters" /></View>
          <View style={styles.flex}><Field label="ZIP" value={postal} onChangeText={setPostal} placeholder="ZIP code" keyboardType="number-pad" /></View>
        </View>
      </Card>

      <Pressable disabled={busy} onPress={() => void submit()} style={[styles.primary, busy && styles.disabled]}>
        <Icon name="checkmark-circle-outline" color={colors.background} size={20}/>
        <Text style={styles.primaryText}>{busy ? 'Creating client…' : 'Create Client'}</Text>
      </Pressable>
    </ScrollView>
  );
}

function getErrorMessage(cause: unknown, fallback: string) {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (typeof cause === 'string' && cause.trim()) return cause;
  return fallback;
}

function Field(props: any) {
  const { label, ...inputProps } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput {...inputProps} placeholderTextColor={colors.subtle} style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flexGrow: 1, gap: spacing.md, padding: spacing.lg, paddingBottom: 110 },
  topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm },
  back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  titleWrap: { flex: 1, marginLeft: spacing.md },
  eyebrow: { color: colors.teal, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: colors.text, ...typography.title, marginTop: 3 },
  card: { gap: spacing.md, padding: spacing.md },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  field: { gap: 6 },
  label: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase' },
  input: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 12, borderWidth: 1, color: colors.text, minHeight: 50, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  primary: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 54 },
  primaryText: { color: colors.background, fontSize: 15, fontWeight: '900' },
  disabled: { opacity: 0.55 },
});
