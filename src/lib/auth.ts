import { createClient } from './supabase/client';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'agent';
  avatar_url: string | null;
}

// Sign in with email and password
export async function signIn(email: string, password: string) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

// Sign out
export async function signOut() {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Get current session
export async function getSession() {
  const supabase = createClient();
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
}

// Get current user with role
export async function getCurrentUser(): Promise<AdminUser | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const { data, error } = await supabase
    .from('admin_users')
    .select('*')
    .eq('email', user.email)
    .single();

  if (error || !data) return null;
  return data as AdminUser;
}

// Check if user is admin
export async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return user?.role === 'admin';
}

// Get all admin users (admin only)
export async function getAdminUsers() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('admin_users')
    .select('*')
    .order('name');

  if (error) throw error;
  return data as AdminUser[];
}

// Create new admin user (admin only)
export async function createAdminUser(user: {
  email: string;
  password: string;
  name: string;
  role: 'admin' | 'agent';
}) {
  const supabase = createClient();

  // First create the auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });

  if (authError) throw authError;

  // Then create the admin_users record
  const { data, error } = await supabase
    .from('admin_users')
    .insert([{
      email: user.email,
      name: user.name,
      role: user.role,
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update admin user
export async function updateAdminUser(id: string, updates: Partial<AdminUser>) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('admin_users')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}
