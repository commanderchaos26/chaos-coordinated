import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../src/lib/supabase';

type Turnover = { id: string; status: string; target_completion_at: string | null; unit_id: string };
export default function TurnoversScreen() {
  const [rows, setRows] = useState<Turnover[]>([]);
  useEffect(() => { supabase.from('turnovers').select('id,status,target_completion_at,unit_id').order('created_at', { ascending: false }).then(({ data }) => setRows((data ?? []) as Turnover[])); }, []);
  return <FlatList contentContainerStyle={styles.root} data={rows} keyExtractor={(x) => x.id} ListEmptyComponent={<Text>No turnovers visible yet.</Text>} renderItem={({ item }) => <View style={styles.card}><Text style={styles.title}>{item.status.replaceAll('_', ' ')}</Text><Text>Unit {item.unit_id.slice(0, 8)}…</Text></View>} />;
}
const styles = StyleSheet.create({ root: { padding: 16 }, card: { padding: 16, borderWidth: 1, borderColor: '#999', borderRadius: 14, marginBottom: 12 }, title: { fontWeight: '800', textTransform: 'capitalize' } });
