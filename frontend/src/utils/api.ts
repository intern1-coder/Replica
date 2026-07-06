import { API_BASE } from '../config';

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const token = localStorage.getItem('affinity_token');
  
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMessage = 'An error occurred';
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorData.error || errorMessage;
    } catch {
      // Not JSON
      errorMessage = await response.text();
    }

    if (response.status === 401 && token) {
      window.dispatchEvent(new CustomEvent('affinity:unauthorized'));
    }
    
    // Create a custom error object carrying the status code
    const error = new Error(errorMessage) as any;
    error.status = response.status;
    throw error;
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return null;
  }

  return response.json();
}
