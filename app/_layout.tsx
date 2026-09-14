import { Stack } from 'expo-router';
import { AuthProvider } from '../src/context/AuthProvider';

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </AuthProvider>
  );
}
