# Product Requirements Document
## Vendor Hours Tracker Dashboard
### Open Source Edition

| Field | Value |
|-------|-------|
| **Document Version** | 1.0 Final |
| **Date** | January 28, 2026 |
| **Status** | Final |
| **Author** | David Brandes |
| **Reference Implementation** | Moravian University |

---

## 1. Executive Summary

This document outlines requirements for a Vendor Hours Tracker Dashboard designed for organizations managing fixed-hour vendor contracts across multiple application modules and project phases. The system consolidates burnt hours from vendor reports with Level of Effort (LOE) estimates from Jira, providing two-dimensional tracking, budget controls, and audit capabilities.

The solution is designed to be open source and configurable, enabling adoption by other organizations with similar vendor management needs.

---

## 2. Background & Context

### 2.1 Reference Implementation: Moravian University

Moravian University is implementing Oracle Cloud across multiple modules with a single vendor (Drivestream) providing implementation and support services under a shared monthly hour allocation of 100 hours.

#### Module Rollout Timeline

| Wave | Go-Live | Modules | Status |
|------|---------|---------|--------|
| Wave 1 | July 2025 | ERP, HCM | Live - Stabilization |
| Wave 2 | Feb 2026 | EPM | Go-Live Imminent |
| Wave 3 | 2027 | SFP (Student Financial Planning) | Pre-Planning |
| Wave 4 | 2028 | STU (Student Management Suite Cloud) | Pre-Planning |

### 2.2 Jira Project Structure

Work is organized by project phase. Each project contains tickets for multiple application modules.

| Key | Project Name | Phase | Lead |
|-----|--------------|-------|------|
| MOHEECI | Oracle HCM ERP EPM Cloud Implementation | Implementation | N. Bhatti |
| MOCSO | Oracle Cloud Stabilization | Stabilization | N. Bhatti |
| MOCS | Oracle Cloud Support | Support (AMS) | S. Ikkurthy |
| MOPT | HCM ERP EPM Optimization | Optimization | S. Shenbagaraman |
| MSPP | Oracle SMC Pre-Planning | Pre-Planning | S. Ramasubramani |

### 2.3 Two-Dimensional Tracking Model

The dashboard enables analysis by both Application (module) and Phase:

|  | Implementation | Stabilization | Support | Optimization |
|--|----------------|---------------|---------|--------------|
| **HCM** | MOHEECI | MOCSO | MOCS | MOPT |
| **ERP** | MOHEECI | MOCSO | MOCS | MOPT |
| **EPM** | MOHEECI | (coming) | (coming) | (coming) |
| **SFP** | MSPP | (2027) | (2027) | (2027) |
| **STU** | MSPP | (2028) | (2028) | (2028) |

---

## 3. Problem Statement

- No unified view across multiple Jira projects and application modules
- Cannot track budget consumption against fixed monthly allocation
- No enforcement mechanism when budget is exhausted
- Difficult to identify work performed without approved LOE
- Limited data for vendor discussions and dispute resolution
- Time-consuming manual reconciliation

---

## 4. Goals & Success Metrics

### 4.1 Primary Goals

1. Consolidate all Jira projects into unified dashboard
2. Enable two-dimensional analysis by Application and Phase
3. Enforce budget controls with Critical-only mode when exhausted
4. Flag compliance issues (unapproved LOE, budget overruns)
5. Provide audit trail for vendor discussions
6. Track LOE accuracy for continuous improvement

### 4.2 Success Metrics

- 100% of burnt hours captured within 24 hours of report delivery
- Real-time LOE sync from Jira (within 15 minutes)
- Zero hours burned on unapproved LOE without flagging
- 80% reduction in time spent on manual tracking

---

## 5. User Stories

### 5.1 Budget Management

- **US-1:** As a PM, I want to see total hours burnt vs. remaining budget so I can manage capacity.
- **US-2:** As a PM, I want the system to enter "Critical Only" mode when budget is exhausted.
- **US-3:** As a PM, I want to set per-module budget caps with Payroll as a protected category.

