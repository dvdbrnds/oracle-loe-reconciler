/**
 * Jira Cloud API Service
 * 
 * Handles all interactions with the Jira Cloud REST API.
 * Uses the newer /rest/api/3/search/jql endpoint for searching issues.
 */

import { config } from '../config.js';

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active: boolean;
}

export interface JiraIssue {
  key: string;
  id: string;
  fields: {
    summary: string;
    description?: any;
    status: {
      name: string;
      statusCategory: {
        name: string;
        key: string;
      };
    };
    priority?: {
      name: string;
    };
    issuetype: {
      name: string;
    };
    reporter?: JiraUser;
    assignee?: JiraUser;
    created: string;
    updated: string;
    // Custom fields - accessed dynamically
    [key: string]: any;
  };
}

export interface JiraSearchResponse {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast: boolean;
}

export interface JiraSyncResult {
  projectKey: string;
  ticketsSynced: number;
  ticketsCreated: number;
  ticketsUpdated: number;
  errors: string[];
}

class JiraService {
  private baseUrl: string;
  private authHeader: string;

  constructor() {
    this.baseUrl = config.jiraInstanceUrl || '';
    this.authHeader = this.createAuthHeader();
  }

  private createAuthHeader(): string {
    if (!config.jiraApiEmail || !config.jiraApiToken) {
      return '';
    }
    const credentials = `${config.jiraApiEmail}:${config.jiraApiToken}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  /**
   * Check if Jira is properly configured
   */
  isConfigured(): boolean {
    return !!(
      config.jiraInstanceUrl &&
      config.jiraApiEmail &&
      config.jiraApiToken &&
      !config.useMockData
    );
  }

  /**
   * Test the Jira connection by fetching the current user
   */
  async testConnection(): Promise<{ success: boolean; user?: JiraUser; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: 'Jira credentials not configured' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/rest/api/3/myself`, {
        headers: {
          'Authorization': this.authHeader,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const user = await response.json() as JiraUser;
      return { success: true, user };
    } catch (error) {
      return { success: false, error: `Connection failed: ${error}` };
    }
  }

  /**
   * Fetch all issues from a project with pagination
   */
  async fetchProjectIssues(projectKey: string): Promise<JiraIssue[]> {
    if (!this.isConfigured()) {
      throw new Error('Jira not configured');
    }

    const allIssues: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    const maxResults = 100;

    // Fields to fetch - standard + custom fields
    const fields = [
      'key',
      'summary',
      'description',
      'status',
      'priority',
      'issuetype',
      'reporter',
      'assignee',
      'created',
      'updated',
      config.jiraFieldApplication,
      config.jiraFieldModule,
      config.jiraFieldLoeHours,
    ].join(',');

    do {
      const url = new URL(`${this.baseUrl}/rest/api/3/search/jql`);
      url.searchParams.set('jql', `project = ${projectKey} ORDER BY updated DESC`);
      url.searchParams.set('maxResults', maxResults.toString());
      url.searchParams.set('fields', fields);
      
      if (nextPageToken) {
        url.searchParams.set('nextPageToken', nextPageToken);
      }

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': this.authHeader,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch issues for ${projectKey}: HTTP ${response.status} - ${errorText}`);
      }

      const data = await response.json() as JiraSearchResponse;
      allIssues.push(...data.issues);
      nextPageToken = data.nextPageToken;

      // Safety check - stop after 10000 issues
      if (allIssues.length >= 10000) {
        console.warn(`⚠️  Reached 10000 issue limit for project ${projectKey}`);
        break;
      }
    } while (nextPageToken);

    return allIssues;
  }

  /**
   * Extract the Application value from a Jira issue
   */
  extractApplication(issue: JiraIssue): string | null {
    const fieldValue = issue.fields[config.jiraFieldApplication];
    if (!fieldValue) return null;
    
    // Handle different field types
    if (typeof fieldValue === 'string') return fieldValue;
    if (fieldValue.value) return fieldValue.value;
    if (fieldValue.name) return fieldValue.name;
    
    return null;
  }

  /**
   * Extract the Module value from a Jira issue
   */
  extractModule(issue: JiraIssue): string | null {
    const fieldValue = issue.fields[config.jiraFieldModule];
    if (!fieldValue) return null;
    
    // Handle different field types
    if (typeof fieldValue === 'string') return fieldValue;
    if (fieldValue.value) return fieldValue.value;
    if (fieldValue.name) return fieldValue.name;
    
    return null;
  }

  /**
   * Extract the LOE Hours value from a Jira issue
   */
  extractLoeHours(issue: JiraIssue): number | null {
    const fieldValue = issue.fields[config.jiraFieldLoeHours];
    if (fieldValue === null || fieldValue === undefined) return null;
    
    // Handle numeric values
    if (typeof fieldValue === 'number') return fieldValue;
    if (typeof fieldValue === 'string') {
      const parsed = parseFloat(fieldValue);
      return isNaN(parsed) ? null : parsed;
    }
    
    return null;
  }

