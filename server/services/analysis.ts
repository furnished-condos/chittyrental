import { openai } from './openai-client';
import { storage } from '../storage';
import * as fs from 'fs';
import * as path from 'path';
import {
  formatRuleSetsForPrompt,
  getRuleSetsForLocation,
  groupRuleSetsByLevel,
  JurisdictionRuleSet
} from './compliance/rules';

interface AnalysisResult {
  summary: string;
  insights: string[];
  recommendations: string[];
  metrics: {
    totalProperties: number;
    totalTransactions: number;
    rentalOccupancyRate: number;
    averageMonthlyRevenue: number;
    profitMargin: number;
  };
}

type ComplianceLevel = 'federal' | 'state' | 'local';

type ComplianceStatus = 'compliant' | 'non_compliant' | 'needs_review';

export interface JurisdictionComplianceFinding {
  jurisdiction: string;
  level: ComplianceLevel;
  ruleSetId?: string;
  summary: string;
  complianceStatus: ComplianceStatus;
  keyFindings: string[];
  risks: string[];
  citations: string[];
  recommendations: string[];
}

export interface ComplianceActionItem {
  audience: 'landlord' | 'tenant';
  priority: 'high' | 'medium' | 'low';
  item: string;
  relatedFindingIds?: string[];
}

export interface ActionItemsByAudience {
  landlord: ComplianceActionItem[];
  tenant: ComplianceActionItem[];
}

export interface KeyDateDetail {
  label: string;
  date: string;
  description?: string;
}

export interface ExtractedFacts {
  sourceId?: string;
  sourceType?: 'document' | 'situational' | 'manual';
  parties: {
    landlord?: string | null;
    tenants: string[];
    otherParties: string[];
  };
  propertyAddress?: string | null;
  rentAmount?: string | null;
  securityDeposit?: string | null;
  keyDates: KeyDateDetail[];
  additionalNotes: string[];
}

export interface FactCheckSummary {
  extracted: ExtractedFacts;
  missingInformation: string[];
  inconsistencies: string[];
  corroborated: string[];
}

export interface LegalDocumentAnalysisResult {
  summary: string;
  complianceFindings: {
    federal: JurisdictionComplianceFinding[];
    state: JurisdictionComplianceFinding[];
    local: JurisdictionComplianceFinding[];
  };
  actionItems: ActionItemsByAudience;
  factCheck: FactCheckSummary;
  followUpQuestions: string[];
  metadata: {
    documentType: DocumentType;
    origin: 'document' | 'situational';
    appliedRuleSets: JurisdictionRuleSet[];
  };
}

// Document types we can analyze
type DocumentType = 'legal' | 'communication' | 'business' | 'court' | 'text_message';

export interface ComplianceAnalysisOptions {
  state?: string;
  city?: string;
  origin?: 'document' | 'situational';
  sessionFacts?: ExtractedFacts[];
  documentName?: string;
}

/**
 * Analyzes ARIAS V BIANCHI company data using available storage data
 * and generates insights using OpenAI
 */
export async function analyzeAriasVBianchi(): Promise<AnalysisResult> {
  // 1. Gather data from storage
  const properties = await storage.getProperties();
  
  // Build structured data for analysis
  const companyData = {
    companyName: "ARIAS V BIANCHI LLC",
    properties: properties,
    propertyCount: properties.length,
    // We would include these in a real implementation
    // transactions: await storage.getTransactions(),
    // maintenanceRequests: await storage.getMaintenanceRequests(),
  };
  
  // 2. Use OpenAI to analyze the data
  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { 
          role: "system", 
          content: "You are a property management analyst providing insights on real estate portfolios." 
        },
        { 
          role: "user", 
          content: `Analyze this property management company data and provide insights:
          
          ${JSON.stringify(companyData, null, 2)}
          
          Generate a comprehensive analysis including:
          1. Executive summary
          2. Key insights about the portfolio
          3. Actionable recommendations
          4. Performance metrics
          
          Format as a JSON with these fields:
          {
            "summary": "Executive summary of the analysis",
            "insights": ["Insight 1", "Insight 2", ...],
            "recommendations": ["Recommendation 1", "Recommendation 2", ...],
            "metrics": {
              "totalProperties": number,
              "totalTransactions": number,
              "rentalOccupancyRate": number,
              "averageMonthlyRevenue": number,
              "profitMargin": number
            }
          }`
        }
      ],
      model: "gpt-3.5-turbo",
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    console.log("Analysis completed successfully");
    return JSON.parse(completion.choices[0].message.content || '{}');
  } catch (error) {
    console.error("Error performing analysis:", error);
    // Return a basic result when API fails
    return {
      summary: "Unable to perform complete analysis at this time.",
      insights: ["Analysis service is temporarily unavailable."],
      recommendations: ["Please try again later."],
      metrics: {
        totalProperties: companyData.propertyCount,
        totalTransactions: 0,
        rentalOccupancyRate: 0,
        averageMonthlyRevenue: 0,
        profitMargin: 0
      }
    };
  }
}