### 5.2 Compliance & Tracking

- **US-4:** As a PM, I want to see a warning when hours are burned on tickets not in "LOE Approved" status.
- **US-5:** As a PM, I want to track LOE accuracy (estimated vs. actual) over time.
- **US-6:** As a PM, I want a full audit trail to support vendor dispute discussions.

### 5.3 Analysis & Reporting

- **US-7:** As a PM, I want to filter by Application (HCM/ERP/EPM) to see module-level spend.
- **US-8:** As a PM, I want to filter by Phase to understand work distribution.
- **US-9:** As a PM, I want month-over-month trends to validate stabilization.
- **US-10:** As a PM, I want exportable reports for leadership and vendor meetings.

---

## 6. Functional Requirements

### 6.1 Jira Field Mapping

The system leverages existing Jira fields for classification. The Application field is required on all tickets.

#### 6.1.1 Application Field (Primary Classification)

Required field identifying the Oracle Cloud module:

| Application Value | Code | Status |
|-------------------|------|--------|
| Human Capital Management (HCM) | HCM | Active |
| Enterprise Resource Planning (ERP) | ERP | Active |
| Enterprise Performance Management (EPM) | EPM | Active |
| Oracle Fusion Analytics Warehouse | FAW | Active |
| Student Financial Planning (SFP) | SFP | Coming 2027 |
| Student Management Suite Cloud (STU) | STU | Coming 2028 |

#### 6.1.2 Module Field (Sub-Classification)

Provides granular sub-module detail. Used to identify cross-module critical categories like Payroll:

- Example: "HCM - Payroll US" identifies payroll-specific tickets
- Payroll tickets receive special handling (cross-module, always critical)

#### 6.1.3 Priority Field

Maps to SOW-defined priority levels for SLA and budget exhaustion logic. Dashboard will interpret Jira priority values to match SOW categories:

| Jira Priority | SOW Category | Budget Exhausted |
|---------------|--------------|------------------|
| Critical / Urgent | Critical (P1) / High (P2) | Work continues |
| High / Risk | Medium (P3) | Work paused |
| Medium / Low / None | Low (P4) | Work paused |

#### 6.1.4 LOE Fields & Workflow

LOE approval is managed via Jira workflow status transitions, not a separate field:

| Status | Meaning |
|--------|---------|
| LOE Provided | Vendor submitted estimate, awaiting Moravian approval |
| LOE Approved | Work is authorized to proceed |
| On Hold | Paused (budget, priority, or other reason) |
| Client Clarification Requested | Needs more information from Moravian |
| Resolved | Work complete |

**LOE Estimate Hours Field:**
- Custom field (Number) containing vendor's estimated hours to complete
- Populated when ticket transitions to "LOE Provided" status

#### 6.1.5 Classification Fallback Logic

For rare cases where Application field is empty:

1. Application field (primary - required field, ~99% coverage)
2. Reporter mapping (fallback - see known mappings below)
3. Keyword inference (last resort)
4. Unclassified (flag for review)

**Reporter Mappings:**

| Reporter | Module | Type | Notes |
|----------|--------|------|-------|
| Dior Mariano | HCM | Auto-map | HR |
| Justine Rossi | HCM | Auto-map | HR |
| Rachael Lyall | ERP | Auto-map | Finance |
| Sophia Eaton | EPM | Auto-map | FP&A |
| [IT Staff] | — | Skip | Use keywords |
| Paul Edinger | — | Skip | IT - use keywords |

---

### 6.2 Budget Management

#### 6.2.1 Contractual Basis (per SOW)

- Monthly allocation: 100 hours (Optimization + Support)
- Hours do NOT carry forward to subsequent months
- Moravian Support Manager responsible for prioritizing work
- All Drivestream time counts (analysis, LOE, meetings, project management)

#### 6.2.2 Budget Display

- Hours burnt / remaining / allocated
- Burn rate and projected exhaustion date
- Visual progress bar with thresholds (green < 50%, yellow 50-75%, orange 75-90%, red > 90%)