  /**
   * Map Application value to short code (e.g., "Human Capital Management (HCM)" -> "HCM")
   */
  mapApplicationToCode(applicationValue: string | null): string | null {
    if (!applicationValue) return null;
    
    const mappings: Record<string, string> = {
      'Human Capital Management (HCM)': 'HCM',
      'Enterprise Resource Planning (ERP)': 'ERP',
      'Enterprise Performance Management (EPM)': 'EPM',
      'Oracle Fusion Analytics Warehouse': 'FAW',
      'Student Financial Planning (SFP)': 'SFP',
      'Student Management Suite Cloud (STU)': 'STU',
      // Also handle if already short codes
      'HCM': 'HCM',
      'ERP': 'ERP',
      'EPM': 'EPM',
      'FAW': 'FAW',
      'SFP': 'SFP',
      'STU': 'STU',
    };

    // Check for exact match first
    if (mappings[applicationValue]) {
      return mappings[applicationValue];
    }

    // Check if the value contains any of the codes in parentheses
    const codeMatch = applicationValue.match(/\((\w+)\)/);
    if (codeMatch && ['HCM', 'ERP', 'EPM', 'FAW', 'SFP', 'STU'].includes(codeMatch[1])) {
      return codeMatch[1];
    }

    // Return null if no match found
    return null;
  }

  /**
   * Infer Application from ticket summary/module using keywords (fallback when field is empty)
   */
  inferApplicationFromKeywords(summary: string, module: string | null): string | null {
    const text = `${summary} ${module || ''}`.toLowerCase();

    // HCM keywords
    const hcmKeywords = [
      'hcm', 'payroll', 'hr', 'human capital', 'employee', 'absence', 'benefits',
      'compensation', 'talent', 'recruiting', 'workforce', 'time and labor',
      'person', 'worker', 'hire', 'termination', 'onboarding', 'offboarding',
      'performance review', 'goal', 'learning', 'wfm', 'workforce management'
    ];

    // ERP keywords  
    const erpKeywords = [
      'erp', 'finance', 'financial', 'gl', 'general ledger', 'ap', 'ar',
      'accounts payable', 'accounts receivable', 'procurement', 'purchasing',
      'invoice', 'payment', 'journal', 'budget', 'asset', 'fixed asset',
      'expense', 'supplier', 'vendor', 'po', 'purchase order', 'requisition',
      'cash management', 'bank', 'reconciliation', 'intercompany', 'ppm', 'project'
    ];

    // EPM keywords
    const epmKeywords = [
      'epm', 'planning', 'budgeting', 'forecasting', 'consolidation',
      'financial consolidation', 'close', 'narrative reporting', 'pbcs',
      'epbcs', 'fccs', 'arcs', 'account reconciliation', 'profitability'
    ];

    // STU keywords
    const stuKeywords = [
      'stu', 'student', 'campus', 'enrollment', 'admission', 'registrar',
      'course', 'academic', 'transcript', 'degree', 'graduation', 'financial aid'
    ];

    // SFP keywords
    const sfpKeywords = [
      'sfp', 'student financial', 'financial planning', 'tuition', 'billing'
    ];

    // FAW keywords
    const fawKeywords = [
      'faw', 'analytics', 'warehouse', 'otbi', 'bi', 'reporting', 'dashboard'
    ];

    // Check each category
    if (hcmKeywords.some(kw => text.includes(kw))) return 'HCM';
    if (erpKeywords.some(kw => text.includes(kw))) return 'ERP';
    if (epmKeywords.some(kw => text.includes(kw))) return 'EPM';
    if (stuKeywords.some(kw => text.includes(kw))) return 'STU';
    if (sfpKeywords.some(kw => text.includes(kw))) return 'SFP';
    if (fawKeywords.some(kw => text.includes(kw))) return 'FAW';

    return null;
  }

  /**
   * Transform a Jira issue into our database format
   */
  transformIssue(issue: JiraIssue): {
    key: string;
    project_key: string;
    summary: string;
    application: string | null;
    module: string | null;
    priority: string | null;
    status: string;
    loe_hours: number | null;
    reporter_email: string | null;
    reporter_name: string | null;
    assignee_email: string | null;
    assignee_name: string | null;
    jira_created_at: string;
    jira_updated_at: string;
  } {
    const applicationValue = this.extractApplication(issue);
    const module = this.extractModule(issue);
    
    // Try to get application code from Jira field first
    let applicationCode = this.mapApplicationToCode(applicationValue);
    
    // If no application from field, try keyword inference
    if (!applicationCode) {
      applicationCode = this.inferApplicationFromKeywords(issue.fields.summary, module);
    }

    return {
      key: issue.key,
      project_key: issue.key.split('-')[0],
      summary: issue.fields.summary,
      application: applicationCode,
      module: module,
      priority: issue.fields.priority?.name || null,
      status: issue.fields.status.name,
      loe_hours: this.extractLoeHours(issue),
      reporter_email: issue.fields.reporter?.emailAddress || null,
      reporter_name: issue.fields.reporter?.displayName || null,
      assignee_email: issue.fields.assignee?.emailAddress || null,
      assignee_name: issue.fields.assignee?.displayName || null,
      jira_created_at: issue.fields.created,
      jira_updated_at: issue.fields.updated,
    };
  }
}

export const jiraService = new JiraService();
