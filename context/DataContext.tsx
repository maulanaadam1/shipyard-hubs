'use client';

import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';
import { api, supabase } from '@/lib/api-client';

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
  pic?: string;
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

export interface ReleaseItem {
  item_id: string;
  type: string;
  equipment_id: string;
  condition: string;
  alias?: string;
}

export interface ReleaseRecord {
  id: string;
  loan_id: string;
  release_no: string;
  date_released: string;
  released_by: string;
  received_by: string;
  items_released: string; // JSON string of ReleaseItem[]
  status: string;
  notes?: string;
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

export interface LocationMaster {
  id: string;
  name: string;
  size: string;
  description: string;
  status: 'Active' | 'Inactive';
  center_x?: number;
  center_y?: number;
  layout_id?: string;
}

export interface ServiceMaster {
  id: string;
  code: string;
  name: string;
  status: 'Active' | 'Inactive';
}

export interface EmployeeMaster {
  id: string;
  code: string;
  name: string;
  address: string;
  email: string;
  phone: string;
  mobile_phone: string;
  is_active: string;
  position: string;
  m_branch_id: number;
  m_department_id: number;
  m_city_id: number;
  type: string;
}

export interface DockStatusMaster {
  id: string;
  name: string;
  color: string;
  is_active: boolean;
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

export interface MShipType {
  id: number;
  code: string;
  name: string;
  code_type: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  modified_by?: string | null;
}

export interface Ship {
  id: number | string;
  code?: string;
  name?: string;
  loa?: string | number;
  deadweight?: string | number;
  m_ship_type_id?: number;
  created_by?: string | null;
  modified_by?: string | null;
  created_at?: string;
  updated_at?: string;
  breadth?: string | number;
  depth?: string | number;
  draft?: string | number;
  ship_flag?: string;
  register_port?: string;
  created_year?: string;
  IMO?: string | null;
  coefficient_block?: string | number;
  m_ship_type?: MShipType;
  
