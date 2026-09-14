import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { completeAdmission } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';

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
      <Text style={styles.title}>Finish your account</Text>
      <Text>Create a password to activate your Chaos Coordinated employee login.</Text>
      <TextInput placeholder="New password" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} />
      <TextInput placeholder="Confirm password" secureTextEntry value={confirm} onChangeText={setConfirm} style={styles.input} />
      <Pressable onPress={save} disabled={busy} style={styles.button}><Text style={styles.buttonText}>{busy ? 'Activating…' : 'Activate account'}</Text></Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  title: { fontSize: 28, fontWeight: '800' },
  input: { borderWidth: 1, borderColor: '#777', borderRadius: 12, padding: 14 },
  button: { backgroundColor: '#111', padding: 15, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
});
