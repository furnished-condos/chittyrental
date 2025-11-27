import { Client } from '@replit/object-storage';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import crypto from 'crypto';

interface OrganizedDocument {
  fileName: string;
  originalPath: string;
  newPath: string;
  category: string;
  analysisResult?: any;
}

interface UploadOptions {
  cleanup?: boolean;
}

interface DownloadedFile {
  filePath: string;
  fileName: string;
  cleanup: () => Promise<void>;
}

interface ParseInput {
  storageKey?: string;
  localPath?: string;
  cleanup?: boolean;
  fileName?: string;
}

interface ParsedFileContent {
  fileName: string;
  size: number;
  textContent?: string;
  isBinary: boolean;
  storageKey?: string;
}

interface PackageOptions {
  compress?: boolean;
  includeMetadata?: boolean;
  password?: string;
}

interface ExtractOptions {
  password?: string;
  onlyFiles?: string[];
  excludeFiles?: string[];
}

interface PackageEntry {
  fileName: string;
  storageKey?: string;
  size: number;
  data: string;
  metadata?: Record<string, unknown>;
}

interface PackagePayload {
  version: number;
  createdAt: string;
  options: {
    compress: boolean;
    includeMetadata: boolean;
  };
  passwordHash?: string;
  files: PackageEntry[];
}

export class DocumentOrganizer {
  private objectStorage: Client;
  private tempDir: string;

  constructor(client: Client = new Client()) {
    this.objectStorage = client;
    this.tempDir = path.join(process.cwd(), 'temp');
  }

  async organizeDocuments(): Promise<OrganizedDocument[]> {
    const organizedDocs: OrganizedDocument[] = [];
    const files = await this.objectStorage.list();

    if (!files.ok) {
      throw new Error('Failed to list files');
    }

    for (const file of files.value) {
      const category = this.categorizeDocument(file.name);
      const newPath = this.generateLegalPath(file.name, category);

      const content = await this.objectStorage.downloadAsText(file.name);
      if (!content.ok) continue;

      await this.objectStorage.uploadFromText(newPath, content.value);
      await this.objectStorage.delete(file.name);

      organizedDocs.push({
        fileName: file.name,
        originalPath: file.name,
        newPath,
        category
      });
    }

    return organizedDocs;
  }

  public categorizeDocument(fileName: string, fileContent?: string): string {
    if (!fileName) return 'general';
    const lowerName = fileName.toLowerCase();
    const ext = path.extname(lowerName);

    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
      if (lowerName.includes('logo') || lowerName.includes('brand')) {
        return 'media/branding';
      }
      if (lowerName.includes('property') || lowerName.includes('building') || lowerName.includes('apartment')) {
        return 'media/property_photos';
      }
      if (lowerName.includes('document') || lowerName.includes('scan')) {
        return 'media/document_scans';
      }
      return 'media/other';
    }

    if (['.pdf', '.doc', '.docx', '.txt', '.md'].includes(ext)) {
      if (lowerName.includes('lease') || lowerName.includes('agreement') || lowerName.includes('contract') || lowerName.includes('terms')) {
        return 'legal/contracts';
      }
      if (lowerName.includes('court') || lowerName.includes('filing') || lowerName.includes('case') || lowerName.includes('lawsuit')) {
        return 'court/filings';
      }
      if (lowerName.includes('business') || lowerName.includes('report') || lowerName.includes('company')) {
        return 'legal/business_documents';
      }
      if (lowerName.includes('email') || lowerName.includes('message') || lowerName.includes('communication')) {
        return 'communication/client';
      }
      if (lowerName.includes('invoice') || lowerName.includes('receipt') || lowerName.includes('payment') || lowerName.includes('financial')) {
        return 'financial/documents';
      }

      if (fileContent) {
        const lowerContent = fileContent.toLowerCase();
        if (lowerContent.includes('agreement') || lowerContent.includes('contract') || lowerContent.includes('legal') || lowerContent.includes('terms')) {
          return 'legal/contracts';
        }
        if (lowerContent.includes('court') || lowerContent.includes('case')) {
          return 'court/filings';
        }
        if (lowerContent.includes('financial') || lowerContent.includes('payment') || lowerContent.includes('invoice')) {
          return 'financial/documents';
        }
        if (lowerContent.includes('email') || lowerContent.includes('message')) {
          return 'communication/client';
        }
      }
    }

    const parts = lowerName.split('/');
    if (parts.length > 1) {
      const maybeCategory = parts[1];
      if (['legal', 'communication', 'financial', 'court', 'general', 'media'].some((cat) => maybeCategory.startsWith(cat))) {
        return maybeCategory;
      }
    }

