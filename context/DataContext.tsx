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
  id: string;
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
  jabatan?: string;
  user_id?: string;
  user_ids?: string; // JSON array string e.g. '["id1","id2"]'
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
  username?: string;
  role: 'Admin' | 'Manager' | 'Staff';
  jabatan?: string;
  city?: string;
  branch?: string;
  department?: string;
  whatsapp?: string;
  roles?: string;
  extra_roles?: string;
  avatar_url?: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  link?: string;
  is_read: boolean;
  created_at: string;
}

export interface RoleMaster {
  id: string;
  name: string;
  description: string;
}

export interface RolePermission {
  id: string;
  role_id: string;
  resource: string;
  action: string;
  is_allowed: boolean;
}

export interface Vendor {
  id: string;
  vendor: string;
  nama_pt: string;
  whatapps: string;
  category: string;
  jumlah_anggota: number;
  status: 'Active' | 'Inactive';
}

export interface Company {
  id: string;
  company_type: string;
  company_name: string;
  status: 'Active' | 'Inactive';
}

export interface ApprovalWorkflow {
  id: string;
  module: string;
  step_order: number;
  label: string;
  role: string;
  jabatan?: string;
  user_id?: string;
  user_ids?: string; // JSON array string e.g. '["id1","id2"]'
}

