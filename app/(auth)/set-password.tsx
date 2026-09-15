import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../../src/components/FieldUI';
import { completeAdmission } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';

export default function SetPasswordScreen() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (password.length < 10) return Alert.alert('Password too short', 'Use at least 10 characters.');
    if (password !== confirm) return Alert.alert('Passwords do not match');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setBusy(false); return Alert.alert('Could not set password', error.message); }
    try { await completeAdmission(); } catch (e: any) { setBusy(false); return Alert.alert('Account link failed', e?.message ?? 'Try again.'); }
    setBusy(false);
    router.replace('/home');
  };

  return (
    <View style={styles.root}>
      <View style={styles.icon}><Icon name="lock-open-outline" color={colors.teal} size={25} /></View><Text style={styles.title}>Finish your account</Text><Text style={styles.subtitle}>Create a password to activate your Chaos Coordinated employee login.</Text><Text style={styles.label}>New password</Text><TextInput placeholder="At least 10 characters" placeholderTextColor={colors.subtle} secureTextEntry value={password} onChangeText={setPassword} style={styles.input} /><Text style={styles.label}>Confirm password</Text><TextInput placeholder="Repeat your password" placeholderTextColor={colors.subtle} secureTextEntry value={confirm} onChangeText={setConfirm} style={styles.input} /><Pressable onPress={save} disabled={busy} style={({ pressed }) => [styles.button, pressed && styles.pressed, busy && styles.disabled]}><Text style={styles.buttonText}>{busy ? 'Activating...' : 'Activate account'}</Text><Icon name="arrow-forward" color={colors.background} size={19} /></Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl }, icon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 58, justifyContent: 'center', marginBottom: spacing.lg, width: 58 }, title: { color: colors.text, ...typography.title }, subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: spacing.sm, marginBottom: spacing.lg }, label: { color: colors.muted, fontSize: 12, fontWeight: '800', marginTop: spacing.sm, marginBottom: spacing.xs }, input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, color: colors.text, fontSize: 15, minHeight: 56, paddingHorizontal: spacing.md }, button: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.lg, minHeight: 56 }, buttonText: { color: colors.background, fontWeight: '800' }, pressed: { opacity: 0.78 }, disabled: { opacity: 0.55 },
});