/**
 * Performs a specialized analysis on a specific property
 */
export async function analyzeProperty(propertyId: number): Promise<any> {
  const property = await storage.getProperty(propertyId);
  
  if (!property) {
    throw new Error(`Property with ID ${propertyId} not found`);
  }
  
  // Add more analysis logic as needed
  
  return {
    propertyId,
    propertyName: property.name,
    analysisDate: new Date().toISOString(),
    status: "Analysis completed"
  };
}

/**
 * Analyzes legal documents related to ARIAS V BIANCHI
 * @param documentType Type of document to analyze
 * @param content The text content of the document
 */
function createEmptyFacts(): ExtractedFacts {
  return {
    parties: {
      landlord: null,
      tenants: [],
      otherParties: []
    },
    propertyAddress: null,
    rentAmount: null,
    securityDeposit: null,
    keyDates: [],
    additionalNotes: [],
    sourceType: 'document'
  };
}

function normalizeExtractedFacts(rawFacts: any, defaults: ExtractedFacts): ExtractedFacts {
  const normalized = createEmptyFacts();

  normalized.sourceId = typeof rawFacts?.sourceId === 'string' ? rawFacts.sourceId : defaults.sourceId;
  normalized.sourceType = (rawFacts?.sourceType as ExtractedFacts['sourceType']) || defaults.sourceType || 'document';
  normalized.parties.landlord = rawFacts?.parties?.landlord ?? defaults.parties.landlord ?? null;
  normalized.parties.tenants = Array.isArray(rawFacts?.parties?.tenants)
    ? rawFacts.parties.tenants.filter((value: unknown) => typeof value === 'string' && value.trim().length > 0)
    : [...(defaults.parties.tenants ?? [])];
  normalized.parties.otherParties = Array.isArray(rawFacts?.parties?.otherParties)
    ? rawFacts.parties.otherParties.filter((value: unknown) => typeof value === 'string' && value.trim().length > 0)
    : [...(defaults.parties.otherParties ?? [])];
  normalized.propertyAddress = rawFacts?.propertyAddress ?? defaults.propertyAddress ?? null;
  normalized.rentAmount = rawFacts?.rentAmount ?? defaults.rentAmount ?? null;
  normalized.securityDeposit = rawFacts?.securityDeposit ?? defaults.securityDeposit ?? null;
  normalized.keyDates = Array.isArray(rawFacts?.keyDates)
    ? rawFacts.keyDates
        .filter((entry: any) => entry && (entry.label || entry.date))
        .map((entry: any) => ({
          label: entry.label ?? '',
          date: entry.date ?? '',
          description: entry.description ?? undefined
        }))
    : [...(defaults.keyDates ?? [])];
  normalized.additionalNotes = Array.isArray(rawFacts?.additionalNotes)
    ? rawFacts.additionalNotes.filter((value: unknown) => typeof value === 'string' && value.trim().length > 0)
    : [...(defaults.additionalNotes ?? [])];

  return normalized;
}

function describeFactSource(fact: ExtractedFacts): string {
  if (fact.sourceId) {
    return fact.sourceId;
  }
  if (fact.sourceType === 'situational') {
    return 'situational prompt';
  }
  return 'previous document';
}

function normalizeComparable(value?: string | null): string | null {
  if (!value) return null;
  return value.toString().trim().toLowerCase();
}

function compareArraysAsSets(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const normalizedA = a.map((value) => normalizeComparable(value) ?? '').sort();
  const normalizedB = b.map((value) => normalizeComparable(value) ?? '').sort();
  return normalizedA.every((value, index) => value === normalizedB[index]);
}

