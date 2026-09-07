const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || '';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const apiService = {
  /**
   * Execute API request with JWT auth token (if available)
   * @param path - Path (e.g. "/channels/")
   * @param method - HTTP-Method (GET, POST, etc.)
   * @param api_url - The API URL (default: API_BASE_URL + '/api')
   * @param body - The request body (e.g. POST)
   * @returns A Promise with the parsed JSON response to class T
   */
  async request<T>(path: string, method: HttpMethod = 'GET', api_url: string = API_BASE_URL + '/api', body?: unknown): Promise<T> {
    try {
      const options: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
        } as Record<string, string>,
      };

      // Keep the admin JWT separate from HTTP Basic Auth's Authorization header.
      const token = localStorage.getItem('admin_token');
      if (token) {
        (options.headers as Record<string, string>)['X-Admin-Authorization'] = `Bearer ${token}`;
      }

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(`${api_url}${path}`, options);

      if (!response.ok) {
        let message = `Request failed with status ${response.status}`;
        try {
          const errorBody = (await response.json()) as { error?: string; message?: string };
          message = errorBody.error || errorBody.message || message;
        } catch {
          // Keep the status-based message when the response has no JSON body.
        }
        throw new ApiError(response.status, message);
      }

      const data = (await response.json()) as T;
      return data;
    } catch (error) {
      console.error(`Error in API request to ${api_url}${path}:`, error);
      throw error; 
    }
  },
};

export default apiService;
