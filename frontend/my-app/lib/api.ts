const API_BASE_URL = '/api';

// Custom error class for API errors
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class ApiClient {
  private baseURL: string;
  private token: string | null = null;
  private retryAttempts: number = 3;
  private retryDelay: number = 1000;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    // Get token from localStorage if available
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('authToken');
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    attempt: number = 1
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const headers = new Headers(options.headers as HeadersInit);
    headers.set('Content-Type', 'application/json');

    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        // Handle specific status codes
        switch (response.status) {
          case 401:
            // Token might be expired, clear it
            this.clearToken();
            throw new ApiError(401, 'Unauthorized. Please log in again.', 'UNAUTHORIZED');
          case 403:
            throw new ApiError(403, 'Access forbidden.', 'FORBIDDEN');
          case 404:
            throw new ApiError(404, 'Resource not found.', 'NOT_FOUND');
          case 429:
            throw new ApiError(429, 'Too many requests. Please try again later.', 'RATE_LIMITED');
          case 500:
            throw new ApiError(500, 'Internal server error. Please try again later.', 'SERVER_ERROR');
          default:
            throw new ApiError(
              response.status, 
              errorData.message || `HTTP error! status: ${response.status}`,
              errorData.code
            );
        }
      }

      return response.json();
    } catch (error) {
      // Retry on network errors or server errors (5xx)
      if (
        attempt < this.retryAttempts && 
        (error instanceof TypeError || 
         (error instanceof ApiError && error.status >= 500))
      ) {
        console.warn(`Request failed, retrying... (${attempt}/${this.retryAttempts})`);
        await this.delay(this.retryDelay * attempt); // Exponential backoff
        return this.request<T>(endpoint, options, attempt + 1);
      }
      
      // Re-throw the error if we've exhausted retries or it's a client error
      throw error;
    }
  }

  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('authToken', token);
    }
  }

  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('authToken');
    }
  }

  // Auth endpoints
  async login(email: string, password: string) {
    try {
      const response = await this.request<{ success: boolean; data: { user: any; accessToken: string; refreshToken: string } }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const token = response?.data?.accessToken;
      if (token) this.setToken(token);
      return response.data;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  async signup(name: string, email: string, password: string) {
    try {
      const response = await this.request<{ success: boolean; data: { user: any; accessToken: string; refreshToken: string } }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });
      const token = response?.data?.accessToken;
      if (token) this.setToken(token);
      return response.data;
    } catch (error) {
      console.error('Signup error:', error);
      throw error;
    }
  }

  async logout() {
    try {
      // Optionally call logout endpoint to invalidate token on server
      await this.request('/auth/logout', {
        method: 'POST',
      }).catch(() => {
        // Ignore errors during logout
      });
    } finally {
      this.clearToken();
    }
  }

  // Project endpoints
  async getProjects() {
    try {
      const response = await this.request<{ success: boolean; data: { projects: any[]; pagination: any } }>('/projects');
      return response.data.projects;
    } catch (error) {
      console.error('Get projects error:', error);
      throw error;
    }
  }

  async getPublicProjects() {
    try {
      const response = await this.request<{ success: boolean; data: { projects: any[]; pagination: any } }>('/projects/public');
      return response.data.projects;
    } catch (error) {
      console.error('Get public projects error:', error);
      throw error;
    }
  }

  async createProject(projectData: {
    name: string;
    description: string;
    programmingLanguage: string;
    isPublic?: boolean;
    fileTree?: any[];
  }) {
    try {
      const response = await this.request<{ success: boolean; data: { project: any } }>('/projects', {
        method: 'POST',
        body: JSON.stringify(projectData),
      });
      return response.data.project;
    } catch (error) {
      console.error('Create project error:', error);
      throw error;
    }
  }

  async getProject(id: string) {
    try {
      const response = await this.request<{ success: boolean; data: { project: any } }>(`/projects/${id}`);
      return response.data.project;
    } catch (error) {
      console.error('Get project error:', error);
      throw error;
    }
  }

  async updateProject(id: string, updates: any) {
    try {
      const response = await this.request<{ success: boolean; data: { project: any } }>(`/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      return response.data.project;
    } catch (error) {
      console.error('Update project error:', error);
      throw error;
    }
  }

  async deleteProject(id: string) {
    try {
      return await this.request<any>(`/projects/${id}`, {
        method: 'DELETE',
      });
    } catch (error) {
      console.error('Delete project error:', error);
      throw error;
    }
  }

  // File endpoints
  async getProjectFiles(projectId: string) {
    try {
      const response = await this.request<{ success: boolean; data: { files: any[] } }>(`/files/project/${projectId}`);
      return response.data.files;
    } catch (error) {
      console.error('Get project files error:', error);
      throw error;
    }
  }

  async createFile(fileData: {
    name: string;
    content?: string;
    project: string;
    parent?: string;
    isFolder?: boolean;
    type?: 'file' | 'folder';
  }) {
    try {
      const response = await this.request<{ success: boolean; data: { file: any } }>('/files', {
        method: 'POST',
        body: JSON.stringify(fileData),
      });
      return response.data.file;
    } catch (error) {
      console.error('Create file error:', error);
      throw error;
    }
  }

  async getFile(id: string) {
    try {
      const response = await this.request<{ success: boolean; data: { file: any } }>(`/files/${id}`);
      return response.data.file;
    } catch (error) {
      console.error('Get file error:', error);
      throw error;
    }
  }

  async updateFile(id: string, updates: { content?: string; name?: string }) {
    try {
      const response = await this.request<{ success: boolean; data: { file: any } }>(`/files/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      return response.data.file;
    } catch (error) {
      console.error('Update file error:', error);
      throw error;
    }
  }

  async deleteFile(id: string) {
    try {
      return await this.request<any>(`/files/${id}`, {
        method: 'DELETE',
      });
    } catch (error) {
      console.error('Delete file error:', error);
      throw error;
    }
  }

  async getFileContent(fileId: string) {
    try {
      return await this.request<any>(`/files/${fileId}/content`);
    } catch (error) {
      console.error('Get file content error:', error);
      throw error;
    }
  }

  // User endpoints
  async getCurrentUser() {
    try {
      const response = await this.request<{ success: boolean; data: { user: any } }>('/auth/me');
      return response.data.user;
    } catch (error) {
      console.error('Get current user error:', error);
      throw error;
    }
  }

  async updateProfile(updates: any) {
    try {
      return await this.request<any>('/users/me', {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
    } catch (error) {
      console.error('Update profile error:', error);
      throw error;
    }
  }
}

export const apiClient = new ApiClient(API_BASE_URL);
export default apiClient;
export { ApiError };