    return 'general';
  }

  public cleanupFilename(fileName: string): string {
    if (!fileName) return 'unknown_file';

    const ext = path.extname(fileName);
    const baseName = path.basename(fileName, ext);

    let cleanName = baseName
      .toLowerCase()
      .replace(/(_|\-)?\d{13,}/g, '')
      .replace(/pasted\-\-/g, '')
      .replace(/pasted\-/g, '')
      .replace(/content\-/g, '')
      .replace(/screenshot\-/g, '')
      .replace(/image\_/g, 'img_')
      .replace(/\s+/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/\-{2,}/g, '-')
      .replace(/_{2,}/g, '_')
      .replace(/[^a-z0-9\-_.]/g, '_')
      .replace(/^[\-_]+|[\-_]+$/g, '');

    if (cleanName.length > 50) {
      cleanName = cleanName.substring(0, 50);
    }

    if (!cleanName || cleanName.length < 3) {
      cleanName = `file_${Date.now()}`;
    }

    return `${cleanName}${ext.toLowerCase()}`;
  }

  public async uploadFile(localPath: string, storageKey: string, options?: UploadOptions): Promise<{ storageKey: string; size: number }> {
    const stats = await fsPromises.stat(localPath);
    const upload = await this.objectStorage.uploadFromFilename(storageKey, localPath);

    if (!upload.ok) {
      throw new Error(upload.error instanceof Error ? upload.error.message : String(upload.error));
    }

    if (options?.cleanup) {
      await this.safeUnlink(localPath);
    }

    return { storageKey, size: stats.size };
  }

  public async cleanupLocalFile(filePath: string): Promise<void> {
    await this.safeUnlink(filePath);
  }

  public async downloadFile(storageKey: string): Promise<DownloadedFile> {
    const tempDir = await this.ensureTempDir();
    const fileName = path.basename(storageKey);
    const tempPath = path.join(tempDir, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${fileName}`);

    const download = await this.objectStorage.downloadToFilename(storageKey, tempPath);
    if (!download.ok) {
      await this.safeUnlink(tempPath);
      throw new Error(download.error instanceof Error ? download.error.message : String(download.error));
    }

    return {
      filePath: tempPath,
      fileName,
      cleanup: async () => {
        await this.safeUnlink(tempPath);
      }
    };
  }

  public async parseFileContent(input: ParseInput): Promise<ParsedFileContent> {
    if (!input.localPath && !input.storageKey) {
      throw new Error('Either localPath or storageKey must be provided');
    }

    let workingPath = input.localPath;
    let cleanupDownload: (() => Promise<void>) | undefined;

    if (input.storageKey) {
      const download = await this.downloadFile(input.storageKey);
      workingPath = download.filePath;
      cleanupDownload = download.cleanup;
    }

    if (!workingPath) {
      throw new Error('Unable to resolve file path for parsing');
    }

    const buffer = await fsPromises.readFile(workingPath);
    const isBinary = this.isBinaryContent(buffer);
    const textContent = !isBinary ? buffer.toString('utf8') : undefined;

    if (input.cleanup) {
      await this.safeUnlink(workingPath);
    }

    if (cleanupDownload) {
      await cleanupDownload();
    }

    const resolvedName = input.fileName ?? (input.storageKey ? path.basename(input.storageKey) : path.basename(workingPath));

    return {
      fileName: resolvedName,
      size: buffer.length,
      textContent,
      isBinary,
      storageKey: input.storageKey
    };
  }

  async listOrganizedFiles(): Promise<DocumentFileSummary[]> {
    const files = await this.objectStorage.list();
    if (!files.ok) {
      throw new Error('Failed to list files');
    }

    return files.value
      .filter((file) => file.name.startsWith('ARIAS_V_BIANCHI/'))
      .map((file) => {
        const parts = file.name.split('/');
        const fileName = parts[parts.length - 1];
        const category = (parts[1] || 'unknown').toLowerCase();
        const potentialDate = parts.length > 2 ? parts[parts.length - 2] : undefined;
        const datePattern = /^\d{4}-\d{2}-\d{2}$/;
        const dateAdded = potentialDate && datePattern.test(potentialDate) ? potentialDate : 'unknown';

        let subcategory: string | undefined;
        if (dateAdded !== 'unknown') {
          const subcategorySegments = parts.slice(2, parts.length - 2);
          if (subcategorySegments.length > 0) {
            subcategory = subcategorySegments.join('/').toLowerCase();
          }
        } else {
          const subcategorySegments = parts.slice(2, parts.length - 1);
          if (subcategorySegments.length > 0) {
            subcategory = subcategorySegments.join('/').toLowerCase();
          }
        }

        return {
          path: file.name,
          category,
          subcategory,
          dateAdded,
          fileName
        };
      });
  }

  private async resolveReference(reference: string): Promise<{ buffer: Buffer; sourceFileName: string; storageKey?: string }> {
    if (await this.fileExists(reference)) {
      const buffer = await fsPromises.readFile(reference);
      return { buffer, sourceFileName: path.basename(reference) };
    }

    const download = await this.downloadFile(reference);
    try {
      const buffer = await fsPromises.readFile(download.filePath);
      return { buffer, sourceFileName: download.fileName, storageKey: reference };
    } finally {
      await download.cleanup();
    }
  }

  private async ensureTempDir(): Promise<string> {
    await fsPromises.mkdir(this.tempDir, { recursive: true });
    return this.tempDir;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fsPromises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async safeUnlink(filePath: string): Promise<void> {
    try {
      await fsPromises.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  private isBinaryContent(buffer: Buffer): boolean {
    const len = Math.min(buffer.length, 1024);
    for (let i = 0; i < len; i += 1) {
      const charCode = buffer[i];
      if (charCode === 0) {
        return true;
      }
    }
    return false;
  }

  private generateLegalPath(fileName: string, category: string): string {
    const date = new Date().toISOString().split('T')[0];
    const sanitizedName = this.cleanupFilename(path.basename(fileName));
    return `ARIAS_V_BIANCHI/${category}/${date}/${sanitizedName}`;
  }
}
