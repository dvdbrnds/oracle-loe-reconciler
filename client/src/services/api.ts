const API_BASE = '/api';

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  get<T>(endpoint: string): Promise<T> {
    return this.request<T>('GET', endpoint);
  }

  post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>('POST', endpoint, body);
  }

  put<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', endpoint, body);
  }

  delete<T>(endpoint: string): Promise<T> {
    return this.request<T>('DELETE', endpoint);
  }

  async uploadFile<T>(endpoint: string, file: File): Promise<T> {
    const formData = new FormData();
    formData.append('file', file);

    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }

    return response.json();
  }
}

export const api = new ApiClient();

// Type definitions for API responses
export interface BudgetOverview {
  period: { year: number | null; month: number | null; isAllTime?: boolean };
  allocatedHours: number;
  totalBurnt: number;
  remaining: number;
  adminOverhead: number;
  loeBreakdown?: {
    hoursWithLoe: number;
    hoursApprovedNoLoe: number;
    hoursUrgent: number;
    hoursUnapproved: number;
  };
  burnPercent: number;
  burnRate: number | null;
  projectedTotal: number | null;
  projectedExhaustionDay: number | null;
  isExhausted: boolean;
  status: 'green' | 'yellow' | 'orange' | 'red';
  useMockData: boolean;
}

export interface ApplicationBreakdown {
  period: { year: number; month: number };
  breakdown: Array<{
    application: string;
    application_name: string | null;
    hours_burnt: number;
    ticket_count: number;
  }>;
}

export interface Ticket {
  key: string;
  project_key: string;
  summary: string;
  application: string | null;
  module: string | null;
  priority: string | null;
  status: string;
  loe_hours: number | null;
  hours_burnt: number;
  has_compliance_issue: boolean;
  phase: string | null;
  project_name: string | null;
  application_name: string | null;
}

export interface TicketsResponse {
  tickets: Ticket[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
