# Compliance Analysis API

The compliance analysis service evaluates uploaded documents and free-form scenarios for adherence to federal, Illinois, and Chicago housing rules. It performs fact extraction, compares submissions against prior session data, and generates audience-specific action items.

## Rule metadata

`GET /api/compliance/rules`

Returns the registered rule sets available to the analyzer.

```jsonc
{
  "ruleSets": [
    {
      "id": "federal-fair-housing",
      "name": "Fair Housing Act",
      "level": "federal",
      "jurisdiction": "United States",
      "summary": "...",
      "references": ["42 U.S.C. §§ 3601-3619"],
      "topics": [
        {
          "topic": "Advertising and Marketing",
          "description": "...",
          "obligations": [
            { "id": "fha-advertising-1", "audience": "landlord", "requirement": "..." }
          ]
        }
      ]
    }
  ]
}
```

Use this endpoint to populate UI pickers or show rule context to users.

## Document compliance analysis

`POST /api/compliance/analyze`

Accepts either a JSON payload or a multipart form upload.

### JSON payload

```jsonc
{
  "documentText": "Full lease text or excerpt...",
  "documentType": "legal",         // optional, defaults to "legal"
  "state": "Illinois",             // optional
  "city": "Chicago",              // optional
  "sessionFacts": [                // optional cross-document context
    {
      "sourceId": "lease-2023-01",
      "parties": { "landlord": "Acme LLC", "tenants": ["Jane Doe"] },
      "propertyAddress": "123 Main St, Chicago, IL",
      "rentAmount": "$1,800", "securityDeposit": "$1,800",
      "keyDates": [{ "label": "Lease start", "date": "2024-05-01" }]
    }
  ]
}
```

### Multipart upload

Send a `document` file field plus optional text fields (`documentType`, `state`, `city`, `sessionFacts`).

### Response body

```jsonc
{
  "summary": "High-level narrative of the findings",
  "complianceFindings": {
    "federal": [
      {
        "jurisdiction": "United States",
        "level": "federal",
        "ruleSetId": "federal-fair-housing",
        "complianceStatus": "needs_review",
        "summary": "Potential disparate impact in screening language",
        "keyFindings": ["Application fee waiver offered selectively"],
        "risks": ["FHA discrimination exposure"],
        "citations": ["42 U.S.C. § 3604(c)"],
        "recommendations": ["Standardize applicant messaging"]
      }
    ],
    "state": [
      {
        "jurisdiction": "Illinois",
        "level": "state",
        "ruleSetId": "illinois-lt-act",
        "complianceStatus": "non_compliant",
        "summary": "Security deposit timeline violated",
        "keyFindings": ["No itemized statement provided"],
        "risks": ["Statutory damages under 765 ILCS 710"],
        "citations": ["765 ILCS 710/1"],
        "recommendations": ["Issue itemized statement within 30 days"]
      }
    ],
    "local": [ /* Chicago RTLO findings */ ]
  },
  "actionItems": {
    "landlord": [
      {
        "audience": "landlord",
        "priority": "high",
        "item": "Return security deposit within 45 days or document deductions",
        "relatedFindingIds": ["illinois-lt-act"]
      }
    ],
    "tenant": [
      {
        "audience": "tenant",
        "priority": "medium",
        "item": "Request statutory interest for deposits held over 12 months",
        "relatedFindingIds": ["chicago-rtlo"]
      }
    ]
  },
  "factCheck": {
    "extracted": {
      "sourceId": "uploaded-lease.pdf",
      "parties": { "landlord": "Acme LLC", "tenants": ["Jane Doe"] },
      "propertyAddress": "123 Main St, Chicago, IL",
      "rentAmount": "$1,800",
      "securityDeposit": "$1,800",
      "keyDates": [{ "label": "Lease start", "date": "2024-05-01" }],
      "additionalNotes": []
    },
    "missingInformation": ["Missing critical dates."],
    "inconsistencies": [],
    "corroborated": ["Property address matches previous records."]
  },
  "followUpQuestions": ["Confirm whether lead paint disclosures were delivered."],
  "metadata": {
    "documentType": "legal",
    "origin": "document",
    "appliedRuleSets": [ /* same objects returned by /rules */ ]
  }
}
```

## Situational gut check

`POST /api/compliance/situational`

```jsonc
{
  "scenario": "Tenant reported no heat for five days in January...",
  "state": "Illinois",
  "city": "Chicago",
  "sessionFacts": []
}
```

This endpoint routes free-form prompts through the same compliance engine but labels the origin as `situational` so the fact extraction and messaging reflect a narrative rather than a formal document.

## Error responses

400-level errors return `{ "error": string, "message": string }`. Server errors include an additional log entry for observability.

