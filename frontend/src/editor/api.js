import { supabase } from '../supabase';
import { apiErrorMessage } from './apiErrors';

export async function editorRequest(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in to edit this clip.');
  const response = await fetch(path, { ...options, headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...options.headers,
  } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(apiErrorMessage(result, response.status));
    error.status = response.status;
    throw error;
  }
  return result;
}
