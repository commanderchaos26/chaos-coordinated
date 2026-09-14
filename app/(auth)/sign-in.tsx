import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../../src/lib/supabase';

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
      <Text style={styles.title}>Chaos Coordinated</Text>
      <Text style={styles.subtitle}>Order can emerge without somebody directing every move.</Text>
      <TextInput autoCapitalize="none" keyboardType="email-address" placeholder="Work email" value={email} onChangeText={setEmail} style={styles.input} />
      <TextInput placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
      <Pressable disabled={busy} onPress={signIn} style={styles.button}><Text style={styles.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text></Pressable>
      <Text style={styles.note}>Accounts are created by management. Public sign-up is disabled.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  title: { fontSize: 34, fontWeight: '800' },
  subtitle: { fontSize: 16, opacity: 0.7, marginBottom: 18 },
  input: { borderWidth: 1, borderColor: '#777', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16 },
  button: { backgroundColor: '#111', padding: 15, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  note: { textAlign: 'center', opacity: 0.6, marginTop: 8 },
});