#### 6.2.3 Budget Exhaustion Mode

When monthly budget is fully consumed:

- Dashboard displays "BUDGET EXHAUSTED" banner
- Only Critical (P1) and High (P2) priority tickets eligible for work
- Non-critical tickets grayed out with "Paused - Budget" status
- Payroll tickets always eligible regardless of priority

#### 6.2.4 Overage Rules (per SOW)

- Critical requests (system down, payroll) proceed even over budget = "Approved Overage"
- Moravian can approve non-critical work to continue as Approved Overage
- Inadvertent overages on non-critical: 5% credit applied, remainder invoiced
- Dashboard tracks overage hours separately for billing reconciliation

#### 6.2.5 Per-Module Budgets (Optional)

- Set caps per Application (e.g., HCM: 40 hours, ERP: 40 hours, EPM: 20 hours)
- Payroll is a protected cross-module category, exempt from module caps
- Warning when module approaches cap

#### 6.2.6 Admin/Overhead Hours

Hours from burnt report without Jira ticket keys (e.g., "AMS - Account Management"):

- Categorized as "Admin/Overhead"
- Tracked separately but counts toward total budget
- Visible in reports for transparency

---

### 6.3 Priority & SLA Structure (per SOW)

#### 6.3.1 Break Fix Requests (Incidents)

Issues where the system is not functioning according to requirements:

| Priority | Description | Response SLA |
|----------|-------------|--------------|
| Critical (P1) | Business stoppage | < 1 hour |
| High (P2) | Significant challenges/delays to business processes | < 4 hours |
| Medium (P3) | Non-critical delays to business processes | < 2 days |
| Low (P4) | Proactive maintenance; enhances user experience | < 3 days |

#### 6.3.2 Non-Break Fix Requests (Changes/Enhancements)

Requests to change or enhance the system, or training requests:

| Priority | Description | Response SLA |
|----------|-------------|--------------|
| High Impact | Causing significant challenges/delays to business process | < 2 days |
| Medium Impact | Important business requirement; enhances current processes | < 3 days |
| Low Impact | Nice to have | < 5 days |

*Note: Response times are business hours (9am-6pm ET, Mon-Fri, excluding holidays). Requests awaiting Moravian response for 5+ business days will be closed.*

#### 6.3.3 Budget Exhaustion Eligibility

When budget is exhausted, only these continue without approval:

- Break Fix: Critical (P1) and High (P2)
- Any ticket with Module containing "Payroll"
- All others require explicit Approved Overage from Moravian Support Manager

---

### 6.4 Compliance & Flags

#### 6.4.1 Unapproved LOE Flag

Flags tickets where hours were burned but workflow status is NOT "LOE Approved":

- Warning icon on tickets with hours burned while in "LOE Provided" or other pre-approval status
- Compliance report: list of all unapproved tickets with hours
- Summary metric: total hours burned on unapproved work

#### 6.4.2 LOE Accuracy Tracking

- Compare LOE Estimate Hours vs. actual hours burned per ticket
- Variance analysis: over/under estimates by module, by phase
- Historical trends for improving future estimates

#### 6.4.3 Audit Trail

- Full history of all imported burnt hours with timestamps
- Ticket-level detail: who reported, when, LOE changes over time
- Exportable "evidence packs" for vendor dispute meetings
- Comparison view: LOE vs. actual for similar past tickets

---

### 6.5 Data Ingestion

#### 6.5.1 Burnt Hours Excel Import

**File Format:**
- Naming: [VendorCode]_Burnt_Report_[MM-DD-YYYY].xlsx
- Rows 1-3: Filter metadata (skip)
- Row 4: Column headers
- Row 5+: Data rows

**Column Mapping:**

| Excel Column | Dashboard Field | Notes |
|--------------|-----------------|-------|
| Project: Name | jira_project | Grouped; propagate down |
| Jira Issue Key | ticket_key | Empty = Admin/Overhead |
| Task: Name | description | Ticket summary |
| Hours Actual: Billable | hours_burnt | Decimal hours |

