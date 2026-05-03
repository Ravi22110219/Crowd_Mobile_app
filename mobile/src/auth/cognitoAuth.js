import { fetchAuthSession, getCurrentUser, signIn, signOut } from 'aws-amplify/auth';

export async function adminSignIn(username, password) {
  const result = await signIn({ username, password });
  return result;
}

export async function adminSignOut() {
  await signOut();
}

export async function getSignedInAdmin() {
  try {
    return await getCurrentUser();
  } catch (error) {
    return null;
  }
}

export async function getAuthToken() {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error('Admin session expired. Please sign in again.');
  return token;
}