function compareFactsWithSession(current: ExtractedFacts, sessionFacts: ExtractedFacts[] = []): FactCheckSummary {
  const missingInformation = new Set<string>();
  const inconsistencies = new Set<string>();
  const corroborated = new Set<string>();

  const requiredChecks: Array<{ label: string; isMissing: boolean }> = [
    { label: 'landlord name', isMissing: !current.parties.landlord },
    { label: 'tenant names', isMissing: current.parties.tenants.length === 0 },
    { label: 'property address', isMissing: !current.propertyAddress },
    { label: 'rent amount', isMissing: !current.rentAmount },
    { label: 'security deposit amount', isMissing: !current.securityDeposit },
    { label: 'critical dates', isMissing: current.keyDates.length === 0 }
  ];

  requiredChecks.forEach((check) => {
    if (check.isMissing) {
      missingInformation.add(`Missing ${check.label}.`);
    }
  });

  sessionFacts.forEach((priorFacts) => {
    if (priorFacts.propertyAddress && current.propertyAddress) {
      if (normalizeComparable(priorFacts.propertyAddress) !== normalizeComparable(current.propertyAddress)) {
        inconsistencies.add(
          `Property address differs from ${describeFactSource(priorFacts)} (${priorFacts.propertyAddress} vs. ${current.propertyAddress}).`
        );
      } else {
        corroborated.add('Property address matches previous records.');
      }
    }

    if (priorFacts.rentAmount && current.rentAmount) {
      if (normalizeComparable(priorFacts.rentAmount) !== normalizeComparable(current.rentAmount)) {
        inconsistencies.add(
          `Rent amount differs from ${describeFactSource(priorFacts)} (${priorFacts.rentAmount} vs. ${current.rentAmount}).`
        );
      } else {
        corroborated.add('Rent amount aligns with previous records.');
      }
    }

    if (priorFacts.securityDeposit && current.securityDeposit) {
      if (normalizeComparable(priorFacts.securityDeposit) !== normalizeComparable(current.securityDeposit)) {
        inconsistencies.add(
          `Security deposit amount differs from ${describeFactSource(priorFacts)} (${priorFacts.securityDeposit} vs. ${current.securityDeposit}).`
        );
      } else {
        corroborated.add('Security deposit amount aligns with previous records.');
      }
    }

    if (priorFacts.parties.landlord && current.parties.landlord) {
      if (normalizeComparable(priorFacts.parties.landlord) !== normalizeComparable(current.parties.landlord)) {
        inconsistencies.add(
          `Landlord name differs from ${describeFactSource(priorFacts)} (${priorFacts.parties.landlord} vs. ${current.parties.landlord}).`
        );
      } else {
        corroborated.add('Landlord name matches previous records.');
      }
    }

    if (priorFacts.parties.tenants.length && current.parties.tenants.length) {
      if (!compareArraysAsSets(priorFacts.parties.tenants, current.parties.tenants)) {
        inconsistencies.add(
          `Tenant roster differs from ${describeFactSource(priorFacts)} (${priorFacts.parties.tenants.join(', ')} vs. ${current.parties.tenants.join(', ')}).`
        );
      } else {
        corroborated.add('Tenant roster matches previous records.');
      }
    }
  });

  return {
    extracted: current,
    missingInformation: Array.from(missingInformation),
    inconsistencies: Array.from(inconsistencies),
    corroborated: Array.from(corroborated)
  };
}

