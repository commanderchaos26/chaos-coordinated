import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';

export default function InviteEmployeeScreen() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadMembership().then((m) => setCompanyId(m?.companyId ?? null)); }, []);

  const invite = async () => {
    if (!companyId) return Alert.alert('Company not loaded');
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('invite-employee', {
      body: {
        company_id: companyId,
        display_name: name.trim(),
        email: email.trim().toLowerCase(),
        roles: ['technician'],
        idempotency_key: crypto.randomUUID(),
      },
    });
    setBusy(false);
    if (error) return Alert.alert('Invite failed', error.message);
    Alert.alert('Invitation sent', `Employee record created for ${data.email}.`);
    router.back();
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Invite employee</Text>
      <TextInput placeholder="Employee display name" value={name} onChangeText={setName} style={styles.input} />
      <TextInput placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} style={styles.input} />
      <Pressable disabled={busy} onPress={invite} style={styles.button}><Text style={styles.buttonText}>{busy ? 'Sending…' : 'Create employee + send invite'}</Text></Pressable>
    </View>
  );
}
const styles = StyleSheet.create({ root: { flex: 1, padding: 20, gap: 14 }, title: { fontSize: 26, fontWeight: '800' }, input: { borderWidth: 1, borderColor: '#777', borderRadius: 12, padding: 14 }, button: { backgroundColor: '#111', padding: 14, borderRadius: 12, alignItems: 'center' }, buttonText: { color: '#fff', fontWeight: '700' } });
