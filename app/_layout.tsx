import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BrandedIntro } from '../src/components/BrandedIntro';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../src/context/AuthProvider';
import { colors } from '../src/theme';

export default function RootLayout() {
  const [showIntro, setShowIntro] = useState(true);
  const finishIntro = useCallback(() => setShowIntro(false), []);

  useEffect(() => {
    if (!showIntro) return;
    // Fail open if layout, image loading, or animation never completes.
    const timeout = setTimeout(finishIntro, 6500);
    return () => clearTimeout(timeout);
  }, [finishIntro, showIntro]);

  return (
    <AuthProvider>
      <View style={styles.root}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: 'fade' }} />
        {showIntro && <BrandedIntro onComplete={finishIntro} />}
      </View>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
