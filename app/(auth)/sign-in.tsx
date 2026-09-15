import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../../src/components/FieldUI';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return Alert.alert('Sign-in failed', error.message);
    router.replace('/home');
  };

  return (
    <View style={styles.root}>
      <View style={styles.brand}><View style={styles.brandMark}><Icon name="radio-outline" color={colors.teal} size={27} /></View><Text style={styles.eyebrow}>FIELD OPERATIONS</Text></View>
      <Text style={styles.title}>Chaos{`\n`}Coordinated</Text>
      <Text style={styles.subtitle}>A clear view of the work, people, and handoffs keeping your operation moving.</Text>
      <View style={styles.form}><Text style={styles.label}>Work email</Text><TextInput autoCapitalize="none" keyboardType="email-address" placeholder="name@company.com" placeholderTextColor={colors.subtle} value={email} onChangeText={setEmail} style={styles.input} /><Text style={styles.label}>Password</Text><TextInput placeholder="Enter your password" placeholderTextColor={colors.subtle} value={password} onChangeText={setPassword} secureTextEntry style={styles.input} /><Pressable disabled={busy} onPress={signIn} style={({ pressed }) => [styles.button, pressed && styles.pressed, busy && styles.disabled]}><Text style={styles.buttonText}>{busy ? 'Signing in...' : 'Sign in'}</Text><Icon name="arrow-forward" color={colors.background} size={19} /></Pressable></View>
      <Text style={styles.note}>Accounts are created by management. Public sign-up is disabled.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl }, brand: { alignItems: 'center', marginBottom: spacing.xxl }, brandMark: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 64, justifyContent: 'center', marginBottom: spacing.md, width: 64 }, eyebrow: { color: colors.teal, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 }, title: { color: colors.text, ...typography.title, fontSize: 36, lineHeight: 39, textAlign: 'center' }, subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: spacing.md, textAlign: 'center' }, form: { gap: spacing.sm, marginTop: spacing.xxl }, label: { color: colors.muted, fontSize: 12, fontWeight: '800', marginTop: spacing.sm }, input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, color: colors.text, fontSize: 15, minHeight: 56, paddingHorizontal: spacing.md }, button: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 14, flexDirection: 'row', justifyContent: 'center', minHeight: 56, marginTop: spacing.md, gap: spacing.sm }, buttonText: { color: colors.background, fontSize: 15, fontWeight: '800' }, note: { color: colors.subtle, fontSize: 12, lineHeight: 18, marginTop: spacing.xl, textAlign: 'center' }, pressed: { opacity: 0.78 }, disabled: { opacity: 0.55 },
});
