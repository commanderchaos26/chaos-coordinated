import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../src/context/AuthProvider';

export default function AppLayout() {
  const { session, loading } = useAuth();
  if (!loading && !session) return <Redirect href="/sign-in" />;
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="work-orders" options={{ title: 'Work Orders' }} />
      <Tabs.Screen name="turnovers" options={{ title: 'Turnovers' }} />
      <Tabs.Screen name="management" options={{ title: 'Management' }} />
      <Tabs.Screen name="invite-employee" options={{ href: null, title: 'Invite Employee' }} />
    </Tabs>
  );
}