#### 6.5.2 Multi-Project Jira Sync

- Instance: drivestream.atlassian.net (Jira Cloud)
- Projects: MOHEECI, MOCSO, MOCS, MOPT, MSPP
- Sync frequency: Every 15 minutes (configurable)
- Fields: Application, Module, Priority, Status, LOE Estimate Hours, Reporter

---

### 6.6 Dashboard Views

#### 6.6.1 Budget Overview

- Hours burnt / remaining / allocated
- Burn rate and projected exhaustion date
- Budget exhaustion mode indicator
- Admin/Overhead hours breakout

#### 6.6.2 Application Breakdown

- Hours by Application (HCM, ERP, EPM, etc.)
- Pie chart and trend lines
- Per-module budget status (if caps configured)

#### 6.6.3 Phase Breakdown

- Hours by Phase (Implementation, Stabilization, Support, Optimization)
- Stacked bar by Application within Phase

#### 6.6.4 Heat Map

- Application (rows) × Phase (columns) matrix
- Color intensity = hours consumed
- Click to drill into specific cell

#### 6.6.5 Ticket Queue

- Unified list from all projects
- Columns: Key, Summary, Application, Module, Phase, Priority, Status, LOE Hours, Hours Burnt
- Status indicator: color-coded workflow state (LOE Provided, LOE Approved, On Hold, etc.)
- Highlight: tickets with hours burned before LOE Approved, budget-paused tickets
- Sortable, filterable by all dimensions

#### 6.6.6 Compliance Dashboard

- Unapproved LOE tickets with burned hours
- LOE accuracy metrics
- Budget overage history

---

### 6.7 Alerts & Notifications

#### 6.7.1 Alert Triggers

- Budget thresholds: 50%, 75%, 90%, 100%
- Module cap approaching/exceeded
- Hours burned on unapproved LOE

#### 6.7.2 Notification Channels

Configurable per installation. Reference implementation uses Google Chat.

| Channel | Integration Method | Notes |
|---------|-------------------|-------|
| Google Chat | Incoming Webhook | Primary for Moravian |
| Slack | Incoming Webhook | Supported |
| Microsoft Teams | Incoming Webhook | Supported |
| Email | SMTP / SendGrid / SES | Supported |

---

## 7. Technical Requirements

### 7.1 Architecture Overview

Self-hosted Node.js application with React frontend, designed to run on internal intranet.

#### 7.1.1 Technology Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Frontend | React | SPA with dashboard components |
| Backend | Node.js + Express | REST API |
| Database | SQLite | File-based, zero configuration |
| Config | .env / config.json | Jira creds, budget settings, field mappings |

#### 7.1.2 Deployment Model

- Production: Internal Moravian server at loe.moravian.edu
- Development: Localhost
- Authentication required (login wall)
- Outbound HTTPS to Jira Cloud API only

#### 7.1.3 Installation

```bash
git clone https://github.com/[org]/vendor-hours-tracker
cd vendor-hours-tracker
npm install
cp .env.example .env  # configure Jira credentials
npm run build
npm start
```

#### 7.1.4 Open Source Design

Designed for easy adoption by other organizations:

- Configurable Jira instance URL and projects
- Configurable Application/Module field names and values
- Configurable Excel parser templates for different vendor formats
- Admin UI for reporter mappings, keyword dictionaries, budget settings
- No hardcoded organization-specific values

### 7.2 Jira Cloud API

- Reference instance: drivestream.atlassian.net
- Authentication: API token + email or OAuth 2.0
- Endpoints: /rest/api/3/search, /rest/api/3/field, /rest/api/3/issue/{key}

### 7.3 Data Model

| Entity | Key Fields | Source |
|--------|------------|--------|
| Config | jira_instance, jira_api_token, budget_hours, sync_interval | .env |
| JiraProject | key, name, phase | Config |
| Application | code, name, budget_cap (optional) | Config |
| JiraTicket | key, project_key, application, module, priority, status, loe_hours, reporter | Jira API |
| BurntHours | id, ticket_key, hours, is_admin, import_batch_id | Excel |
| ReporterMapping | reporter_email, application, type (auto-map/skip) | Admin UI |

