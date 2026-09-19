import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BrandMark } from '../../src/components/BrandMark';
import { Icon } from '../../src/components/FieldUI';
import { supabase } from '../../src/lib/supabase';
import { colors, radius, spacing } from '../../src/theme';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const signIn = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return Alert.alert('Sign-in failed', error.message);
    router.replace('/home');
  };

  return (
    <View style={styles.root}>
      <View style={[styles.blueprint, styles.blueprintTop]} />
      <View style={[styles.blueprint, styles.blueprintBottom]} />

      <View style={styles.brand}>
        <BrandMark size={78} />
        <Text style={styles.title}><Text style={styles.chaos}>Chaos </Text><Text style={styles.coordinated}>Coordinated</Text></Text>
        <Text style={styles.tagline}>ORDER OUT OF CHAOS.</Text>
        <Text style={styles.subtitle}>AI-driven turnover, work order, and workforce management.</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Work email</Text>
        <View style={styles.inputShell}>
          <Icon name="mail-outline" color={colors.subtle} size={19} />
          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="name@company.com"
            placeholderTextColor={colors.subtle}
            value={email}
            onChangeText={setEmail}
            style={styles.input}
          />
        </View>

        <Text style={styles.label}>Password</Text>
        <View style={styles.inputShell}>
          <Icon name="lock-closed-outline" color={colors.subtle} size={19} />
          <TextInput
            placeholder="Enter your password"
            placeholderTextColor={colors.subtle}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            style={styles.input}
          />
          <Pressable onPress={() => setShowPassword((value) => !value)} hitSlop={10}>
            <Icon name={showPassword ? 'eye-off-outline' : 'eye-outline'} color={colors.muted} size={20} />
          </Pressable>
        </View>

        <Pressable disabled={busy} onPress={signIn} style={({ pressed }) => [styles.button, pressed && styles.pressed, busy && styles.disabled]}>
          <Text style={styles.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
          <Icon name="arrow-forward" color={colors.background} size={19} />
        </Pressable>
      </View>

      <Text style={styles.note}>Accounts are created by management. Public sign-up is disabled.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flex: 1, justifyContent: 'center', overflow: 'hidden', padding: spacing.xl },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  title: { fontSize: 32, fontWeight: '900', letterSpacing: -1, marginTop: spacing.lg, textAlign: 'center' },
  chaos: { color: colors.text },
  coordinated: { color: colors.tealBright },
  tagline: { color: colors.text, fontSize: 11, fontWeight: '900', letterSpacing: 1.9, marginTop: spacing.xs },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm, maxWidth: 330, textAlign: 'center' },
  form: { gap: spacing.sm, width: '100%' },
  label: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.4, marginTop: spacing.xs, textTransform: 'uppercase' },
  inputShell: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', minHeight: 56, paddingHorizontal: spacing.md },
  input: { color: colors.text, flex: 1, fontSize: 15, minHeight: 54, paddingHorizontal: spacing.sm },
  button: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: radius.md, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.md, minHeight: 56 },
  buttonText: { color: colors.background, fontSize: 15, fontWeight: '900' },
  note: { color: colors.subtle, fontSize: 11, lineHeight: 17, marginTop: spacing.lg, textAlign: 'center' },
  blueprint: { backgroundColor: '#17303B', height: 1, opacity: 0.5, position: 'absolute', width: '150%' },
  blueprintTop: { top: '18%', transform: [{ rotate: '-9deg' }] },
  blueprintBottom: { bottom: '20%', transform: [{ rotate: '7deg' }] },
  pressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  disabled: { opacity: 0.55 },
});
