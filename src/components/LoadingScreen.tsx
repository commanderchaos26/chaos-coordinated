import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export function LoadingScreen({ label = 'Coordinating chaos…' }: { label?: string }) {
  return (
    <View style={styles.root}>
      <ActivityIndicator size="large" />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  label: { fontSize: 16, opacity: 0.75 },
});
