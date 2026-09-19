import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, EmptyState, Icon } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type ClientRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  property_id?: string | null;
  property_name?: string | null;
  address?: string | null;
};

export default function ClientsScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (!current) return;

      const { data: clients, error: clientError } = await supabase
        .from('clients')
        .select('id,name,phone,email,active')
        .eq('company_id', current.companyId)
        .eq('active', true)
        .order('name');
      if (clientError) throw clientError;

      const ids = (clients ?? []).map((item) => item.id);
      const { data: links, error: linkError } = ids.length
        ? await supabase
            .from('client_properties')
            .select('client_id,property_id,is_primary')
            .eq('company_id', current.companyId)
            .in('client_id', ids)
            .order('is_primary', { ascending: false })
        : { data: [], error: null };
      if (linkError) throw linkError;

      const propertyIds = [...new Set((links ?? []).map((item) => item.property_id))];
      const { data: properties, error: propertyError } = propertyIds.length
        ? await supabase
            .from('properties')
            .select('id,name,address_line1,city,region,postal_code')
            .in('id', propertyIds)
            .eq('active', true)
        : { data: [], error: null };
      if (propertyError) throw propertyError;

      const propertyMap = new Map((properties ?? []).map((item) => [item.id, item]));
      const firstProperty = new Map<string, any>();
      for (const link of links ?? []) {
        if (!propertyMap.has(link.property_id)) continue;
        if (!firstProperty.has(link.client_id)) firstProperty.set(link.client_id, link);
      }

      setRows((clients ?? []).map((client) => {
        const link = firstProperty.get(client.id);
        const property = link ? propertyMap.get(link.property_id) : null;
        return {
          ...client,
          property_id: property?.id ?? null,
          property_name: property?.name ?? null,
          address: property ? [property.address_line1, property.city, property.region, property.postal_code].filter(Boolean).join(', ') : null,
        };
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load clients.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const canManage = Boolean(membership?.roles.some((role) => ['owner','operations_manager'].includes(role)));

  if (loading && !membership) return <LoadingScreen label="Loading client portal..." />;

  return (
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21}/></Pressable>
        <View style={styles.titleWrap}><Text style={styles.eyebrow}>MANAGEMENT</Text><Text style={styles.title}>Client Portal</Text></View>
      </View>

      {canManage ? (
        <Pressable onPress={() => router.push('/(app)/new-client' as never)} style={styles.newClient}>
          <View style={styles.newIcon}><Icon name="person-add-outline" color={colors.background} size={25}/></View>
          <Text style={styles.newTitle}>New Client</Text>
          <Text style={styles.newText}>Add client contact information and the first property.</Text>
        </Pressable>
      ) : null}

      {error ? <Card style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></Card> : null}

      <Text style={styles.section}>CLIENTS</Text>
      {rows.length ? rows.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => router.push({ pathname: '/(app)/client-detail' as never, params: { clientId: item.id } })}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <Card style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.clientIcon}><Icon name="briefcase-outline" color={colors.teal} size={21}/></View>
              <View style={styles.cardCopy}>
                <Text style={styles.clientName}>{item.name}</Text>
                <Text style={styles.propertyName}>{item.property_name || 'No active property linked'}</Text>
              </View>
              <Icon name="chevron-forward" color={colors.subtle} size={20}/>
            </View>
            {item.address ? <Text style={styles.address}>{item.address}</Text> : null}
            <Text style={styles.contact}>{[item.phone, item.email].filter(Boolean).join(' · ') || 'No contact details entered'}</Text>
          </Card>
        </Pressable>
      )) : (
        <EmptyState icon="people-outline" title="No clients yet" message="Tap New Client to create the first client and property record." />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flexGrow: 1, gap: spacing.md, padding: spacing.lg, paddingBottom: 110 },
  topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm },
  back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  titleWrap: { flex: 1, marginLeft: spacing.md },
  eyebrow: { color: colors.teal, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: colors.text, ...typography.title, marginTop: 3 },
  newClient: { alignItems: 'center', backgroundColor: colors.tealDeep, borderColor: colors.teal, borderRadius: 20, borderWidth: 1, justifyContent: 'center', marginVertical: spacing.md, minHeight: 180, padding: spacing.xl },
  newIcon: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 999, height: 58, justifyContent: 'center', width: 58 },
  newTitle: { color: colors.text, fontSize: 23, fontWeight: '900', marginTop: spacing.md },
  newText: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: 'center' },
  section: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginTop: spacing.sm },
  card: { padding: spacing.md },
  cardTop: { alignItems: 'center', flexDirection: 'row' },
  clientIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 12, height: 44, justifyContent: 'center', width: 44 },
  cardCopy: { flex: 1, marginLeft: spacing.md },
  clientName: { color: colors.text, fontSize: 17, fontWeight: '900' },
  propertyName: { color: colors.teal, fontSize: 12, fontWeight: '800', marginTop: 3 },
  address: { color: colors.muted, fontSize: 12, marginTop: spacing.md },
  contact: { color: colors.subtle, fontSize: 11, marginTop: 5 },
  errorCard: { backgroundColor: colors.redDeep, padding: spacing.md },
  errorText: { color: colors.text },
  pressed: { opacity: 0.75 },
});
