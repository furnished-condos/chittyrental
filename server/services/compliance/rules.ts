export type ComplianceAudience = 'landlord' | 'tenant' | 'both';

export interface ComplianceObligation {
  id: string;
  audience: ComplianceAudience;
  requirement: string;
  citation?: string;
  notes?: string;
}

export interface ComplianceTopic {
  topic: string;
  description: string;
  obligations: ComplianceObligation[];
}

export interface JurisdictionRuleSet {
  id: string;
  name: string;
  level: 'federal' | 'state' | 'local';
  jurisdiction: string;
  summary: string;
  references: string[];
  topics: ComplianceTopic[];
}

export interface RuleSetQuery {
  state?: string;
  city?: string;
}

const FEDERAL_RULES: JurisdictionRuleSet = {
  id: 'federal-fair-housing',
  name: 'Fair Housing Act',
  level: 'federal',
  jurisdiction: 'United States',
  summary:
    'The Fair Housing Act prohibits discrimination in housing-related transactions on the basis of protected classes and requires equal access to housing opportunities.',
  references: [
    '42 U.S.C. §§ 3601-3619',
    'HUD Fair Housing Act Guidance'
  ],
  topics: [
    {
      topic: 'Advertising and Marketing',
      description:
        'Marketing materials must be free of discriminatory statements, preferences, or limitations related to protected classes.',
      obligations: [
        {
          id: 'fha-advertising-1',
          audience: 'landlord',
          requirement:
            'Ensure all advertisements avoid references to protected classes such as race, color, religion, sex, disability, familial status, or national origin.',
          citation: '42 U.S.C. § 3604(c)'
        },
        {
          id: 'fha-advertising-2',
          audience: 'landlord',
          requirement:
            'Include the Equal Housing Opportunity logo or statement in marketing collateral when feasible to indicate compliance.',
          citation: 'HUD Advertising Guidelines'
        }
      ]
    },
    {
      topic: 'Tenant Screening',
      description:
        'Screening policies must be applied consistently without discriminatory impact or intent.',
      obligations: [
        {
          id: 'fha-screening-1',
          audience: 'landlord',
          requirement:
            'Apply uniform screening criteria to all applicants and document legitimate business reasons for denials.',
          citation: '42 U.S.C. § 3604(b)'
        },
        {
          id: 'fha-screening-2',
          audience: 'landlord',
          requirement:
            'Provide reasonable accommodations in screening and leasing processes for applicants with disabilities.',
          citation: '24 C.F.R. § 100.204'
        }
      ]
    },
    {
      topic: 'Accessibility and Accommodations',
      description:
        'Landlords must allow reasonable accommodations and modifications for individuals with disabilities and avoid policies that create disparate impact.',
      obligations: [
        {
          id: 'fha-accessibility-1',
          audience: 'landlord',
          requirement:
            'Respond promptly to accommodation requests and engage in an interactive process to determine reasonable solutions.',
          citation: 'HUD/DOJ Joint Statement on Reasonable Accommodations'
        },
        {
          id: 'fha-accessibility-2',
          audience: 'tenant',
          requirement:
            'Tenants requesting modifications may be responsible for restoration costs if the accommodation is structural and not otherwise required.',
          citation: '42 U.S.C. § 3604(f)(3)'
        }
      ]
    }
  ]
};

