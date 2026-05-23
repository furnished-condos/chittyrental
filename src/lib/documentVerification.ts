export type VerificationSeverity = "blocker" | "warning" | "info";

export interface VerificationFinding {
  code: string;
  severity: VerificationSeverity;
  message: string;
  detail?: string;
}

export interface VerifyDocumentTemplateInput {
  title?: string | null;
  text: string;
  artifactType?: string | null;
  editIntent?: string | null;
  mutationPolicy?: string | null;
}

export interface VerificationResult {
  status: "passed" | "warn" | "blocked";
  blockerCount: number;
  warningCount: number;
  findings: VerificationFinding[];
  sectionKeys: string[];
  placeholderKeys: string[];
  anchorKeys: string[];
  metadata: Record<string, unknown>;
}

const SECTION_LINE_RE = /^(?:#{1,6}\s*)?(\d+(?:\.\d+)*)(?:[.)])?\s+[A-Z0-9]/;
const SECTION_REF_RE = /\bSection\s+(\d+(?:\.\d+)*)\b/gi;
const PLACEHOLDER_RE = /\[([A-Za-z0-9_#]+)\]/g;
const ANCHOR_RE = /\\([A-Za-z0-9_#]+)\\/g;
const ILLEGAL_CHECKBOX_RE = /☑|☒|\[[xX]\]/g;
const CONDITIONAL_RE = /{{#if\s+([^}]+)}}|{{\/if}}/g;
const FOOTER_TETHER = "Appended to: [Master_Lease_Title] - [Property_Address_Short] - [Lease_Start_Date]";

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function severityCounts(findings: VerificationFinding[]) {
  return {
    blockerCount: findings.filter((finding) => finding.severity === "blocker").length,
    warningCount: findings.filter((finding) => finding.severity === "warning").length,
  };
}

function collectRegexMatches(text: string, re: RegExp): string[] {
  const values: string[] = [];
  const matcher = new RegExp(re.source, re.flags);
  for (const match of text.matchAll(matcher)) {
    if (match[1]) values.push(match[1]);
  }
  return uniqueSorted(values);
}

function collectSectionKeys(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const keys: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(SECTION_LINE_RE);
    if (match?.[1]) keys.push(match[1]);
  }

  return uniqueSorted(keys);
}

export function verifyDocumentTemplate(input: VerifyDocumentTemplateInput): VerificationResult {
  const text = input.text ?? "";
  const findings: VerificationFinding[] = [];
  const sectionKeys = collectSectionKeys(text);
  const placeholderKeys = collectRegexMatches(text, PLACEHOLDER_RE);
  const anchorKeys = collectRegexMatches(text, ANCHOR_RE);

  const conditionalStack: Array<{ clause: string; line: number }> = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const matcher = new RegExp(CONDITIONAL_RE.source, CONDITIONAL_RE.flags);
    for (const match of line.matchAll(matcher)) {
      if (match[1]) {
        conditionalStack.push({ clause: match[1].trim(), line: index + 1 });
      } else if (match[0] === "{{/if}}") {
        if (conditionalStack.length === 0) {
          findings.push({
            code: "conditional.orphan_close",
            severity: "blocker",
            message: "Found a closing {{/if}} tag without a matching opening tag.",
            detail: `Line ${index + 1}`,
          });
        } else {
          conditionalStack.pop();
        }
      }
    }
  });

  for (const unclosed of conditionalStack) {
    findings.push({
      code: "conditional.unclosed",
      severity: "blocker",
      message: `Conditional block '{{#if ${unclosed.clause}}}' is missing a closing {{/if}} tag.`,
      detail: `Opened on line ${unclosed.line}`,
    });
  }

  const referencedSections = collectRegexMatches(text, SECTION_REF_RE);
  const sectionSet = new Set(sectionKeys);
  for (const reference of referencedSections) {
    if (!sectionSet.has(reference)) {
      findings.push({
        code: "reference.missing_section",
        severity: "blocker",
        message: `Document references Section ${reference}, but no matching section heading was found.`,
      });
    }
  }

  const checkboxSeverity: VerificationSeverity = input.artifactType === "executed_source" ? "warning" : "blocker";
  for (const match of text.match(ILLEGAL_CHECKBOX_RE) ?? []) {
    findings.push({
      code: "selection.preselected",
      severity: checkboxSeverity,
      message: `Found a preselected checkbox or radio marker ('${match}') that should be reset before template release.`,
    });
  }

  const footerSeverity: VerificationSeverity =
    input.artifactType === "external_disclosure" ||
    input.mutationPolicy === "overlay_only" ||
    input.mutationPolicy === "append_only" ||
    input.artifactType === "executed_source"
      ? "warning"
      : "blocker";

  if (!text.includes(FOOTER_TETHER)) {
    findings.push({
      code: "footer.missing_tether",
      severity: footerSeverity,
      message: "Packet tether footer is missing. Appended documents must preserve the 'Appended to:' reference chain.",
      detail: FOOTER_TETHER,
    });
  }

  if ((input.editIntent ?? "") !== "overlay_only" && placeholderKeys.length === 0) {
    findings.push({
      code: "placeholder.none_detected",
      severity: "warning",
      message: "No placeholders were detected. Confirm that hardcoded names, dates, and deal terms were replaced before release.",
    });
  }

  const tenant2Mentioned = /\[Tenant_2_[A-Za-z0-9_]+\]/.test(text) || /\\s2\\|\\d2\\/.test(text) || /Tenant 2/i.test(text);
  if (tenant2Mentioned) {
    if (!text.includes("[Tenant_2_Signature_Tag]") && !text.includes("\\s2\\")) {
      findings.push({
        code: "signature.tenant2_missing_signature",
        severity: "blocker",
        message: "Tenant 2 appears in the document, but no Tenant 2 signature anchor was found.",
      });
    }
    if (!text.includes("[Tenant_2_Date_Tag]") && !text.includes("\\d2\\")) {
      findings.push({
        code: "signature.tenant2_missing_date",
        severity: "blocker",
        message: "Tenant 2 appears in the document, but no Tenant 2 date anchor was found.",
      });
    }
  }

  if (text.includes("[Tenant_1_Name_Tag]")) {
    if (!text.includes("[Tenant_1_Signature_Tag]") && !text.includes("\\s1\\")) {
      findings.push({
        code: "signature.tenant1_missing_signature",
        severity: "blocker",
        message: "Tenant 1 printed name anchor exists, but the Tenant 1 signature anchor is missing.",
      });
    }
    if (!text.includes("[Tenant_1_Date_Tag]") && !text.includes("\\d1\\")) {
      findings.push({
        code: "signature.tenant1_missing_date",
        severity: "blocker",
        message: "Tenant 1 printed name anchor exists, but the Tenant 1 date anchor is missing.",
      });
    }
  }

  if (text.includes("[Landlord_Signer_Name_Tag]")) {
    if (!text.includes("[Landlord_Signature_Tag]") && !text.includes("\\sL\\")) {
      findings.push({
        code: "signature.landlord_missing_signature",
        severity: "blocker",
        message: "Landlord printed name anchor exists, but the landlord signature anchor is missing.",
      });
    }
    if (!text.includes("[Landlord_Date_Tag]") && !text.includes("\\dL\\")) {
      findings.push({
        code: "signature.landlord_missing_date",
        severity: "blocker",
        message: "Landlord printed name anchor exists, but the landlord date anchor is missing.",
      });
    }
  }

  const { blockerCount, warningCount } = severityCounts(findings);
  const status: VerificationResult["status"] = blockerCount > 0 ? "blocked" : warningCount > 0 ? "warn" : "passed";

  return {
    status,
    blockerCount,
    warningCount,
    findings,
    sectionKeys,
    placeholderKeys,
    anchorKeys,
    metadata: {
      title: input.title ?? null,
      artifactType: input.artifactType ?? null,
      editIntent: input.editIntent ?? null,
      mutationPolicy: input.mutationPolicy ?? null,
      sectionCount: sectionKeys.length,
      referenceCount: referencedSections.length,
      placeholderCount: placeholderKeys.length,
      anchorCount: anchorKeys.length,
      lineCount: lines.length,
      characterCount: text.length,
    },
  };
}
