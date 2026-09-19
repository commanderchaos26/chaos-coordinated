import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BrandedIntro } from '../src/components/BrandedIntro';
import { AuthProvider } from '../src/context/AuthProvider';
import { colors } from '../src/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: 220, fade: true });

export default function RootLayout() {
  const [showIntro, setShowIntro] = useState(true);
  const nativeSplashHidden = useRef(false);

  const hideNativeSplash = useCallback(async () => {
    if (nativeSplashHidden.current) return;
    nativeSplashHidden.current = true;
    try {
      await SplashScreen.hideAsync();
    } catch {
      // A custom intro still covers the app if a platform has already hidden its native splash.
    }
  }, []);

  const finishIntro = useCallback(() => {
    setShowIntro(false);
  }, []);

  return (
    <AuthProvider>
      <View style={styles.root}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'fade',
          }}
        />
        {showIntro ? (
          <BrandedIntro onReady={hideNativeSplash} onComplete={finishIntro} />
        ) : null}
      </View>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
});
