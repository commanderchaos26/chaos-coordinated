import { Redirect } from 'expo-router';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { useAuth } from '../src/context/AuthProvider';

export default function Index() {
  const { session, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  return <Redirect href={session ? '/home' : '/sign-in'} />;
}
