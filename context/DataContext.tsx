'use client';

import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

// --- Interfaces ---

export interface Equipment {
  id: string;
  created_at?: string;
  updated_at?: string;
  source: string;
  no_asset: string;
  type: string;
  brand: string;
  name: string;
  capacity: string;
  year_invest: string;
  available: string; // Used to be status
  alias: string;
  price: string;
}

export interface RequestedItem {
  type: string;
  quantity: number;
  deployedQuantity?: number;
}

export interface ApprovalStep {
  status: string;
  label: string;
  date?: string;
  comment?: string;
  user?: string;
  isCompleted: boolean;
  isCurrent: boolean;
}

export interface LoanRequest {
  id: string;
  date_created: string;
  request_id: string;
  project_id: string;
  shipname: string;
  vendor: string;
  work_order: string;
  date_start: string;
  date_finish: string;
  duration: number;
  lampiran: string;
  change: string;
  status: 'Draft' | 'Pending' | 'Approved' | 'Rejected' | 'Active' | 'Completed' | 'Deployed';
  items: RequestedItem[];
  approval_steps: ApprovalStep[];
}

export interface DeploymentRecord {
  unique_id: string;
  create_date: string;
  create_by: string;
  last_updated: string;
  request_id: string;
  year: number;
  month: number;
  item: string;
  product_id: string;
  product_name: string;
  code_project: string;
  project_name: string;
  shipname: string;
  vendor_list: string;
  vendor: string;
  start_date: string;
  finish_date: string;
  duration: number;
  duration_hour: number;
  return_date: string;
  return_status: string;
  description: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Manager' | 'Staff';
  avatar?: string;
}

export interface Vendor {
  id: string;
  vendor: string;
  nama_pt: string;
  whatapps: string;
  category: string;
  jumlah_anggota: number;
}

export interface Company {
  id: string;
  company_type: string;
  company_name: string;
}

export interface Ship {
  id: string;
  type: string;
  shipname: string;
  company: string;
  loa: number;
  breadth: number;
  depth: number;
  draft: number;
  gt: number;
  buid: string;
}

export interface Project {
  id: string;
  id_siaga?: number;
  create_date?: string;
  updated_at?: string;
  idproject: string;
  shipname?: string;
  cust_company?: string;
  approval_status?: string;
  m_employee_id?: string;
  est_start?: string;
  est_finish?: string;
  est_docking_date?: string;
  est_undocking_date?: string;
  est_trial_date?: string;
  est_arrival_date?: string;
  est_departure_date?: string;
  docking?: string;
  undocking?: string;
  act_arrival_date?: string;
  actual_start?: string;
  actual_finish?: string;
  act_trial_date?: string;
  act_departure_date?: string;
  no?: number;
  year?: number;
  company?: string;
  docking_id?: string;
  docking_type?: string;
  number_project?: string;
  type?: string;
  width?: number;
  length?: number;
  location?: string;
  x_coordinate?: number;
  y_coordinate?: number;
  status_dock?: string;
  ship_visibility?: string;
  ship_condition?: string;
  status?: string;
  status_comercial?: string;
  duration_dock?: number;
  duration_project?: number;
  project_lead?: string;
  price_contract?: number;
  cost_actual?: number;
  gross_profit?: number;
  safetyman?: string;
  project_team?: string;
  vendor_team?: string;
  manpower_all?: number;
  manpower_in?: number;
  manpower_ven?: number;
  update_pdf?: string;
  print?: string;
}

// --- Context Type ---

