import { clearAuthToken, getAuthToken, setAuthToken } from "./cloudSync";

export type SessionUser = {
  userId: string;
  displayName: string | null;
  dashboardAccess: boolean;
  isAdmin: boolean;
};

export type AdminUserRecord = {
  userId: string;
  displayName: string | null;
  dashboardAccess: boolean;
  isAdmin: boolean;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
};

export type AdminUserUpsertInput = {
  userId: string;
  displayName: string;
  password?: string;
  dashboardAccess: boolean;
  isAdmin: boolean;
  isActive: boolean;
};

export type AuthErrorCode = "invalid_credentials" | "login_failed";

export class AuthError extends Error {
  code: AuthErrorCode;

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AuthError";
    this.code = code;
  }
}

export async function login(username: string, password: string): Promise<SessionUser> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new AuthError(
      response.status === 401 ? "invalid_credentials" : "login_failed",
      `login failed: ${response.status}`,
    );
  }

  const payload = (await response.json()) as {
    token: string;
    user: SessionUser;
  };

  setAuthToken(payload.token);
  return payload.user;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = getAuthToken();
  if (!token) {
    return null;
  }

  const response = await fetch("/api/auth/me", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    clearAuthToken();
    return null;
  }

  if (!response.ok) {
    throw new Error(`me failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    user: SessionUser;
  };

  return payload.user;
}

export async function logout() {
  const token = getAuthToken();
  if (token) {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }).catch(() => undefined);
  }
  clearAuthToken();
}

function getRequiredAuthToken(): string {
  const token = getAuthToken();
  if (!token) {
    throw new Error("not authenticated");
  }
  return token;
}

export async function listAdminUsers(): Promise<AdminUserRecord[]> {
  const token = getRequiredAuthToken();
  const response = await fetch("/api/admin/users", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`list users failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    users: AdminUserRecord[];
  };

  return payload.users;
}

export async function createAdminUser(input: AdminUserUpsertInput): Promise<AdminUserRecord> {
  const token = getRequiredAuthToken();
  const response = await fetch("/api/admin/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`create user failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    user: AdminUserRecord;
  };

  return payload.user;
}

export async function updateAdminUser(userId: string, input: Omit<AdminUserUpsertInput, "userId">): Promise<AdminUserRecord> {
  const token = getRequiredAuthToken();
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`update user failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    user: AdminUserRecord;
  };

  return payload.user;
}

export async function deleteAdminUser(userId: string) {
  const token = getRequiredAuthToken();
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`delete user failed: ${response.status}`);
  }
}
