"use client"

import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiClient } from './api';

interface User {
  _id: string;
  name: string;
  email: string;
  avatar?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signup: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function sanitizeToken(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Remove surrounding quotes if present
  const unquoted = trimmed.replace(/^"|"$/g, '');
  // Basic JWT shape check (header starts with eyJ)
  if (unquoted && unquoted.length > 20) return unquoted;
  return trimmed;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user is already logged in
    const checkAuth = async () => {
      try {
        const stored = sanitizeToken(localStorage.getItem('authToken'));
        if (stored) {
          setToken(stored);
          apiClient.setToken(stored);
          const userData = await apiClient.getCurrentUser();
          setUser(userData);
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        // Clear invalid token
        localStorage.removeItem('authToken');
        setToken(null);
        apiClient.clearToken();
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const data = await apiClient.login(email, password) as any;
      const accessToken = data?.accessToken;
      if (accessToken) {
        setToken(accessToken);
        apiClient.setToken(accessToken);
        localStorage.setItem('authToken', accessToken);
      }
      setUser(data?.user);
      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Login failed'
      };
    }
  };

  const signup = async (name: string, email: string, password: string) => {
    try {
      const data = await apiClient.signup(name, email, password) as any;
      const accessToken = data?.accessToken;
      if (accessToken) {
        setToken(accessToken);
        apiClient.setToken(accessToken);
        localStorage.setItem('authToken', accessToken);
      }
      setUser(data?.user);
      return { success: true };
    } catch (error) {
      console.error('Signup error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Signup failed' };
    }
  };

  const logout = () => {
    localStorage.removeItem('authToken');
    setToken(null);
    apiClient.logout();
    setUser(null);
  };

  const value = {
    user,
    token,
    loading,
    login,
    signup,
    logout,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}