const ILLINOIS_RULES: JurisdictionRuleSet = {
  id: 'illinois-lt-act',
  name: 'Illinois Landlord and Tenant Act & Security Deposit Return Act',
  level: 'state',
  jurisdiction: 'Illinois',
  summary:
    'Illinois law governs security deposits, notice requirements, habitability standards, and retaliation protections for residential leases.',
  references: [
    '765 ILCS 705/1 et seq.',
    '765 ILCS 710/1 et seq.',
    '735 ILCS 5/9-101 et seq.'
  ],
  topics: [
    {
      topic: 'Security Deposits',
      description:
        'State statutes require timely return of deposits with itemized statements and regulate interest accrual for larger buildings.',
      obligations: [
        {
          id: 'il-deposit-1',
          audience: 'landlord',
          requirement:
            'Provide an itemized statement of damages within 30 days and return remaining security deposit funds within 45 days for properties with five or more units.',
          citation: '765 ILCS 710/1'
        },
        {
          id: 'il-deposit-2',
          audience: 'landlord',
          requirement:
            'Pay annual interest on deposits held more than six months in properties with 25 or more units.',
          citation: '765 ILCS 715/1'
        },
        {
          id: 'il-deposit-3',
          audience: 'tenant',
          requirement:
            'Provide a forwarding address in writing to facilitate the return of the security deposit.',
          citation: '765 ILCS 710/1'
        }
      ]
    },
    {
      topic: 'Maintenance and Habitability',
      description:
        'Landlords must maintain essential services and comply with local housing codes; tenants may have remedies when services are interrupted.',
      obligations: [
        {
          id: 'il-maintenance-1',
          audience: 'landlord',
          requirement:
            'Maintain the premises in compliance with municipal code standards and promptly repair essential services such as heat, water, and electricity.',
          citation: '765 ILCS 735/0.01 et seq.'
        },
        {
          id: 'il-maintenance-2',
          audience: 'tenant',
          requirement:
            'Provide notice of material defects or service interruptions and allow reasonable access for repairs.',
          citation: '765 ILCS 735/1'
        }
      ]
    },
    {
      topic: 'Notice and Eviction',
      description:
        'Eviction actions require statutory notices and must proceed through the courts; self-help eviction is prohibited.',
      obligations: [
        {
          id: 'il-eviction-1',
          audience: 'landlord',
          requirement:
            'Serve the appropriate statutory notice (5-day for nonpayment, 10-day for lease violation, or 30-day for month-to-month termination) before filing an eviction.',
          citation: '735 ILCS 5/9-209'
        },
        {
          id: 'il-eviction-2',
          audience: 'landlord',
          requirement:
            'Avoid self-help eviction tactics such as changing locks or shutting off utilities.',
          citation: '735 ILCS 5/9-101'
        },
        {
          id: 'il-eviction-3',
          audience: 'tenant',
          requirement:
            'Tenants may raise defenses related to habitability or retaliatory conduct when the landlord seeks eviction.',
          citation: '765 ILCS 720/1'
        }
      ]
    }
  ]
};