function formatFactsForPrompt(facts: ExtractedFacts): string {
  const lines: string[] = [];
  if (facts.parties.landlord) {
    lines.push(`Landlord: ${facts.parties.landlord}`);
  }
  if (facts.parties.tenants.length) {
    lines.push(`Tenants: ${facts.parties.tenants.join(', ')}`);
  }
  if (facts.parties.otherParties.length) {
    lines.push(`Other parties: ${facts.parties.otherParties.join(', ')}`);
  }
  if (facts.propertyAddress) {
    lines.push(`Property address: ${facts.propertyAddress}`);
  }
  if (facts.rentAmount) {
    lines.push(`Rent amount: ${facts.rentAmount}`);
  }
  if (facts.securityDeposit) {
    lines.push(`Security deposit: ${facts.securityDeposit}`);
  }
  if (facts.keyDates.length) {
    lines.push('Key dates:');
    facts.keyDates.forEach((date) => {
      lines.push(`- ${date.label || 'Unlabeled'}: ${date.date}${date.description ? ` (${date.description})` : ''}`);
    });
  }
  if (facts.additionalNotes.length) {
    lines.push(`Additional notes: ${facts.additionalNotes.join('; ')}`);
  }

  if (!lines.length) {
    return 'No key facts were extracted.';
  }

  return lines.join('
');
}

function formatSessionFactsForPrompt(sessionFacts: ExtractedFacts[] = []): string {
  if (!sessionFacts.length) {
    return 'No prior session facts provided.';
  }

  return sessionFacts
    .map((facts, index) => {
      const header = `Source ${facts.sourceId ?? `#${index + 1}`} (${facts.sourceType ?? 'document'})`;
      return `${header}:
${formatFactsForPrompt(facts)}`;
    })
    .join('

');
}

async function extractFactsFromContent(
  content: string,
  sourceId: string,
  origin: 'document' | 'situational'
): Promise<ExtractedFacts> {
  const defaults = createEmptyFacts();
  defaults.sourceId = sourceId;
  defaults.sourceType = origin;

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            'You extract factual data points from housing documents. Return concise JSON with null when data is missing. Do not infer values you cannot support.'
        },
        {
          role: 'user',
          content: `Extract the following information from the document or scenario:
- Landlord and tenant names
- Property address
- Monthly rent amount and currency
- Security deposit amount and currency
- Critical dates (lease start/end, notices, deadlines)
- Any other involved parties or important notes

Return a JSON object exactly in this structure:
{
  "parties": {
    "landlord": string | null,
    "tenants": string[],
    "otherParties": string[]
  },
  "propertyAddress": string | null,
  "rentAmount": string | null,
  "securityDeposit": string | null,
  "keyDates": [
    { "label": string, "date": string, "description": string | null }
  ],
  "additionalNotes": string[]
}

Document content:
"""
${content.substring(0, 15000)}
"""`
        }
      ],
      model: 'gpt-3.5-turbo',
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const rawFacts = completion.choices[0].message.content
      ? JSON.parse(completion.choices[0].message.content)
      : {};

    return normalizeExtractedFacts(rawFacts, defaults);
  } catch (error) {
    console.error('Fact extraction failed:', error);
    return defaults;
  }
}

function ensureArray<T>(value: unknown, fallback: T[] = []): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function normalizeComplianceFindings(
  raw: any,
  groupedRuleSets: Record<ComplianceLevel, JurisdictionRuleSet[]>
): LegalDocumentAnalysisResult['complianceFindings'] {
  const buildFindings = (level: ComplianceLevel): JurisdictionComplianceFinding[] => {
    const rawFindings = ensureArray<any>(raw?.[level], []);
    if (rawFindings.length) {
      return rawFindings.map((finding) => ({
        jurisdiction: finding?.jurisdiction ?? groupedRuleSets[level][0]?.jurisdiction ?? level,
        level,
        ruleSetId: finding?.ruleSetId,
        summary: finding?.summary ?? '',
        complianceStatus: (finding?.complianceStatus as ComplianceStatus) ?? 'needs_review',
        keyFindings: ensureArray<string>(finding?.keyFindings, []),
        risks: ensureArray<string>(finding?.risks, []),
        citations: ensureArray<string>(finding?.citations, []),
        recommendations: ensureArray<string>(finding?.recommendations, [])
      }));
    }

    return groupedRuleSets[level].map((ruleSet) => ({
      jurisdiction: ruleSet.jurisdiction,
      level,
      ruleSetId: ruleSet.id,
      summary: '',
      complianceStatus: 'needs_review' as ComplianceStatus,
      keyFindings: [],
      risks: [],
      citations: [],
      recommendations: []
    }));
  };

  return {
    federal: buildFindings('federal'),
    state: buildFindings('state'),
    local: buildFindings('local')
  };
}

function normalizeActionItems(raw: any): ActionItemsByAudience {
  const normalizeItems = (items: unknown, audience: 'landlord' | 'tenant'): ComplianceActionItem[] => {
    return ensureArray<any>(items, []).map((item) => ({
      audience,
      priority: (item?.priority as ComplianceActionItem['priority']) ?? 'medium',
      item: item?.item ?? '',
      relatedFindingIds: ensureArray<string>(item?.relatedFindingIds, [])
    }));
  };

  return {
    landlord: normalizeItems(raw?.landlord, 'landlord'),
    tenant: normalizeItems(raw?.tenant, 'tenant')
  };
}

