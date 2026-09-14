import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../src/lib/supabase';

type Row = { id: string; title: string; status: string; priority: string; due_at: string | null };
export default function WorkOrdersScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { supabase.from('work_orders').select('id,title,status,priority,due_at').order('created_at', { ascending: false }).then(({ data }) => setRows((data ?? []) as Row[])); }, []);
  return <FlatList contentContainerStyle={styles.root} data={rows} keyExtractor={(x) => x.id} ListEmptyComponent={<Text>No work orders assigned yet.</Text>} renderItem={({ item }) => <View style={styles.card}><Text style={styles.title}>{item.title}</Text><Text>{item.priority} • {item.status}</Text></View>} />;
}
const styles = StyleSheet.create({ root: { padding: 16, gap: 12 }, card: { padding: 16, borderWidth: 1, borderColor: '#999', borderRadius: 14, marginBottom: 12 }, title: { fontWeight: '800', fontSize: 17 } });
