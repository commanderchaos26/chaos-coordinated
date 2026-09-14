import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { loadMembership } from '../../src/lib/membership';
import type { Membership } from '../../src/types/app';

export default function ManagementScreen() {
  const [m, setM] = useState<Membership | null>(null);
  useEffect(() => { loadMembership().then(setM); }, []);
  const canManage = m?.roles.some((r) => r === 'owner' || r === 'operations_manager');
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Management Center</Text>
      <Text>People, crews, permissions, dispatch controls, geofences, and operating configuration will be managed here.</Text>
      {canManage ? <Pressable style={styles.button} onPress={() => router.push('/invite-employee')}><Text style={styles.buttonText}>Invite employee</Text></Pressable> : <Text>You do not have management permissions.</Text>}
    </View>
  );
}
const styles = StyleSheet.create({ root: { flex: 1, padding: 20, gap: 16 }, title: { fontSize: 26, fontWeight: '800' }, button: { backgroundColor: '#111', padding: 14, borderRadius: 12, alignItems: 'center' }, buttonText: { color: '#fff', fontWeight: '700' } });