function createErrorAnalysisResult(
  summary: string,
  documentType: DocumentType,
  origin: 'document' | 'situational',
  appliedRuleSets: JurisdictionRuleSet[],
  sessionFacts: ExtractedFacts[] = []
): LegalDocumentAnalysisResult {
  const grouped = groupRuleSetsByLevel(appliedRuleSets);
  return {
    summary,
    complianceFindings: normalizeComplianceFindings({}, grouped),
    actionItems: {
      landlord: [],
      tenant: []
    },
    factCheck: compareFactsWithSession(createEmptyFacts(), sessionFacts),
    followUpQuestions: [],
    metadata: {
      documentType,
      origin,
      appliedRuleSets
    }
  };
}

export async function analyzeLegalDocument(
  documentType: DocumentType,
  content: string,
  options: ComplianceAnalysisOptions = {}
): Promise<LegalDocumentAnalysisResult> {
  const origin = options.origin ?? 'document';
  const state = options.state ?? 'Illinois';
  const city = options.city ?? 'Chicago';
  const appliedRuleSets = getRuleSetsForLocation({ state, city });
  const groupedRuleSets = groupRuleSetsByLevel(appliedRuleSets);
  const sourceId = options.documentName || `${origin}-${documentType}-${Date.now()}`;

  try {
    const facts = await extractFactsFromContent(content, sourceId, origin);
    const factCheck = compareFactsWithSession(facts, options.sessionFacts);

    const ruleSummaryForPrompt = formatRuleSetsForPrompt(appliedRuleSets);
    const factSummaryForPrompt = formatFactsForPrompt(facts);
    const priorFactsForPrompt = formatSessionFactsForPrompt(options.sessionFacts);
    const issuesForPrompt = [
      ...factCheck.missingInformation,
      ...factCheck.inconsistencies
    ];

    const userPrompt = `You are a housing law compliance analyst. Review the provided ${
      origin === 'situational' ? 'scenario' : 'document'
    } for compliance issues. Use the supplied rule sets for federal, state, and local jurisdictions. Present distinct findings per level and outline action items tailored to landlords versus tenants.

Compliance rulebook:
${ruleSummaryForPrompt}

Primary content to evaluate:
"""
${content.substring(0, 20000)}
"""

Key facts extracted from this submission:
${factSummaryForPrompt}

Previously provided session facts:
${priorFactsForPrompt}

System-detected issues to double check:
${issuesForPrompt.length ? issuesForPrompt.join('\n') : 'None noted.'}

Respond in JSON using this schema:
{
  "summary": string,
  "complianceFindings": {
    "federal": [
      {
        "jurisdiction": string,
        "level": "federal",
        "ruleSetId": string | null,
        "complianceStatus": "compliant" | "non_compliant" | "needs_review",
        "summary": string,
        "keyFindings": string[],
        "risks": string[],
        "citations": string[],
        "recommendations": string[]
      }
    ],
    "state": [...],
    "local": [...]
  },
  "actionItems": {
    "landlord": [ { "priority": "high" | "medium" | "low", "item": string, "relatedFindingIds": string[] } ],
    "tenant": [ { "priority": "high" | "medium" | "low", "item": string, "relatedFindingIds": string[] } ]
  },
  "followUpQuestions": string[]
}`;

    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You are a meticulous housing law compliance analyst focusing on accuracy and clear risk communication.'
        },
        { role: 'user', content: userPrompt }
      ],
      model: 'gpt-3.5-turbo',
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const rawResponse = completion.choices[0].message.content
      ? JSON.parse(completion.choices[0].message.content)
      : {};

    const complianceFindings = normalizeComplianceFindings(rawResponse?.complianceFindings, groupedRuleSets);
    const actionItems = normalizeActionItems(rawResponse?.actionItems);
    const followUpQuestions = ensureArray<string>(rawResponse?.followUpQuestions, []);

    console.log(`${documentType} compliance analysis completed`);

    return {
      summary: rawResponse?.summary ?? '',
      complianceFindings,
      actionItems,
      factCheck,
      followUpQuestions,
      metadata: {
        documentType,
        origin,
        appliedRuleSets
      }
    };
  } catch (error) {
    console.error(`Error analyzing ${documentType} document:`, error);
    return createErrorAnalysisResult(
      'Unable to complete document analysis at this time.',
      documentType,
      origin,
      appliedRuleSets,
      options.sessionFacts ?? []
    );
  }
}
/**
 * Analyzes a text file from the file system
 * @param filePath Path to the document file
 * @param documentType Type of document
 */