  // Legacy / Fallback fields
  type?: string;
  shipname?: string;
  company?: string;
  gt?: number;
  buid?: string;
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
  rotation?: number;
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
  locations: LocationMaster[];
  setLocations: React.Dispatch<React.SetStateAction<LocationMaster[]>>;
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
  isLoading: boolean;
  fetchData: (isInitial?: boolean) => Promise<void>;
  notifications: Notification[];
  markNotificationRead: (id: string) => Promise<void>;
  createNotification: (userId: string, title: string, message: string, type: string, link?: string) => Promise<void>;
  canAccess: (resource: string, action?: string) => boolean;
  dockStatuses: DockStatusMaster[];
  setDockStatuses: React.Dispatch<React.SetStateAction<DockStatusMaster[]>>;
  services: ServiceMaster[];
  setServices: React.Dispatch<React.SetStateAction<ServiceMaster[]>>;
  employees: EmployeeMaster[];
  setEmployees: React.Dispatch<React.SetStateAction<EmployeeMaster[]>>;
  syncCache: Record<string, any[]>;
  setSyncCache: React.Dispatch<React.SetStateAction<Record<string, any[]>>>;
  syncDates: Record<string, string>;
  setSyncDates: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

// --- Provider ---

// sessionUser maps the user of /api/auth/session or /api/auth/login to
// currentUser. Both answers carry roles and extra_roles, which canAccess (and
// so the menu) needs.
export function sessionUser(userData: any): User {
  return {
    id: userData.id || '',
    name: userData.name || userData.email?.split('@')[0] || 'Unknown',
    email: userData.email || '',
    username: userData.username || '',
    // Role comes directly from the Go JWT token — no env var lookup needed
    role: (userData.role || 'Staff') as 'Admin' | 'Manager' | 'Staff',
    jabatan: userData.jabatan || '',
    department: userData.department || '',
    branch: userData.branch || '',
    city: userData.city || '',
    roles: userData.roles || '',
    extra_roles: userData.extra_roles || '',
    avatar: userData.image || ''
  } as User;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [fleet, setFleet] = useState<Equipment[]>([]);
  const [loans, setLoans] = useState<LoanRequest[]>([]);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [locations, setLocations] = useState<LocationMaster[]>([]);
  const [ships, setShips] = useState<Ship[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workflows, setWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [dropdownConfigs, setDropdownConfigs] = useState<DropdownConfig[]>([]);
  const [rolesMaster, setRolesMaster] = useState<RoleMaster[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [releases, setReleases] = useState<ReleaseRecord[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [dockStatuses, setDockStatuses] = useState<DockStatusMaster[]>([]);
  const [services, setServices] = useState<ServiceMaster[]>([]);
  const [employees, setEmployees] = useState<EmployeeMaster[]>([]);
  const [syncCache, setSyncCache] = useState<Record<string, any[]>>({});
  const [syncDates, setSyncDates] = useState<Record<string, string>>({});
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [hasInitialLoaded, setHasInitialLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Ref to hold latest user ID — prevents stale closure inside fetchData useCallback
  const currentUserIdRef = React.useRef<string | null>(null);

  // Concurrent callers (StrictMode's double effects, login + refresh) share one
  // in-flight load instead of each downloading every master table again.
  const inFlightFetchRef = React.useRef<Promise<void> | null>(null);

  // Master tables load on first use instead of all at sign-in: a page that
  // reads `fleet` from useData() asks for the equipment table then. Once asked
  // for, a table is refreshed by every fetchData() like before.
  const masterTables = {
    fleet: [() => api.from('equipment').select('*').order('created_at', { ascending: false }), setFleet],
    loans: [() => api.from('loan_requests').select('*').order('date_created', { ascending: false }), setLoans],
    deployments: [() => api.from('deployment_records').select('*').order('create_date', { ascending: false }), setDeployments],
    users: [() => api.from('profiles').select('*'), setUsers],
    vendors: [() => api.from('vendors').select('*').order('vendor', { ascending: true }), setVendors],
    companies: [() => api.from('companies').select('*').order('company_name', { ascending: true }), setCompanies],
    locations: [() => api.from('master_locations').select('*'), setLocations],
    ships: [() => api.from('ships').select('*').order('shipname', { ascending: true }), setShips],
    projects: [() => api.from('projects').select('*').order('id_siaga', { ascending: false }), setProjects],
    dropdownConfigs: [() => api.from('dropdown_configs').select('*'), setDropdownConfigs],
    releases: [() => api.from('equipment_release').select('*').order('date_released', { ascending: false }), setReleases],
    workflows: [() => api.from('approval_workflow').select('*').order('step_order', { ascending: true }), setWorkflows],
    dockStatuses: [() => api.from('master_status_dock').select('*').order('name', { ascending: true }), setDockStatuses],
    services: [() => api.from('master_services').select('*'), setServices],
    employees: [() => api.from('master_employees').select('*'), setEmployees],
  } as const;
  type MasterTable = keyof typeof masterTables;
  const requestedTablesRef = React.useRef(new Set<MasterTable>());

  const loadTable = async (label: string, query: () => PromiseLike<any>, set: (rows: any) => void) => {
    try {
      const { data, error } = await query();
      if (error) {
        console.error(`Error fetching ${label}:`, error.message);
        return;
      }
      if (data) set(data);
    } catch (err) {
      console.error(`Error fetching ${label}:`, err);
    }
  };
  const loadMasterTable = (name: MasterTable) => {
    const [query, set] = masterTables[name];
    return loadTable(name, query, set as (rows: any) => void);
  };

  // Called while a page renders, so the request starts after the render.
  const requestTable = (name: MasterTable) => {
    if (requestedTablesRef.current.has(name)) return;
    requestedTablesRef.current.add(name);
    if (currentUserIdRef.current) queueMicrotask(() => { loadMasterTable(name); });
  };

  // --- Fetch Initial Data ---
  const fetchData = useCallback((isInitial = false): Promise<void> => {
    if (inFlightFetchRef.current) return inFlightFetchRef.current;
    const load = loadAllData(isInitial).finally(() => {
      inFlightFetchRef.current = null;
    });
    inFlightFetchRef.current = load;
    return load;
  }, []);

  const loadAllData = async (isInitial: boolean) => {
    // Check if we have a session token before fetching
    const localToken = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    let hasSession = !!localToken;
    if (!hasSession && supabase) {
      const { data: { session } } = await supabase.auth.getSession();
      hasSession = !!session?.access_token;
    }
    if (!hasSession) {
      console.log('No auth session found, skipping data fetch.');
      if (isInitial) {
        setIsLoading(false);
        setHasInitialLoaded(true);
      }
      return;
    }

    if (isInitial) setIsLoading(true);
    console.log('Starting data fetch from backend...');
    
    // Set a safety timeout to prevent infinite loading
    const timeoutId = setTimeout(() => {
      setIsLoading(false);
      setHasInitialLoaded(true);
      console.warn('Data fetch is taking longer than expected. Continuing with current state.');
    }, 7000);

    try {
      // RBAC Data (Need this for Sidebar/Menu and Role Management)
      const [rolesRes, permsRes] = await Promise.all([
        api.from('roles_master').select('*'),
        api.from('role_permissions').select('*')
      ]);
      if (rolesRes.data) setRolesMaster(rolesRes.data as RoleMaster[]);
      if (permsRes.data) setRolePermissions(permsRes.data as RolePermission[]);

      // Permissions are all the shell needs to render the menu and the current
      // page; the master tables below fill in as they arrive instead of holding
      // every page behind the loading screen.
      if (isInitial) {
        clearTimeout(timeoutId);
        setIsLoading(false);
      }

      // Priority 2: the header's notifications, and again every master table
      // a page has already asked for (a refresh after a save). Tables no page
      // has read yet stay unloaded until one does (see tableGetters below).
      const userId = currentUserIdRef.current;
      await Promise.all([
        userId
          ? loadTable('notifications', () => api.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }), setNotifications)
          : Promise.resolve(),
        ...[...requestedTablesRef.current].map(name => loadMasterTable(name)),
      ]);
    } catch (error) {
      console.error('Unexpected error during fetchData:', error);
    } finally {
      clearTimeout(timeoutId);
      setIsLoading(false);
      setHasInitialLoaded(true);
      console.log('Data fetch completed.');
    }
  };

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
  }, []);

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

          setCurrentUser(sessionUser(session.user));
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

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('mousemove', throttledUpdateActivity);
        window.removeEventListener('keydown', throttledUpdateActivity);
        window.removeEventListener('click', throttledUpdateActivity);
        window.removeEventListener('scroll', throttledUpdateActivity);
      }
    };
  }, []);

  // Load everything once per signed-in user. The ref is set first so the same
  // request also fetches that user's notifications (fixes stale closure in fetchData).
  useEffect(() => {
    currentUserIdRef.current = currentUser?.id ?? null;
    if (currentUser?.id) {
      fetchData(true); // shows the loading screen until the first load finishes
    }
  }, [currentUser?.id, fetchData]);


  if (!mounted) {
    return <div suppressHydrationWarning />;
  }

  return (
    <DataContext.Provider value={{
      // Reading one of these asks for its table (see requestTable).
      get fleet() { requestTable('fleet'); return fleet; }, setFleet,
      get loans() { requestTable('loans'); return loans; }, setLoans,
      get deployments() { requestTable('deployments'); return deployments; }, setDeployments,
      get users() { requestTable('users'); return users; }, setUsers,
      get vendors() { requestTable('vendors'); return vendors; }, setVendors,
      get companies() { requestTable('companies'); return companies; }, setCompanies,
      get locations() { requestTable('locations'); return locations; }, setLocations,
      get ships() { requestTable('ships'); return ships; }, setShips,
      get projects() { requestTable('projects'); return projects; }, setProjects,
      get dropdownConfigs() { requestTable('dropdownConfigs'); return dropdownConfigs; }, setDropdownConfigs,
      rolesMaster, setRolesMaster,
      rolePermissions, setRolePermissions,
      get releases() { requestTable('releases'); return releases; }, setReleases,
      get workflows() { requestTable('workflows'); return workflows; }, setWorkflows,
      get services() { requestTable('services'); return services; }, setServices,
      get employees() { requestTable('employees'); return employees; }, setEmployees,
      syncCache, setSyncCache,
      syncDates, setSyncDates,
      notifications, markNotificationRead, createNotification,
      currentUser, setCurrentUser,
      get dockStatuses() { requestTable('dockStatuses'); return dockStatuses; }, setDockStatuses,
      isLoading, fetchData,
      isAuthLoading,
      canAccess: (resource: string, action: string = 'view') => {
        if (!currentUser) return false;
        
        // Dashboard module is universally accessible to all logged-in users
        if (resource === 'Dashboard') return true;

        // Admin always has access
        if (currentUser.role === 'Admin') {
          // console.log(`RBAC [${resource}:${action}]: Allowed (Admin)`);
          return true;
        }

        // Check extra_roles override (e.g. "Dashboard:view" or "Dashboard")
        const extraRoles = currentUser.extra_roles?.split(',').map(r => r.trim()).filter(Boolean) || [];
        if (extraRoles.some(r => r === resource || r === `${resource}:${action}`)) {
          console.log(`RBAC [${resource}:${action}]: Allowed (Extra Role Override)`);
          return true;
        }

        // Check roles from rolesMaster and rolePermissions
        const userRoleNames = currentUser.roles?.split(',').map(r => r.trim()).filter(Boolean) || [];
        const userRoleIds = rolesMaster
          .filter(r => userRoleNames.includes(r.name))
          .map(r => r.id);

        const isAllowed = rolePermissions.some(p => 
          userRoleIds.includes(p.role_id) && 
          p.resource === resource && 
          (p.action === action || p.action === '*') &&
          (p.is_allowed === true || String(p.is_allowed) === 'true' || Number(p.is_allowed) === 1)
        );

        if (isAllowed) {
          // Find which role allowed it for debugging if needed
          const allowingPerm = rolePermissions.find(p => 
            userRoleIds.includes(p.role_id) && 
            p.resource === resource && 
            (p.action === action || p.action === '*') &&
            (p.is_allowed === true || String(p.is_allowed) === 'true' || Number(p.is_allowed) === 1)
          );
          const roleName = rolesMaster.find(r => r.id === allowingPerm?.role_id)?.name;
          console.log(`RBAC [${resource}:${action}]: Allowed via Role [${roleName}]`);
        } else {
          // console.log(`RBAC [${resource}:${action}]: Denied`);
        }

        return isAllowed;
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