const CHICAGO_RTLO_RULES: JurisdictionRuleSet = {
  id: 'chicago-rtlo',
  name: 'Chicago Residential Tenant Landlord Ordinance (RTLO)',
  level: 'local',
  jurisdiction: 'Chicago, IL',
  summary:
    'The RTLO supplements state law with enhanced tenant protections, disclosure obligations, and penalties for non-compliance within the City of Chicago.',
  references: [
    'Chicago Municipal Code § 5-12',
    'Cook County RTLO Guidance'
  ],
  topics: [
    {
      topic: 'Required Disclosures',
      description:
        'Landlords must provide tenants with specific documents and disclosures at the commencement of the tenancy.',
      obligations: [
        {
          id: 'chicago-disclosure-1',
          audience: 'landlord',
          requirement:
            'Deliver the City of Chicago RLTO summary, lead paint disclosure, and notice of code violations (if any) before accepting rent.',
          citation: 'Chicago Mun. Code § 5-12-170'
        },
        {
          id: 'chicago-disclosure-2',
          audience: 'landlord',
          requirement:
            'Provide a notice of the building owner or agent with contact information for receiving legal notices.',
          citation: 'Chicago Mun. Code § 5-12-090'
        }
      ]
    },
    {
      topic: 'Security Deposit Handling',
      description:
        'The RTLO imposes strict rules on handling, holding, and returning security deposits with significant statutory penalties for violations.',
      obligations: [
        {
          id: 'chicago-deposit-1',
          audience: 'landlord',
          requirement:
            'Hold security deposits in a federally insured interest-bearing account and provide written receipt information.',
          citation: 'Chicago Mun. Code § 5-12-080'
        },
        {
          id: 'chicago-deposit-2',
          audience: 'landlord',
          requirement:
            'Return the deposit within 45 days and pay interest annually; failure triggers damages of two times the deposit plus attorney fees.',
          citation: 'Chicago Mun. Code § 5-12-080'
        },
        {
          id: 'chicago-deposit-3',
          audience: 'tenant',
          requirement:
            'Tenants should document the condition of the unit at move-in and move-out to support or dispute deductions.',
          citation: 'Chicago Mun. Code § 5-12-080'
        }
      ]
    },
    {
      topic: 'Remedies and Penalties',
      description:
        'Violations of the RTLO often entitle tenants to statutory damages, attorney fees, and other remedies.',
      obligations: [
        {
          id: 'chicago-remedies-1',
          audience: 'tenant',
          requirement:
            'Tenants may recover two times the security deposit plus interest and attorney fees for improper deposit handling.',
          citation: 'Chicago Mun. Code § 5-12-080'
        },
        {
          id: 'chicago-remedies-2',
          audience: 'tenant',
          requirement:
            'Tenants may seek rent abatement or termination rights when landlords fail to maintain essential services after proper notice.',
          citation: 'Chicago Mun. Code § 5-12-110'
        }
      ]
    }
  ]
};

const REGISTERED_RULESETS: JurisdictionRuleSet[] = [
  FEDERAL_RULES,
  ILLINOIS_RULES,
  CHICAGO_RTLO_RULES
];

export function listRegisteredRuleSets(): JurisdictionRuleSet[] {
  return [...REGISTERED_RULESETS];
}

export function getRuleSetsForLocation(query: RuleSetQuery = {}): JurisdictionRuleSet[] {
  const normalizedState = query.state?.toLowerCase();
  const normalizedCity = query.city?.toLowerCase();

  return REGISTERED_RULESETS.filter((rule) => {
    if (rule.level === 'federal') {
      return true;
    }

    if (rule.level === 'state') {
      if (!normalizedState) return false;
      return rule.jurisdiction.toLowerCase() === normalizedState || rule.jurisdiction.toLowerCase().includes(normalizedState);
    }

    if (rule.level === 'local') {
      if (!normalizedCity) return false;
      return (
        rule.jurisdiction.toLowerCase() === normalizedCity ||
        rule.jurisdiction.toLowerCase().includes(normalizedCity)
      );
    }

    return false;
  });
}

export function groupRuleSetsByLevel(ruleSets: JurisdictionRuleSet[]): Record<'federal' | 'state' | 'local', JurisdictionRuleSet[]> {
  return ruleSets.reduce(
    (acc, ruleSet) => {
      acc[ruleSet.level].push(ruleSet);
      return acc;
    },
    { federal: [] as JurisdictionRuleSet[], state: [] as JurisdictionRuleSet[], local: [] as JurisdictionRuleSet[] }
  );
}

export function formatRuleSetsForPrompt(ruleSets: JurisdictionRuleSet[]): string {
  return ruleSets
    .map((ruleSet) => {
      const topics = ruleSet.topics
        .map((topic) => {
          const obligations = topic.obligations
            .map((obligation) => `- (${obligation.audience}) ${obligation.requirement}${obligation.citation ? ` [${obligation.citation}]` : ''}`)
            .join('\n');
          return `Topic: ${topic.topic} - ${topic.description}\n${obligations}`;
        })
        .join('\n\n');

      return `Jurisdiction: ${ruleSet.jurisdiction} (${ruleSet.level})\nName: ${ruleSet.name}\nSummary: ${ruleSet.summary}\nReferences: ${ruleSet.references.join(', ')}\n${topics}`;
    })
    .join('\n\n');
}
