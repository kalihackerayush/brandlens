import { Role } from '../types';

export interface RolePostingScope {
  role: Role;
  title: string;
  allowedScope: string[];
  prohibitedActions: string[];
  approvalRequirement?: string;
  guidelinesPrompt: string;
}

export interface OrganizationConfig {
  id: string;
  name: string;
  tagline: string;
  industry: string;
  description: string;
  companyContext: string;
  supportedServiceCategories: string[];
  allowedContentTopics: string[];
  restrictedContentTopics: string[];
  approvedFactsAndClaims: string[];
  unsupportedClaimsPolicy: string;
  brandVoice: {
    tone: string;
    style: string;
    vocabularyRecommendations: string[];
    prohibitedPatterns: string[];
  };
  roles: Record<Role, RolePostingScope>;
}

export const NOVA_UNLIMITED_CONFIG: OrganizationConfig = {
  id: 'org-nova-unlimited',
  name: 'Nova Unlimited',
  tagline: 'High-Performance Server Infrastructure & Hosting Services',
  industry: 'Server and hosting services',
  description: 'Enterprise and developer cloud infrastructure, VPS nodes, dedicated bare-metal servers, and managed hosting environments.',
  companyContext: 'Nova Unlimited is a company that provides server and hosting-related services. Its content should be relevant to the company\'s actual services, technical offerings, hosting products, customer needs, service updates, and legitimate business activities.',
  supportedServiceCategories: [
    'Managed Server Hosting & Infrastructure Ops',
    'Cloud Virtual Private Servers (VPS)',
    'Dedicated Bare-Metal Server Compute',
    'Infrastructure Networking & DDoS Mitigation',
    'Automated Snapshots, Storage & Disaster Recovery',
    'Server Health Monitoring & Performance Tuning',
    'Developer APIs & Automated Provisioning Workflows'
  ],
  allowedContentTopics: [
    'Hosting and server architecture best practices',
    'VPS and dedicated server deployments and scaling',
    'Cloud infrastructure performance benchmarks and resource allocation',
    'Server security, kernel patching, Linux administration, and network hardening',
    'Company service updates, maintenance windows, and infrastructure improvements',
    'Hosting educational tutorials, sysadmin guides, and customer best practices',
    'Network reliability, latency optimization, and disaster recovery advice'
  ],
  restrictedContentTopics: [
    'Entertainment, gaming memes, pop culture references, and lifestyle commentary',
    'Cryptocurrency speculative trading, coin drops, or token sales',
    'Personal political views or contentious social and societal debates',
    'Consumer electronics or personal gadgets unrelated to servers/data centers',
    'Unrelated sports, celebrity news, or general viral trends'
  ],
  approvedFactsAndClaims: [
    'Nova Unlimited provides server infrastructure and hosting services.',
    'Nova Unlimited offers dedicated servers, cloud VPS, and managed server environments.',
    'Nova Unlimited maintains continuous infrastructure monitoring and network security best practices.',
    'Nova Unlimited supports scalable compute resources for developer and enterprise workloads.'
  ],
  unsupportedClaimsPolicy: 'Do NOT declare unsupported claims as false automatically. Flag any specific unverified numbers (e.g., 100% uptime, 99.999% SLA, unlisted pricing, unverified hardware models, or unapproved certifications) for verification with code UNSUPPORTED_CLAIM.',
  brandVoice: {
    tone: 'Authoritative, technically precise, objective, transparent, and supportive.',
    style: 'Direct, clear, and professional without marketing hyperbole, unverifiable promises, or buzzword fluff.',
    vocabularyRecommendations: [
      'high-throughput', 'redundancy', 'infrastructure resilience', 'compute node',
      'low latency', 'packet filtering', 'bare-metal compute', 'provisioning'
    ],
    prohibitedPatterns: [
      '100% uptime guaranteed (unless officially verified)',
      'Cheapest hosting on earth',
      'Unverified speed or award claims',
      'Absolute guarantees of zero downtime or impenetrable security'
    ]
  },
  roles: {
    Employee: {
      role: 'Employee',
      title: 'Product Focus & Technical Accuracy',
      allowedScope: [
        'Technical tutorials and how-to guides for server administration',
        'Hosting documentation, FAQs, and developer tips',
        'Customer troubleshooting guidance and best practices',
        'Explanations of standard hosting concepts and server performance metrics'
      ],
      prohibitedActions: [
        'Committing to specific pricing, promotional discounts, or commercial contracts',
        'Announcing company-wide policy, governance, or legal positions',
        'Announcing unreleased product roadmaps or unannounced commercial plans',
        'Promising custom SLA guarantees or enterprise liability waivers'
      ],
      approvalRequirement: 'Commercial pricing quotes or official company policy changes require Manager or Administrator signoff.',
      guidelinesPrompt: `Role: Employee (Nova Unlimited)
- Scope: Technical tutorials, server management tips, documentation, and customer best practices.
- Restrictions: You cannot publish pricing commitments, enterprise quotes, company-wide policy shifts, or executive positions.
- Fact Policy: Only discuss approved hosting capabilities. Flag unsupported claims for verification.`
    },
    Manager: {
      role: 'Manager',
      title: 'Leadership & Operational Integrity',
      allowedScope: [
        'Departmental updates and operational milestones',
        'Service enhancements and infrastructure maintenance notices',
        'Approved marketing campaigns and customer success spotlights',
        'Team hiring announcements and operational achievements'
      ],
      prohibitedActions: [
        'Unilateral enterprise pricing changes without executive signoff',
        'Unverified corporate-wide policy shifts or legal statements',
        'Unapproved corporate financial disclosures or acquisition remarks'
      ],
      approvalRequirement: 'Major corporate policy overhauls or unannounced enterprise deals require Administrator approval.',
      guidelinesPrompt: `Role: Manager (Nova Unlimited)
- Scope: Operational announcements, maintenance windows, campaign updates, and team achievements.
- Restrictions: Avoid unilateral enterprise pricing alterations or unverified corporate policy shifts.
- Fact Policy: Ensure statements are grounded in verified operations and verified metrics.`
    },
    Administrator: {
      role: 'Administrator',
      title: 'Brand Standards & Corporate Governance',
      allowedScope: [
        'Organization-wide communications and strategic brand positioning',
        'Executive announcements and corporate policy updates',
        'Official service agreements, high-level roadmaps, and company milestones'
      ],
      prohibitedActions: [
        'Making unsupported factual or technical claims (e.g., claiming 100% uptime without verified documentation). Admin privileges do not override factual verification rules.'
      ],
      approvalRequirement: 'All external factual assertions must still be verifiable against infrastructure records.',
      guidelinesPrompt: `Role: Administrator (Nova Unlimited)
- Scope: Organization-wide announcements, executive updates, and corporate brand positioning.
- Boundaries: High authority, but MUST strictly uphold factual integrity. Administrative status does NOT permit unsupported factual claims (e.g. 100% uptime without proof).`
    }
  }
};

// Registry of organizations (designed for extensibility when future organizations are added)
const ORGANIZATIONS_REGISTRY: Record<string, OrganizationConfig> = {
  [NOVA_UNLIMITED_CONFIG.id]: NOVA_UNLIMITED_CONFIG
};

export function getOrganizationConfig(orgId?: string): OrganizationConfig {
  if (orgId && ORGANIZATIONS_REGISTRY[orgId]) {
    return ORGANIZATIONS_REGISTRY[orgId];
  }
  return NOVA_UNLIMITED_CONFIG;
}

export function getAllOrganizations(): OrganizationConfig[] {
  return Object.values(ORGANIZATIONS_REGISTRY);
}
