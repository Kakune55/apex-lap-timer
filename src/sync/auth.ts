import { clearAuthToken, getAuthToken, setAuthToken } from "./cloudSync";

export type SessionUser = {
  userId: string;
  displayName: string | null;
};

export async function login(username: string, password: string): Promise<SessionUser> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error(response.status === 401 ? "invalid credentials" : `login failed: ${response.status}`);
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
