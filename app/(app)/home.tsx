import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { useAuth } from '../../src/context/AuthProvider';
import { completeAdmission, loadMembership } from '../../src/lib/membership';
import type { Membership } from '../../src/types/app';

export default function HomeScreen() {
  const { signOut } = useAuth();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { await completeAdmission(); } catch {}
      try { setMembership(await loadMembership()); } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <LoadingScreen label="Loading your workspace…" />;

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.eyebrow}>{membership?.companyName ?? 'Chaos Coordinated'}</Text>
      <Text style={styles.title}>Welcome, {membership?.displayName ?? 'team member'}</Text>
      <Text style={styles.roles}>{membership?.roles.join(' • ') || 'No active roles found'}</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Today</Text>
        <Text>Assigned work, turnover handoffs, blockers, and action-required alerts will land here.</Text>
      </View>
      <Pressable onPress={signOut}><Text style={styles.signOut}>Sign out</Text></Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 20, gap: 16 },
  eyebrow: { opacity: 0.6, fontWeight: '700', textTransform: 'uppercase' },
  title: { fontSize: 28, fontWeight: '800' },
  roles: { opacity: 0.7 },
  card: { borderWidth: 1, borderColor: '#999', borderRadius: 16, padding: 18, gap: 8 },
  cardTitle: { fontSize: 20, fontWeight: '800' },
  signOut: { marginTop: 10, textDecorationLine: 'underline' },
});