export interface DropdownConfig {
  id: string;
  category: string;
  label: string;
  value: string;
  is_active: boolean;
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
  setVendors: (vendors: Vendor[]) => void;
  dropdownConfigs: DropdownConfig[];
  setDropdownConfigs: (configs: DropdownConfig[]) => void;
  companies: Company[];
  setCompanies: React.Dispatch<React.SetStateAction<Company[]>>;
  ships: Ship[];
  setShips: React.Dispatch<React.SetStateAction<Ship[]>>;
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  workflows: ApprovalWorkflow[];
  setWorkflows: React.Dispatch<React.SetStateAction<ApprovalWorkflow[]>>;
  rolesMaster: RoleMaster[];
  setRolesMaster: React.Dispatch<React.SetStateAction<RoleMaster[]>>;
  rolePermissions: RolePermission[];
  setRolePermissions: React.Dispatch<React.SetStateAction<RolePermission[]>>;
  releases: ReleaseRecord[];
  setReleases: React.Dispatch<React.SetStateAction<ReleaseRecord[]>>;
  currentUser: User | null;
  setCurrentUser: React.Dispatch<React.SetStateAction<User | null>>;
  isAuthLoading: boolean;
  fetchData: (isInitial?: boolean) => Promise<void>;
  notifications: Notification[];
  markNotificationRead: (id: string) => Promise<void>;
  createNotification: (userId: string, title: string, message: string, type: string, link?: string) => Promise<void>;
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
  const [workflows, setWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [dropdownConfigs, setDropdownConfigs] = useState<DropdownConfig[]>([]);
  const [rolesMaster, setRolesMaster] = useState<RoleMaster[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [releases, setReleases] = useState<ReleaseRecord[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [hasInitialLoaded, setHasInitialLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Ref to hold latest user ID — prevents stale closure inside fetchData useCallback
  const currentUserIdRef = React.useRef<string | null>(null);

  // --- Fetch Initial Data ---
  const fetchData = useCallback(async (isInitial = false) => {
    // Check if we have a session token before fetching
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    if (!token) {
      console.log('No auth token found, skipping data fetch.');
      if (isInitial) {
        setIsLoading(false);
        setHasInitialLoaded(true);
      }
      return;
    }

    if (isInitial) setIsLoading(true);
    console.log('Starting data fetch from Supabase...');
    
    // Set a safety timeout to prevent infinite loading
    const timeoutId = setTimeout(() => {
      setIsLoading(false);
      setHasInitialLoaded(true);
      console.warn('Data fetch is taking longer than expected. Continuing with current state.');
    }, 7000);

    try {
      // Priority 1: RBAC Data (Need this for Sidebar/Menu)
      if (isInitial) {
        const [rolesRes, permsRes] = await Promise.all([
          api.from('roles_master').select('*'),
          api.from('role_permissions').select('*')
        ]);
        if (rolesRes.data) setRolesMaster(rolesRes.data as RoleMaster[]);
        if (permsRes.data) setRolePermissions(permsRes.data as RolePermission[]);
      }

      // Priority 2: Everything else
      const results = await Promise.allSettled([
        api.from('equipment').select('*').order('created_at', { ascending: false }),
        api.from('loan_requests').select('*').order('date_created', { ascending: false }),
        api.from('deployment_records').select('*').order('create_date', { ascending: false }),
        api.from('profiles').select('*'),
        api.from('vendors').select('*').order('vendor', { ascending: true }),
        api.from('companies').select('*').order('company_name', { ascending: true }),
        api.from('ships').select('*').order('shipname', { ascending: true }),
        api.from('projects').select('*').order('create_date', { ascending: false }),
        api.from('dropdown_configs').select('*'),
        api.from('equipment_release').select('*').order('date_released', { ascending: false }),
        api.from('approval_workflow').select('*').order('step_order', { ascending: true }),
        currentUserIdRef.current 
          ? api.from('notifications').select('*').eq('user_id', currentUserIdRef.current).order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null })
      ]);

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const { data, error } = result.value as any;
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
            if (index === 8) setDropdownConfigs(data as DropdownConfig[]);
            if (index === 9) setReleases(data as ReleaseRecord[]);
            if (index === 10) setWorkflows(data as ApprovalWorkflow[]);
            if (index === 11) setNotifications(data as Notification[]);
          }
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

  const markNotificationRead = async (id: string) => {
    try {
      await api.from('notifications').update({ is_read: true }).eq('id', id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  const createNotification = async (userId: string, title: string, message: string, type: string, link?: string) => {
    try {
      const id = Math.random().toString(16).substring(2, 10);
      await api.from('notifications').insert([{
        id,
        user_id: userId,
        title,
        message,
        type,
        link,
        is_read: false
      }]);
      // If the target user is the current user, update local state
      if (userId === currentUser?.id) {
        setNotifications(prev => [{
          id,
          user_id: userId,
          title,
          message,
          type,
          link,
          is_read: false,
          created_at: new Date().toISOString()
        }, ...prev]);
      }
    } catch (err) {
      console.error('Error creating notification:', err);
    }
  };

  useEffect(() => {
    setMounted(true);
    fetchData(true);
  }, []);

  // Fetch data immediately after login
  useEffect(() => {
    if (currentUser?.id) {
      console.log('User logged in: ' + currentUser.name + '. Fetching data...');
      fetchData(true); // Use true to show loading spinner during first fetch after login
    }
  }, [currentUser?.id, fetchData]);

  useEffect(() => {
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

    const fetchSession = async () => {
      try {
        const { data: sessionData } = await api.auth.getSession();
        const session = sessionData?.session;

        console.log('Session Extracted:', { hasSession: !!session, hasUser: !!session?.user });

        if (session?.user && typeof window !== 'undefined') {
          const lastActivity = localStorage.getItem('lastActivity');
          const now = Date.now();
          const TWELVE_HOURS = 12 * 60 * 60 * 1000;

          if (lastActivity && ((now - parseInt(lastActivity)) > TWELVE_HOURS)) {
            localStorage.removeItem('lastActivity');
            await api.auth.signOut();
            setCurrentUser(null);
            setIsAuthLoading(false);
            return;
          }
          localStorage.setItem('lastActivity', now.toString());

          // Role comes directly from the Go JWT token — no env var lookup needed
          const finalRole = (session.user as any)?.role || 'Staff';

          const userData = session.user as any;
          setCurrentUser({
            id: userData.id || '',
            name: userData.name || userData.email?.split('@')[0] || 'Unknown',
            email: userData.email || '',
            username: userData.username || '',
            role: finalRole as 'Admin' | 'Manager' | 'Staff',
            jabatan: userData.jabatan || '',
            department: userData.department || '',
            branch: userData.branch || '',
            city: userData.city || '',
            roles: userData.roles || '',
            extra_roles: userData.extra_roles || '',
            avatar: userData.image || ''
          });
        } else {
          setCurrentUser(null);
        }
      } catch (e) {
        console.error('fetchSession error:', e);
        setCurrentUser(null);
      } finally {
        setIsAuthLoading(false);
      }
    };

    fetchSession();

    // --- Auto-Polling for Data Sync (SQLite Real-time Workaround) ---
    // Since we use local SQLite, we pull fresh data every 3 seconds
    const pollInterval = setInterval(() => {
      if (currentUserIdRef.current) {
        fetchData(false);
      }
    }, 3000);

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('mousemove', throttledUpdateActivity);
        window.removeEventListener('keydown', throttledUpdateActivity);
        window.removeEventListener('click', throttledUpdateActivity);
        window.removeEventListener('scroll', throttledUpdateActivity);
      }
      clearInterval(pollInterval);
    };
  }, [fetchData, currentUser?.id]);

  // Sync ref and re-fetch whenever user logs in/out (fixes stale closure in fetchData)
  useEffect(() => {
    currentUserIdRef.current = currentUser?.id ?? null;
    if (currentUser?.id) {
      // Immediately fetch fresh data (including notifications) for this user
      fetchData(false);
    }
  }, [currentUser?.id, fetchData]);


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
      dropdownConfigs, setDropdownConfigs,
      rolesMaster, setRolesMaster,
      rolePermissions, setRolePermissions,
      releases, setReleases,
      workflows, setWorkflows,
      notifications, markNotificationRead, createNotification,
      currentUser, setCurrentUser,
      isLoading, fetchData,
      isAuthLoading,
      canAccess: (resource: string, action: string = 'view') => {
        if (!currentUser) return false;
        if (currentUser.role === 'Admin') return true;

        // Check extra_roles override (e.g. "Dashboard:view" or "Dashboard")
        const extraRoles = currentUser.extra_roles?.split(',').filter(Boolean) || [];
        if (extraRoles.some(r => r === resource || r === `${resource}:${action}`)) return true;

        // Check roles from rolesMaster and rolePermissions
        const userRoleNames = currentUser.roles?.split(',').filter(Boolean) || [];
        const userRoleIds = rolesMaster
          .filter(r => userRoleNames.includes(r.name))
          .map(r => r.id);

        return rolePermissions.some(p => 
          userRoleIds.includes(p.role_id) && 
          p.resource === resource && 
          (p.action === action || p.action === '*') &&
          p.is_allowed
        );
      }
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