### 7.4 Non-Functional Requirements

- Performance: Dashboard loads < 3 seconds
- Runs on modest hardware (2 CPU, 4GB RAM)
- Database: SQLite (file-based, zero config)
- Scalability: 10,000+ tickets, 5 years history
- Browser support: Chrome, Firefox, Edge (latest 2 versions)

---

## 8. Access Control

### 8.1 Hosting

- Production URL: loe.moravian.edu (or similar internal domain)
- Hosted on internal Moravian infrastructure
- Outbound HTTPS to Jira Cloud API (drivestream.atlassian.net)

### 8.2 Authentication

- Login required — no anonymous access
- Standard: SAML 2.0 (supports most enterprise identity providers)
- Moravian: Okta
- Other supported providers: Azure AD, Google Workspace, OneLogin, PingIdentity, etc.
- Fallback: Local accounts for organizations without SSO
- Session-based authentication with configurable timeout

### 8.3 Authorization

- All authenticated Moravian Oracle team members can view dashboard
- Admin role for configuration (reporter mappings, budget settings, etc.)
- Future: Read-only access for vendor (Drivestream) for transparency

---

## 9. Resolved Decisions

| Decision | Answer |
|----------|--------|
| License | MIT |
| Database | SQLite |
| Primary notification channel | Google Chat (via webhook) |
| Hour rollover | NO — per SOW, hours do not carry forward |
| Hosting | Internal at Moravian (e.g., loe.moravian.edu) |
| Authentication | SAML 2.0 (Moravian uses Okta) |

---

## 10. Proposed Timeline

| Phase | Deliverables | Duration |
|-------|--------------|----------|
| Phase 1 | Multi-project Jira integration, Application/Module field mapping | 2-3 weeks |
| Phase 2 | Budget dashboard, exhaustion mode, Critical-only logic | 2 weeks |
| Phase 3 | Excel parser, Admin/Overhead handling | 2 weeks |
| Phase 4 | Compliance flags, LOE accuracy tracking, audit trail | 2 weeks |
| Phase 5 | Multi-tenant config, open source packaging, documentation | 2 weeks |

---

## Appendix A: Application Reference

| Code | Full Name | Description |
|------|-----------|-------------|
| HCM | Human Capital Management | HR, payroll, benefits, talent, workforce |
| ERP | Enterprise Resource Planning | Financials, procurement, projects |
| EPM | Enterprise Performance Management | Budgeting, planning, consolidation |
| FAW | Oracle Fusion Analytics Warehouse | Analytics and reporting |
| SFP | Student Financial Planning | Financial aid, student billing |
| STU | Student Management Suite Cloud | Student records, admissions |

---

## Appendix B: Priority & SLA Reference (per SOW)

### Break Fix (Incidents)

| Priority | Description | Response | Budget Exhaust |
|----------|-------------|----------|----------------|
| Critical (P1) | Business stoppage | < 1 hour | Continues |
| High (P2) | Significant challenges/delays to business | < 4 hours | Continues |
| Medium (P3) | Non-critical delays | < 2 days | Paused |
| Low (P4) | Proactive maintenance | < 3 days | Paused |

### Non-Break Fix (Changes/Enhancements)

| Priority | Description | Response | Budget Exhaust |
|----------|-------------|----------|----------------|
| High Impact | Significant challenges/delays | < 2 days | Paused |
| Medium Impact | Enhances current processes | < 3 days | Paused |
| Low Impact | Nice to have | < 5 days | Paused |

*Note: Payroll tickets always continue regardless of priority level.*

---

## Appendix C: Payroll Special Handling

Payroll is a cross-module critical category requiring special handling:

- Identified by Module field containing "Payroll" (e.g., "HCM - Payroll US")
- Exempt from per-module budget caps
- Always eligible for work even in budget exhaustion mode
- Tracked separately in reporting for visibility