interface DataContextType {
  fleet: Equipment[];
  setFleet: React.Dispatch<React.SetStateAction<Equipment[]>>;
  loans: LoanRequest[];
  setLoans: React.Dispatch<React.SetStateAction<LoanRequest[]>>;
  deployments: DeploymentRecord[];
  setDeployments: React.Dispatch<React.SetStateAction<DeploymentRecord[]>>;
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  vendors: Vendor[];
  setVendors: React.Dispatch<React.SetStateAction<Vendor[]>>;
  companies: Company[];
  setCompanies: React.Dispatch<React.SetStateAction<Company[]>>;
  ships: Ship[];
  setShips: React.Dispatch<React.SetStateAction<Ship[]>>;
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  currentUser: User | null;
  setCurrentUser: React.Dispatch<React.SetStateAction<User | null>>;
  isAuthLoading: boolean;
  fetchData: (isInitial?: boolean) => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

// --- Provider ---

export function DataProvider({ children }: { children: ReactNode }) {
  const [fleet, setFleet] = useState<Equipment[]>([]);
  const [loans, setLoans] = useState<LoanRequest[]>([]);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [ships, setShips] = useState<Ship[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [hasInitialLoaded, setHasInitialLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);

  // --- Fetch Initial Data ---
  const fetchData = useCallback(async (isInitial = false) => {
    if (isInitial) setIsLoading(true);
    console.log('Starting data fetch from Supabase...');
    
    // Set a safety timeout to prevent infinite loading
    const timeoutId = setTimeout(() => {
      setIsLoading(false);
      setHasInitialLoaded(true);
      console.warn('Data fetch is taking longer than expected. Continuing with current state.');
    }, 7000);

    try {
      const results = await Promise.allSettled([
        api.from('equipment').select('*').order('created_at', { ascending: false }),
        api.from('loan_requests').select('*').order('date_created', { ascending: false }),
        api.from('deployment_records').select('*').order('create_date', { ascending: false }),
        api.from('profiles').select('*'),
        api.from('vendors').select('*').order('vendor', { ascending: true }),
        api.from('companies').select('*').order('company_name', { ascending: true }),
        api.from('ships').select('*').order('shipname', { ascending: true }),
        api.from('projects').select('*').order('create_date', { ascending: false })
      ]);

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const { data, error } = result.value;
          if (error) {
            console.error(`Error fetching table ${index}:`, error.message);
            return;
          }
          if (data) {
            if (index === 0) setFleet(data as Equipment[]);
            if (index === 1) setLoans(data as LoanRequest[]);
            if (index === 2) setDeployments(data as DeploymentRecord[]);
            if (index === 3) setUsers(data as User[]);
            if (index === 4) setVendors(data as Vendor[]);
            if (index === 5) setCompanies(data as Company[]);
            if (index === 6) setShips(data as Ship[]);
            if (index === 7) setProjects(data as Project[]);
          }
        } else {
          console.error(`Promise rejected for table ${index}:`, result.reason);
        }
      });
    } catch (error) {
      console.error('Unexpected error during fetchData:', error);
    } finally {
      clearTimeout(timeoutId);
      setIsLoading(false);
      setHasInitialLoaded(true);
      console.log('Data fetch completed.');
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    fetchData(true);

    const updateActivity = () => {
      localStorage.setItem('lastActivity', Date.now().toString());
    };

    // Throttle the activity update to avoid excessive writes
    let timeoutId: NodeJS.Timeout;
    const throttledUpdateActivity = () => {
      if (timeoutId) return;
      timeoutId = setTimeout(() => {
        updateActivity();
        timeoutId = undefined as any;
      }, 60000); // Only update once per minute max
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', throttledUpdateActivity);
      window.addEventListener('keydown', throttledUpdateActivity);
      window.addEventListener('click', throttledUpdateActivity);
      window.addEventListener('scroll', throttledUpdateActivity);
    }

    // --- Realtime Subscriptions ---
    const fleetSubscription = api.channel('fleet_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment' }, () => fetchData())
      .subscribe();

    const loansSubscription = api.channel('loans_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loan_requests' }, () => fetchData())
      .subscribe();

