import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import {
  analyzeLegalDocument,
  ComplianceAnalysisOptions,
  ExtractedFacts,
  LegalDocumentAnalysisResult
} from '../services/analysis';
import { listRegisteredRuleSets } from '../services/compliance/rules';

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/compliance');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.txt', '.md', '.pdf', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload text or document files only.') as any);
    }
  }
});

const router = Router();

type AnalyzeRequestBody = {
  documentText?: string;
  state?: string;
  city?: string;
  documentType?: string;
  sessionFacts?: ExtractedFacts[] | string;
};

type SituationalRequestBody = {
  scenario: string;
  state?: string;
  city?: string;
  sessionFacts?: ExtractedFacts[] | string;
};

function coerceSessionFacts(input?: ExtractedFacts[] | string): ExtractedFacts[] | undefined {
  if (!input) return undefined;
  if (Array.isArray(input)) {
    return input as ExtractedFacts[];
  }
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? (parsed as ExtractedFacts[]) : undefined;
  } catch (error) {
    console.warn('Failed to parse sessionFacts payload:', error);
    return undefined;
  }
}

function buildOptions(
  body: AnalyzeRequestBody | SituationalRequestBody,
  overrides: Partial<ComplianceAnalysisOptions>
): ComplianceAnalysisOptions {
  return {
    state: body.state ?? overrides.state ?? 'Illinois',
    city: body.city ?? overrides.city ?? 'Chicago',
    origin: overrides.origin ?? 'document',
    documentName: overrides.documentName,
    sessionFacts: coerceSessionFacts('sessionFacts' in body ? body.sessionFacts : undefined)
  };
}

router.get('/rules', (req: Request, res: Response) => {
  try {
    res.json({ ruleSets: listRegisteredRuleSets() });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load compliance rules',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post(
  '/analyze',
  upload.single('document'),
  async (
    req: Request<{}, LegalDocumentAnalysisResult, AnalyzeRequestBody> & { file?: Express.Multer.File },
    res: Response
  ) => {
  try {
    let documentText = req.body?.documentText;
    const documentType = (req.body?.documentType as string) || 'legal';

    if (req.file) {
      documentText = fs.readFileSync(req.file.path, 'utf8');
    }

    if (!documentText || !documentText.trim()) {
      return res.status(400).json({
        error: 'Document content is required',
        message: 'Provide documentText in the request body or upload a file.'
      });
    }

    const options = buildOptions(req.body ?? {}, {
      origin: 'document',
      documentName: req.file?.originalname || req.body?.documentType || 'uploaded-document'
    });

    const result = await analyzeLegalDocument(documentType as any, documentText, options);
    res.json(result);
  } catch (error) {
    console.error('Error performing compliance document analysis:', error);
    res.status(500).json({
      error: 'Failed to analyze document',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    if (req.file) {
      fs.unlink(req.file.path, () => undefined);
    }
  }
});

router.post(
  '/situational',
  async (
    req: Request<{}, LegalDocumentAnalysisResult, SituationalRequestBody>,
    res: Response
  ) => {
  try {
    if (!req.body?.scenario || !req.body.scenario.trim()) {
      return res.status(400).json({
        error: 'Scenario text is required',
        message: 'Provide a scenario string describing the gut check you need.'
      });
    }

    const options = buildOptions(req.body, {
      origin: 'situational',
      documentName: 'situational-prompt'
    });

    const result = await analyzeLegalDocument('legal', req.body.scenario, options);
    res.json(result);
  } catch (error) {
    console.error('Error performing situational compliance analysis:', error);
    res.status(500).json({
      error: 'Failed to evaluate scenario',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
