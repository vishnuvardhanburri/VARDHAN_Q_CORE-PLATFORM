import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  clearToken,
  getToken,
  getStoredOrg,
  login as apiLogin,
  logout as apiLogout,
  getOperatorProfile,
  onSessionInvalid,
  storeOrg,
  storeToken,
  verifyMfa,
  ApiError,
} from '../services/qcore';

export interface AuthUser {
  username: string;
  role: 'admin' | 'customer';
  organizationId?: string;
  organizationName?: string;
}

export interface CustomerAccount {
  id: string;
  username: string;
  orgId: string;
  orgName: string;
  planId: string;
  createdAtMs: number;
}

const DEFAULT_CUSTOMERS: CustomerAccount[] = [];

export function getProvisionedCustomers(): CustomerAccount[] {
  try {
    const raw = sessionStorage.getItem('vardhan_provisioned_customers');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveProvisionedCustomer(cust: CustomerAccount): void {
  const current = getProvisionedCustomers();
  const filtered = current.filter(
    (c) => c.username.toLowerCase() !== cust.username.toLowerCase() && c.orgId !== cust.orgId
  );
  filtered.unshift(cust);
  try {
    sessionStorage.setItem('vardhan_provisioned_customers', JSON.stringify(filtered));
  } catch {}
}

interface AuthState {
  user: AuthUser | null;
  booted: boolean;
  authBusy: boolean;
  authError: string | null;
  mfaChallenge: { challengeId: string; expiresAtMs: number } | null;
  orgId: string | null;
  signIn: (username: string, password: string, portalMode?: 'admin' | 'customer') => Promise<'authenticated' | 'mfa_required'>;
  confirmMfa: (code: string) => Promise<void>;
  cancelMfa: () => void;
  signOut: () => Promise<void>;
  selectOrg: (orgId: string | null) => void;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [booted, setBooted] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [mfaChallenge, setMfaChallenge] = useState<{ challengeId: string; expiresAtMs: number } | null>(null);
  const [orgId, setOrgId] = useState<string | null>(() => getStoredOrg());

  const signOutLocal = useCallback(() => {
    clearToken();
    try {
      sessionStorage.removeItem('vardhan_user_role');
      sessionStorage.removeItem('vardhan_user_profile');
    } catch {}
    setUser(null);
    setMfaChallenge(null);
  }, []);

  useEffect(() => {
    onSessionInvalid(() => {
      setUser(null);
      setMfaChallenge(null);
      setAuthError('Session expired or revoked — sign in again.');
    });

    let cancelled = false;
    async function boot(): Promise<void> {
      if (!getToken()) {
        setBooted(true);
        return;
      }
      try {
        const profile = await getOperatorProfile();
        const role: 'admin' | 'customer' = profile.role === 'admin' ? 'admin' : 'customer';
        const customers = getProvisionedCustomers();
        const match = customers.find(c => c.username.toLowerCase() === profile.username.toLowerCase());
        const orgIdToUse = match?.orgId || getStoredOrg() || undefined;
        const orgNameToUse = match?.orgName || undefined;

        if (!cancelled) {
          const userObj: AuthUser = {
            username: profile.username,
            role,
            organizationId: orgIdToUse,
            organizationName: orgNameToUse,
          };
          setUser(userObj);
          if (orgIdToUse) {
            setOrgId(orgIdToUse);
            storeOrg(orgIdToUse);
          }
        }
      } catch {
        if (!cancelled) {
          clearToken();
          setUser(null);
        }
      } finally {
        if (!cancelled) setBooted(true);
      }
    }

    void boot();
    return () => {
      cancelled = true;
      onSessionInvalid(null);
    };
  }, []);

  const signIn = useCallback(
    async (
      username: string,
      password: string,
      portalMode?: 'admin' | 'customer'
    ): Promise<'authenticated' | 'mfa_required'> => {
      setAuthBusy(true);
      setAuthError(null);
      const cleanUsername = username.trim();

      try {
        const result = await apiLogin(cleanUsername, password);
        if (result.kind === 'mfa_required') {
          setMfaChallenge({ challengeId: result.challengeId, expiresAtMs: result.expiresAtMs });
          return 'mfa_required';
        }

        storeToken(result.token);
        const profile = await getOperatorProfile().catch(() => ({
          username: cleanUsername,
          role: cleanUsername.toLowerCase() === 'admin' ? 'admin' : 'customer',
          display_name: cleanUsername,
          email: '',
        }));

        const role: 'admin' | 'customer' = (profile.role === 'admin' || (cleanUsername.toLowerCase() === 'admin' && portalMode === 'admin')) ? 'admin' : 'customer';

        const customers = getProvisionedCustomers();
        const match = customers.find(
          (c) => c.username.toLowerCase() === cleanUsername.toLowerCase()
        );
        const customerOrgId = match?.orgId;
        const customerOrgName = match?.orgName;

        const authUser: AuthUser = {
          username: profile.username,
          role,
          organizationId: customerOrgId,
          organizationName: customerOrgName,
        };

        setUser(authUser);
        if (customerOrgId) {
          setOrgId(customerOrgId);
          storeOrg(customerOrgId);
        }
        try {
          sessionStorage.setItem('vardhan_user_role', role);
          sessionStorage.setItem('vardhan_user_profile', JSON.stringify(authUser));
        } catch {}

        return 'authenticated';
      } catch (err) {
        if (err instanceof ApiError) setAuthError(err.message);
        else if (err instanceof Error) setAuthError(err.message);
        else setAuthError('Sign-in failed.');
        throw err;
      } finally {
        setAuthBusy(false);
      }
    },
    []
  );

  const confirmMfa = useCallback(
    async (code: string): Promise<void> => {
      if (!mfaChallenge) return;
      setAuthBusy(true);
      setAuthError(null);
      try {
        const result = await verifyMfa(mfaChallenge.challengeId, code.trim());
        storeToken(result.token);
        setMfaChallenge(null);
        const profile = await getOperatorProfile().catch(() => ({
          username: 'admin',
          role: 'admin',
          display_name: 'Administrator',
          email: '',
        }));
        const adminUser: AuthUser = { username: profile.username, role: 'admin' };
        setUser(adminUser);
        try {
          sessionStorage.setItem('vardhan_user_role', 'admin');
          sessionStorage.setItem('vardhan_user_profile', JSON.stringify(adminUser));
        } catch {}
      } catch (err) {
        if (err instanceof ApiError) setAuthError(err.message);
        else setAuthError('MFA verification failed.');
        throw err;
      } finally {
        setAuthBusy(false);
      }
    },
    [mfaChallenge]
  );

  const cancelMfa = useCallback(() => {
    setMfaChallenge(null);
    clearToken();
    setAuthError(null);
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await apiLogout();
    } catch {
      // safe fallback
    } finally {
      signOutLocal();
    }
  }, [signOutLocal]);

  const selectOrg = useCallback((id: string | null) => {
    setOrgId(id);
    if (id) storeOrg(id);
  }, []);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      booted,
      authBusy,
      authError,
      mfaChallenge,
      orgId,
      signIn,
      confirmMfa,
      cancelMfa,
      signOut,
      selectOrg,
      clearAuthError,
    }),
    [
      user,
      booted,
      authBusy,
      authError,
      mfaChallenge,
      orgId,
      signIn,
      confirmMfa,
      cancelMfa,
      signOut,
      selectOrg,
      clearAuthError,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