export async function analyzeDocumentFile(
  filePath: string,
  documentType: DocumentType = 'legal'
): Promise<LegalDocumentAnalysisResult> {
  try {
    // Read the file content
    const content = fs.readFileSync(filePath, 'utf8');
    return await analyzeLegalDocument(documentType, content, {
      documentName: path.basename(filePath),
      origin: 'document'
    });
  } catch (error) {
    console.error(`Error analyzing document file at ${filePath}:`, error);
    throw new Error(`Failed to analyze document: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Analyze all documents in a directory
 * @param directoryPath Path to directory containing documents
 */
export async function analyzeDocumentDirectory(
  directoryPath: string
): Promise<{
  overallSummary: string;
  documentResults: Record<string, LegalDocumentAnalysisResult>;
}> {
  const results: Record<string, LegalDocumentAnalysisResult> = {};
  let allDocuments: string[] = [];
  
  try {
    // Get all documents in directory
    const files = fs.readdirSync(directoryPath);
    
    for (const file of files) {
      if (file.endsWith('.txt') || file.endsWith('.md') || file.endsWith('.pdf')) {
        const filePath = path.join(directoryPath, file);
        
        // Determine document type based on filename
        let documentType: DocumentType = 'legal';
        if (file.includes('court') || file.includes('filing')) documentType = 'court';
        else if (file.includes('text') || file.includes('sms')) documentType = 'text_message';
        else if (file.includes('email') || file.includes('communication')) documentType = 'communication';
        else if (file.includes('business') || file.includes('operation')) documentType = 'business';
        
        // Analyze each document
        try {
          const result = await analyzeDocumentFile(filePath, documentType);
          results[file] = result;
          allDocuments.push(file);
        } catch (err) {
          console.error(`Failed to analyze ${file}:`, err);
          results[file] = createErrorAnalysisResult(
            `Error analyzing document: ${err instanceof Error ? err.message : 'Unknown error'}`,
            documentType,
            'document',
            getRuleSetsForLocation({ state: 'Illinois', city: 'Chicago' })
          );
        }
      }
    }
    
    // Generate overall summary of all documents
    const overallSummary = await generateOverallSummary(results, allDocuments);
    
    return {
      overallSummary,
      documentResults: results
    };
  } catch (error) {
    console.error(`Error analyzing document directory at ${directoryPath}:`, error);
    throw new Error(`Failed to analyze document directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate an overall summary of multiple document analyses
 */
async function generateOverallSummary(
  results: Record<string, LegalDocumentAnalysisResult>,
  documentNames: string[]
): Promise<string> {
  try {
    // Create a condensed version of the results for the summary
    const condensedResults = documentNames.map((doc) => {
      const result = results[doc];
      const complianceSummaries = [
        ...result.complianceFindings.federal,
        ...result.complianceFindings.state,
        ...result.complianceFindings.local
      ].map((finding) => ({
        jurisdiction: finding.jurisdiction,
        level: finding.level,
        status: finding.complianceStatus,
        keyFindings: finding.keyFindings.slice(0, 2),
        recommendations: finding.recommendations.slice(0, 1)
      }));

      return {
        document: doc,
        summary: result.summary,
        complianceSummaries,
        missingInformation: result.factCheck.missingInformation,
        inconsistencies: result.factCheck.inconsistencies,
        landlordActions: result.actionItems.landlord.slice(0, 2),
        tenantActions: result.actionItems.tenant.slice(0, 2)
      };
    });
    
    const completion = await openai.chat.completions.create({
      messages: [
        { 
          role: "system", 
          content: "You are a legal portfolio analyst specializing in document summarization." 
        },
        { 
          role: "user", 
          content: `Generate an executive summary of these analyzed documents related to ARIAS V BIANCHI:
          
          ${JSON.stringify(condensedResults, null, 2)}

          Provide a comprehensive but concise overall analysis summarizing recurring compliance risks,
          jurisdictions with the greatest exposure, and fact gaps that require follow-up.
          Call out whether recommended actions are primarily landlord- or tenant-facing.`
        }
      ],
      model: "gpt-3.5-turbo",
      temperature: 0.3
    });
    
    return completion.choices[0].message.content || 'Unable to generate overall summary.';
  } catch (error) {
    console.error("Error generating overall summary:", error);
    return "Unable to generate an overall summary of the documents at this time.";
  }
}