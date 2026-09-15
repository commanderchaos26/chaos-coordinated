import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../../src/components/FieldUI';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';

const INVITE_TIMEOUT_MS = 15000;

export default function InviteEmployeeScreen() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadMembership().then((m) => setCompanyId(m?.companyId ?? null)); }, []);

  const invite = async () => {
    if (busy) return;
    if (!companyId) return Alert.alert('Company not loaded');
    setBusy(true);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        supabase.functions.invoke('invite-employee', {
          body: {
            company_id: companyId,
            display_name: name.trim(),
            email: email.trim().toLowerCase(),
            roles: ['technician'],
            idempotency_key: Crypto.randomUUID(),
          },
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Invitation request timed out. Please try again.')), INVITE_TIMEOUT_MS);
        }),
      ]);
      const { data, error } = result;
      if (error) return Alert.alert('Invite failed', error.message);
      Alert.alert('Invitation sent', `Employee record created for ${data.email}.`, [{ text: 'OK', onPress: () => router.replace('/management') }]);
    } catch (error) {
      Alert.alert('Invite failed', error instanceof Error ? error.message : String(error));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setBusy(false);
    }
  };

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={styles.topbar}><Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21} /></Pressable><Text style={styles.topbarTitle}>New employee</Text><View style={styles.spacer} /></View><View style={styles.hero}><View style={styles.heroIcon}><Icon name="person-add-outline" color={colors.teal} size={25} /></View><Text style={styles.title}>Invite employee</Text><Text style={styles.subtitle}>Create a technician profile and send a secure invitation to join your field team.</Text></View><View style={styles.form}><Text style={styles.label}>Display name</Text><TextInput placeholder="e.g. Jordan Lee" placeholderTextColor={colors.subtle} value={name} onChangeText={setName} style={styles.input} /><Text style={styles.label}>Work email</Text><TextInput placeholder="name@company.com" placeholderTextColor={colors.subtle} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} style={styles.input} /><View style={styles.roleRow}><Icon name="shield-checkmark-outline" color={colors.blue} size={18} /><View><Text style={styles.roleTitle}>Technician access</Text><Text style={styles.roleText}>They will start with the technician role.</Text></View></View><Pressable disabled={busy} onPress={invite} style={({ pressed }) => [styles.button, pressed && styles.pressed, busy && styles.disabled]}><Icon name="send-outline" color={colors.background} size={18} /><Text style={styles.buttonText}>{busy ? 'Sending invitation...' : 'Send invitation'}</Text></Pressable></View></KeyboardAvoidingView>;
}
const styles = StyleSheet.create({ root: { backgroundColor: colors.background, flex: 1, padding: spacing.lg }, topbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm }, back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 }, topbarTitle: { color: colors.text, fontSize: 15, fontWeight: '800' }, spacer: { width: 42 }, hero: { alignItems: 'center', marginTop: spacing.xxl }, heroIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 58, justifyContent: 'center', width: 58 }, title: { color: colors.text, ...typography.title, marginTop: spacing.lg }, subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm, maxWidth: 320, textAlign: 'center' }, form: { gap: spacing.sm, marginTop: spacing.xxl }, label: { color: colors.muted, fontSize: 12, fontWeight: '800', marginTop: spacing.sm }, input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, color: colors.text, fontSize: 15, minHeight: 54, paddingHorizontal: spacing.md }, roleRow: { alignItems: 'center', backgroundColor: colors.blueDeep, borderRadius: 14, flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, padding: spacing.md }, roleTitle: { color: colors.text, fontSize: 13, fontWeight: '800' }, roleText: { color: colors.muted, fontSize: 12, marginTop: 3 }, button: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.md, minHeight: 56 }, buttonText: { color: colors.background, fontSize: 15, fontWeight: '800' }, pressed: { opacity: 0.78 }, disabled: { opacity: 0.55 } });
