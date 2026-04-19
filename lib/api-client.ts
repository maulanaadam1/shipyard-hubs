'use client';

import { signIn, signOut, getSession } from 'next-auth/react';

const restCall = async (method: string, table: string, body?: any, query?: string) => {
    let url = `/api/data/${table}`;
    if (query) url += `?${query}`;
    
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        const result = await res.json();
        return { data: result.data || null, error: result.error ? { message: result.error } : null };
    } catch (e: any) {
        return { data: null, error: { message: e.message } };
    }
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
    
    upsert(data: any) { 
       this.action = 'POST'; 
       this.queryData = data; 
       this.params.set('upsert', 'true'); 
       return this; 
    }

    // Resolves standard Javascript `await` directly on `.select()`, `.insert()`, etc
    async then(resolve: any, reject: any) {
        let url = `/api/data/${this.table}`;
        const qs = this.params.toString();
        if (qs) url += `?${qs}`;

        try {
            const res = await fetch(url, {
                method: this.action,
                headers: { 'Content-Type': 'application/json' },
                body: this.queryData ? JSON.stringify(this.queryData) : undefined
            });
            const result = await res.json();
            resolve({ data: result.data || null, error: result.error ? { message: result.error } : null });
        } catch (e: any) {
            resolve({ data: null, error: { message: e.message }});
        }
    }
}

export const api = {
    from: (table: string) => new ApiQueryBuilder(table),
    auth: {
        getSession: async () => {
            const session = await getSession();
            return { data: { session: session ? { user: session.user } : null }, error: null };
        },
        signInWithPassword: async ({ email, password }: any) => {
            const result = await signIn('credentials', { email, password, redirect: false });
            if (result?.error) return { error: { message: result.error }, data: null };
            return { data: { user: { email } }, error: null };
        },
        signOut: async () => {
            await signOut({ redirect: false });
            return { error: null };
        },
        signUp: async ({ email, password}: any) => {
           const res = await fetch('/api/auth/register', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ email, password })
           });
           const result = await res.json();
           return { data: { user: result.user }, error: result.error ? { message: result.error } : null };
        },
        onAuthStateChange: (callback: any) => {
            // NextAuth handles this automatically. We mock it for context.
            return { data: { subscription: { unsubscribe: () => {} } } };
        },
        resetPasswordForEmail: async (email: string) => { return { error: null } }
    },
    channel: (name: string) => ({
        on: (event: any, payload: any, callback: any) => ({
            subscribe: () => ({ unsubscribe: () => {} })
        })
    })
};

export const isConfigured = true;
