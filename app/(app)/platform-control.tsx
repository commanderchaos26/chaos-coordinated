import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, Icon } from '../../src/components/FieldUI';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type CompanyState = {
  id: string;
  name: string;
  status: string;
  suspended_at?: string | null;
  suspension_reason?: string | null;
};

type TestAccount = {
  id: string;
  employee_id: string;
  email: string;
  label: string;
  active: boolean;
  created_at: string;
  retired_at?: string | null;
};

export default function PlatformControlScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [company, setCompany] = useState<CompanyState | null>(null);
  const [accounts, setAccounts] = useState<TestAccount[]>([]);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [reason, setReason] = useState('License/payment hold');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('QA Technician');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const current = await loadMembership();
    setMembership(current);
    if (!current) {
      setAuthorized(false);
      return;
    }

    const license = await supabase.functions.invoke('platform-license-control', {
      body: { action: 'status', company_id: current.companyId },
    });
    if (license.error || !license.data?.authorized) {
      setAuthorized(false);
      return;
    }

    setAuthorized(true);
    setCompany(license.data.company as CompanyState);

    const qa = await supabase.functions.invoke('platform-test-tools', {
      body: { action: 'status', company_id: current.companyId },
    });
    if (!qa.error) setAccounts((qa.data?.accounts ?? []) as TestAccount[]);
  };

  useEffect(() => { void load(); }, []);

  const setLicense = async (status: 'active' | 'suspended') => {
    if (!membership || busy) return;
    if (status === 'suspended' && !reason.trim()) {
      Alert.alert('Reason required', 'Enter a suspension reason first.');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('platform-license-control', {
        body: {
          action: 'set_status',
          company_id: membership.companyId,
          status,
          reason: status === 'suspended' ? reason.trim() : 'Reactivated by platform owner',
        },
      });
      if (error) throw error;
      setCompany(data.company as CompanyState);
      Alert.alert(status === 'suspended' ? 'Company suspended' : 'Company reactivated',
        status === 'suspended'
          ? 'Operational writes are blocked. Existing data remains intact and readable.'
          : 'Normal operational writes are enabled again.');
    } catch (cause) {
      Alert.alert('License update failed', cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const provision = async () => {
    if (!membership || busy) return;
    if (!email.trim() || password.length < 10) {
      Alert.alert('Test credentials required', 'Enter a test email and a password of at least 10 characters.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke('platform-test-tools', {
        body: {
          action: 'provision_technician',
          company_id: membership.companyId,
          email: email.trim().toLowerCase(),
          password,
          label: label.trim() || 'QA Technician',
        },
      });
      if (error) throw error;
      setPassword('');
      await load();
      Alert.alert('Test technician ready', 'Use the test email and password in a separate app session.');
    } catch (cause) {
      Alert.alert('Provision failed', cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const seedFlow = async (account: TestAccount) => {
    if (!membership || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('platform-test-tools', {
        body: { action: 'seed_flow', company_id: membership.companyId, test_account_id: account.id },
      });
      if (error) throw error;
      Alert.alert(
        data?.idempotent ? 'Test flow already exists' : 'Test flow created',
        'The QA technician now has an offered turnover work assignment under Today\'s work.',
      );
      await load();
    } catch (cause) {
      Alert.alert('Seed failed', cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const retire = async (account: TestAccount) => {
    if (!membership || busy) return;
    Alert.alert(
      'Retire test account?',
      'This disables the QA employee, cancels active QA artifacts, archives the QA property, and removes the test Auth login.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Retire',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const { error } = await supabase.functions.invoke('platform-test-tools', {
                body: { action: 'retire_account', company_id: membership.companyId, test_account_id: account.id },
              });
              if (error) throw error;
              await load();
              Alert.alert('Test account retired');
            } catch (cause) {
              Alert.alert('Retire failed', cause instanceof Error ? cause.message : String(cause));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  if (authorized === false) {
    return <View style={styles.center}><Icon name="lock-closed-outline" color={colors.amber} size={28} /><Text style={styles.title}>Platform owner access required</Text><Pressable onPress={() => router.back()} style={styles.secondary}><Text style={styles.secondaryText}>Back</Text></Pressable></View>;
  }

  return (
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <View style={styles.topbar}><Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21} /></Pressable><View style={styles.heading}><Text style={styles.eyebrow}>PRIVATE CONTROL</Text><Text style={styles.title}>Platform QA & license</Text></View></View>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Company license</Text>
        <Text style={styles.meta}>{company?.name ?? 'Loading...'}</Text>
        <Text style={styles.status}>Status: {(company?.status ?? 'loading').toUpperCase()}</Text>
        <Text style={styles.label}>Suspension reason</Text>
        <TextInput value={reason} onChangeText={setReason} placeholder="Reason shown in the app" placeholderTextColor={colors.subtle} style={styles.input} />
        <View style={styles.row}>
          <Pressable disabled={busy || company?.status === 'suspended'} onPress={() => void setLicense('suspended')} style={[styles.danger, (busy || company?.status === 'suspended') && styles.disabled]}><Text style={styles.dangerText}>Suspend</Text></Pressable>
          <Pressable disabled={busy || company?.status === 'active'} onPress={() => void setLicense('active')} style={[styles.primary, (busy || company?.status === 'active') && styles.disabled]}><Text style={styles.primaryText}>Reactivate</Text></Pressable>
        </View>
        <Text style={styles.note}>Suspension is non-destructive. Login/read access remains available; operational writes are blocked server-side.</Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>QA technician</Text>
        <Text style={styles.note}>Creates a technician-only login for end-to-end dispatch testing. Do not use a real employee email.</Text>
        <Text style={styles.label}>Label</Text>
        <TextInput value={label} onChangeText={setLabel} placeholder="QA Technician" placeholderTextColor={colors.subtle} style={styles.input} />
        <Text style={styles.label}>Test email</Text>
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="qa@example.com" placeholderTextColor={colors.subtle} style={styles.input} />
        <Text style={styles.label}>Test password</Text>
        <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 10 characters" placeholderTextColor={colors.subtle} style={styles.input} />
        <Pressable disabled={busy || company?.status !== 'active'} onPress={() => void provision()} style={[styles.primaryWide, (busy || company?.status !== 'active') && styles.disabled]}><Text style={styles.primaryText}>Create / reset QA technician</Text></Pressable>
      </Card>

      {accounts.map((account) => (
        <Card key={account.id} style={styles.card}>
          <Text style={styles.cardTitle}>{account.label}</Text>
          <Text style={styles.meta}>{account.email}</Text>
          <Text style={styles.status}>{account.active ? 'ACTIVE TEST ACCOUNT' : 'RETIRED'}</Text>
          {account.active ? <View style={styles.row}><Pressable disabled={busy || company?.status !== 'active'} onPress={() => void seedFlow(account)} style={[styles.primary, (busy || company?.status !== 'active') && styles.disabled]}><Text style={styles.primaryText}>Seed test turnover</Text></Pressable><Pressable disabled={busy || company?.status !== 'active'} onPress={() => void retire(account)} style={[styles.secondary, (busy || company?.status !== 'active') && styles.disabled]}><Text style={styles.secondaryText}>Retire</Text></Pressable></View> : null}
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, gap: spacing.lg, padding: spacing.lg, paddingBottom: 110 },
  center: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl },
  topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm },
  back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  heading: { marginLeft: spacing.md },
  eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colors.text, ...typography.title, marginTop: 3 },
  card: { padding: spacing.lg },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  meta: { color: colors.muted, fontSize: 13, marginTop: spacing.xs },
  status: { color: colors.tealBright, fontSize: 12, fontWeight: '900', letterSpacing: 0.5, marginTop: spacing.sm },
  label: { color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.md, textTransform: 'uppercase' },
  input: { backgroundColor: colors.surfaceSoft, borderColor: colors.border, borderRadius: 12, borderWidth: 1, color: colors.text, fontSize: 14, marginTop: spacing.xs, minHeight: 50, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  primary: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: spacing.md },
  primaryWide: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, justifyContent: 'center', marginTop: spacing.md, minHeight: 50, paddingHorizontal: spacing.md },
  primaryText: { color: colors.background, fontWeight: '900' },
  secondary: { alignItems: 'center', backgroundColor: colors.surfaceSoft, borderColor: colors.border, borderRadius: 12, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: spacing.md },
  secondaryText: { color: colors.text, fontWeight: '900' },
  danger: { alignItems: 'center', backgroundColor: colors.redDeep, borderColor: colors.red, borderRadius: 12, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: spacing.md },
  dangerText: { color: colors.text, fontWeight: '900' },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: spacing.md },
  disabled: { opacity: 0.45 },
});