    const deploymentsSubscription = api.channel('deployments_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deployment_records' }, () => fetchData())
      .subscribe();

    const profilesSubscription = api.channel('profiles_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
        fetchData();
        if (payload.new && (payload.new as any).id) {
          setCurrentUser(prev => {
            if (prev && prev.id === (payload.new as any).id) {
              return {
                ...prev,
                name: (payload.new as any).name || prev.name,
                role: (payload.new as any).role || prev.role,
                avatar: (payload.new as any).avatar_url || prev.avatar
              };
            }
            return prev;
          });
        }
      })
      .subscribe();

    const vendorsSubscription = api.channel('vendors_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendors' }, () => fetchData())
      .subscribe();

    const companiesSubscription = api.channel('companies_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'companies' }, () => fetchData())
      .subscribe();

    const shipsSubscription = api.channel('ships_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ships' }, () => fetchData())
      .subscribe();

    const projectsSubscription = api.channel('projects_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => fetchData())
      .subscribe();

    // Safety timeout for auth loading
    const authTimeout = setTimeout(() => {
      setIsAuthLoading(false);
      console.warn('Auth check timed out. Continuing...');
    }, 5000);

    // Check initial session
    api.auth.getSession().then(({ data: { session }, error }) => {
      console.log('getSession Result:', { hasSession: !!session, error });
      if (!session || error) {
        clearTimeout(authTimeout);
        setIsAuthLoading(false);
      }
    }).catch((e) => {
      console.error('getSession Error:', e);
      clearTimeout(authTimeout);
      setIsAuthLoading(false);
    });

    // Listen for auth changes
    const fetchSession = async () => {
      const { data: sessionData } = await api.auth.getSession();
      const session = sessionData?.session;

      console.log('Session Extracted:', { hasSession: !!session, hasUser: !!session?.user });
      clearTimeout(authTimeout);
      
      // Idle Session Expiration Check
      if (session?.user && typeof window !== 'undefined') {
        const lastActivity = localStorage.getItem('lastActivity');
        const now = Date.now();
        const TWELVE_HOURS = 12 * 60 * 60 * 1000;
        
        if (lastActivity && ((now - parseInt(lastActivity)) > TWELVE_HOURS)) {
          // Session expired due to idle
          localStorage.removeItem('lastActivity');
          await api.auth.signOut();
          setCurrentUser(null);
          setIsAuthLoading(false);
          return;
        }
        localStorage.setItem('lastActivity', now.toString());

        const defaultAdminUsername = process.env.NEXT_PUBLIC_DEFAULT_ADMIN_USERNAME || 'superadmin';
        const isDefaultAdmin = session.user.email === process.env.NEXT_PUBLIC_DEFAULT_ADMIN_EMAIL || session.user.email === `${defaultAdminUsername}@shipyard.local`;
        
        // Use session details set by NextAuth directly
        let finalRole = 'Staff';
        if (isDefaultAdmin) finalRole = 'Admin';
        else if ((session.user as any)?.role) finalRole = (session.user as any).role;
        
        setCurrentUser({
          id: session.user.id || '',
          name: session.user.name || session.user.email?.split('@')[0] || 'Unknown',
          email: session.user.email || '',
          role: finalRole as 'Admin' | 'Manager' | 'Staff',
          avatar: session.user.image || ''
        });
      } else {
        setCurrentUser(null);
      }
      setIsAuthLoading(false);
    };

    fetchSession();

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('mousemove', throttledUpdateActivity);
        window.removeEventListener('keydown', throttledUpdateActivity);
        window.removeEventListener('click', throttledUpdateActivity);
        window.removeEventListener('scroll', throttledUpdateActivity);
      }
      fleetSubscription.unsubscribe();
      loansSubscription.unsubscribe();
      deploymentsSubscription.unsubscribe();
      profilesSubscription.unsubscribe();
      vendorsSubscription.unsubscribe();
      companiesSubscription.unsubscribe();
      shipsSubscription.unsubscribe();
      projectsSubscription.unsubscribe();
      authSubscription.unsubscribe();
    };
  }, [fetchData]);

  if (!mounted) {
    return <div suppressHydrationWarning />;
  }

  return (
    <DataContext.Provider value={{ 
      fleet, setFleet, 
      loans, setLoans, 
      deployments, setDeployments,
      users, setUsers,
      vendors, setVendors,
      companies, setCompanies,
      ships, setShips,
      projects, setProjects,
      currentUser, setCurrentUser,
      isAuthLoading,
      fetchData
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
}
