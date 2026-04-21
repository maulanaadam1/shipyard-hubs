'use client';

// Helper to add auth headers to fetch requests
const getHeaders = () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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
       this.params.set('id', val.toString()); 
       return this; 
    }
    
    in(col: string, vals: any[]) { 
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

    // Resolves standard Javascript `await` directly on `.select()`, `.insert()`, etc
    then<TResult1 = any, TResult2 = never>(
        resolve?: ((value: any) => TResult1 | PromiseLike<TResult1>) | undefined | null,
        reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
    ): Promise<TResult1 | TResult2> {
        return new Promise<any>(async (res) => {
            // Note: Use absolute URL for dev testing, or relative for prod
            let url = `/api/data/${this.table}`;
            if (process.env.NODE_ENV === 'development') {
                url = `http://localhost:3000${url}`;
            }
            
            const qs = this.params.toString();
            if (qs) url += `?${qs}`;

            try {
                const response = await fetch(url, {
                    method: this.action,
                    headers: getHeaders(),
                    body: this.queryData ? JSON.stringify(this.queryData) : undefined
                });
                const result = await response.json();
                res({ data: result.data || null, error: result.error ? { message: result.error } : null });
            } catch (e: any) {
                res({ data: null, error: { message: e.message }});
            }
        }).then(resolve, reject);
    }
}

export const api = {
    from: (table: string) => new ApiQueryBuilder(table),
    auth: {
        getSession: async () => {
            try {
                let url = `/api/auth/session`;
                if (process.env.NODE_ENV === 'development') url = `http://localhost:3000${url}`;
                
                const res = await fetch(url, { headers: getHeaders() });
                const data = await res.json();
                return { data: { session: data.session }, error: null };
            } catch(e: any) {
                return { data: { session: null }, error: { message: e.message } };
            }
        },
        signInWithPassword: async ({ email, password }: any) => {
             let url = `/api/auth/login`;
             if (process.env.NODE_ENV === 'development') url = `http://localhost:3000${url}`;
             
             try {
                const res = await fetch(url, {
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
            localStorage.removeItem('auth_token');
            // Trigger a hard reload to clear React state easily since 
            // we removed Next-auth's hook-based session manager
            typeof window !== 'undefined' ? window.location.href = '/' : null;
            return { error: null };
        },
        signUp: async ({ email, password}: any) => {
            return { data: null, error: { message: 'Signup disabled. Contact admin.' } };
        },
        onAuthStateChange: (callback: any) => {
            return { data: { subscription: { unsubscribe: () => {} } } };
        },
        resetPasswordForEmail: async (email: string) => { return { error: null, data: null } }
    },
    channel: (name: string) => ({
        on: (event: any, payload: any, callback: any) => ({
            subscribe: () => ({ unsubscribe: () => {} })
        })
    })
};

export const isConfigured = true;
