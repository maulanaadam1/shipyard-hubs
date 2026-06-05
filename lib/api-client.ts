'use client';

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Initialize Supabase client
export const supabase = (supabaseUrl && supabaseAnonKey && supabaseUrl !== 'placeholder') 
    ? createClient(supabaseUrl, supabaseAnonKey) 
    : null;

// Helper to add auth headers to fetch requests
export const getHeaders = async () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    
    // Check if we use Supabase
    if (supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
            headers['Authorization'] = `Bearer ${session.access_token}`;
            return headers;
        }
    }

    // Fallback to local storage (for legacy or if supabase is not available)
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
};

class ApiQueryBuilder {
    table: string;
    action: string = 'GET';
    queryData?: any;
    params: URLSearchParams = new URLSearchParams();

    constructor(table: string) { 
       this.table = table; 
    }

    select(fields?: string) { 
       return this; 
    }
    
    order(col: string, opts?: any) { 
       this.params.set('order', col); 
       this.params.set('ascending', opts?.ascending ? 'true' : 'false'); 
       return this; 
    }
    
    eq(col: string, val: any) { 
       this.params.set(col, val.toString()); 
       return this; 
    }
    
    in(col: string, vals: any[]) { 
       this.params.set('in_col', col);
       this.params.set('in', vals.join(',')); 
       return this; 
    }
    
    insert(data: any) { 
       this.action = 'POST'; 
       this.queryData = data; 
       return this; 
    }
    
    update(data: any) { 
       this.action = 'PUT'; 
       this.queryData = data; 
       return this; 
    }
    
    delete() { 
       this.action = 'DELETE'; 
       return this; 
    }
    
    upsert(data: any, options?: any) { 
       this.action = 'POST'; 
       this.queryData = data; 
       this.params.set('upsert', 'true'); 
       if (options?.onConflict) this.params.set('onConflict', options.onConflict);
       return this; 
    }

    async then<TResult1 = any, TResult2 = never>(
        resolve?: ((value: any) => TResult1 | PromiseLike<TResult1>) | undefined | null,
        reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
    ): Promise<TResult1 | TResult2> {
        const url_base = `/api/data/${this.table}`;
        const qs = this.params.toString();
        const url = qs ? `${url_base}?${qs}` : url_base;

        try {
            const headers = await getHeaders();
            const response = await fetch(url, {
                method: this.action,
                headers: headers,
                body: this.queryData ? JSON.stringify(this.queryData) : undefined
            });

            const text = await response.text();
            let result: any = {};
            try {
                result = text ? JSON.parse(text) : {};
            } catch (parseErr) {
                if (!response.ok) {
                    return Promise.resolve({ data: null, error: { message: `Server error (${response.status}): ${text || 'Unknown error'}` } }).then(resolve, reject);
                }
                result = {};
            }

            if (!response.ok) {
                return Promise.resolve({ data: null, error: { message: result.error || `Server error (${response.status})` } }).then(resolve, reject);
            }

            return Promise.resolve({ data: result.data || null, error: null }).then(resolve, reject);
        } catch (e: any) {
            return Promise.resolve({ data: null, error: { message: e.message }}).then(resolve, reject);
        }
    }
}

export const api = {
    from: (table: string) => new ApiQueryBuilder(table),
    auth: {
        getSession: async () => {
            if (supabase) {
                const { data: { session }, error } = await supabase.auth.getSession();
                if (error) return { data: { session: null }, error };
                
                // Map Supabase session to our app's session format if needed
                if (session) {
                    return { 
                        data: { 
                            session: {
                                user: {
                                    id: session.user.id,
                                    email: session.user.email,
                                    name: session.user.user_metadata?.name || session.user.email?.split('@')[0],
                                    role: session.user.user_metadata?.role || 'Staff',
                                    avatar: session.user.user_metadata?.avatar_url
                                }
                            } 
                        }, 
                        error: null 
                    };
                }
                return { data: { session: null }, error: null };
            }

            // Fallback to local server session
            try {
                const headers = await getHeaders();
                const res = await fetch(`/api/auth/session`, { headers });
                const data = await res.json();
                return { data: { session: data.session }, error: null };
            } catch(e: any) {
                return { data: { session: null }, error: { message: e.message } };
            }
        },
        signInWithPassword: async ({ email, password }: any) => {
             if (supabase) {
                 const { data, error } = await supabase.auth.signInWithPassword({ email, password });
                 if (error) return { error: { message: error.message }, data: null };
                 return { data: { user: data.user }, error: null };
             }

             // Fallback to local server login
             try {
                const res = await fetch(`/api/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await res.json();
                if (data.error) return { error: { message: data.error }, data: null };
                
                localStorage.setItem('auth_token', data.token);
                return { data: { user: data.user }, error: null };
             } catch(e: any) {
                 return { error: { message: e.message }, data: null };
             }
        },
        signOut: async () => {
            if (supabase) {
                await supabase.auth.signOut();
            }
            localStorage.removeItem('auth_token');
            return { error: null };
        },
        signUp: async ({ email, password, options}: any) => {
            if (supabase) {
                const { data, error } = await supabase.auth.signUp({ email, password, options });
                return { data, error: error ? { message: error.message } : null };
            }
            return { data: null, error: { message: 'Signup requires Supabase configuration.' } };
        },
        signInWithOAuth: async ({ provider }: { provider: 'google' | 'github' }) => {
            if (supabase) {
                const { error } = await supabase.auth.signInWithOAuth({
                    provider,
                    options: {
                        redirectTo: window.location.origin
                    }
                });
                return { error: error ? { message: error.message } : null };
            }
            return { error: { message: 'OAuth requires Supabase configuration.' } };
        },
        onAuthStateChange: (callback: any) => {
            if (supabase) {
                const { data: { subscription } } = supabase.auth.onAuthStateChange(callback);
                return { data: { subscription } };
            }
            return { data: { subscription: { unsubscribe: () => {} } } };
        },
        resetPasswordForEmail: async (email: string) => { 
            if (supabase) {
                const { error } = await supabase.auth.resetPasswordForEmail(email);
                return { error: error ? { message: error.message } : null, data: null };
            }
            return { error: null, data: null };
        }
    },
    channel: (name: string) => ({
        on: (event: any, payload: any, callback: any) => ({
            subscribe: () => ({ unsubscribe: () => {} })
        })
    })
};

export const isConfigured = !!(supabaseUrl && supabaseAnonKey && supabaseUrl !== 'placeholder');
