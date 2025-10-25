
import { Client } from '@replit/object-storage';
import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const DocumentCategories = {
  LEGAL: 'legal',
  COMMUNICATION: 'communication',
  FINANCIAL: 'financial',
  GENERAL: 'general'
} as const;

type DocumentCategory = (typeof DocumentCategories)[keyof typeof DocumentCategories];

interface OrganizedDocument {
  fileName: string;
  originalPath: string;
  newPath: string;
  category: DocumentCategory;
  subcategory?: string;
}

interface DocumentPackageOptions {
  compress?: boolean;
  includeMetadata?: boolean;
  password?: string;
}

interface ExtractPackageOptions {
  password?: string;
  onlyFiles?: string[];
  excludeFiles?: string[];
}

interface ParsedDocumentResult {
  fileName: string;
  extension: string;
  size: number;
  categoryGuess: DocumentCategory;
  textPreview?: string;
  metadata?: Record<string, unknown>;
}

export class DocumentOrganizer {
  private objectStorage: Client;

  constructor() {
    this.objectStorage = new Client();
  }

  async organizeDocuments(): Promise<OrganizedDocument[]> {
    const organizedDocs: OrganizedDocument[] = [];
    const files = await this.objectStorage.list();

    if (!files.ok) {
      throw new Error('Failed to list files');
    }

    for (const file of files.value) {
      const { localPath, cleanup } = await this.resolveToLocalFile(file.name);

      try {
        const fileContent = await fs.promises.readFile(localPath, 'utf8').catch(() => '');
        const category = this.categorizeDocument(file.name, fileContent);
        const newPath = this.generateLegalPath(file.name, category);

        const uploadResult = await this.objectStorage.uploadFromFilename(newPath, localPath);
        if (!uploadResult.ok) {
          throw new Error(uploadResult.error?.message ?? 'Failed to upload reorganized file');
        }

        await this.objectStorage.delete(file.name);

        organizedDocs.push({
          fileName: path.basename(file.name),
          originalPath: file.name,
          newPath,
          category
        });
      } finally {
        await cleanup();
      }
    }

    return organizedDocs;
  }

  categorizeDocument(fileName: string, fileContent = ''): DocumentCategory {
    const combined = `${fileName}\n${fileContent}`.toLowerCase();

    if (/(lease|eviction|notice|rtlo|tenan(t|cy)|landlord|compliance|policy)/.test(combined)) {
      return DocumentCategories.LEGAL;
    }

    if (/(email|communication|chat|message|call|correspondence|inquiry)/.test(combined)) {
      return DocumentCategories.COMMUNICATION;
    }

    if (/(invoice|payment|receipt|rent|deposit|financial|statement|balance)/.test(combined)) {
      return DocumentCategories.FINANCIAL;
    }

    return DocumentCategories.GENERAL;
  }

  cleanupFilename(filename: string): string {
    const name = filename.trim().replace(/\s+/g, '_');
    const sanitized = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    if (!path.extname(sanitized)) {
      return `${sanitized}.txt`;
    }
    return sanitized.toLowerCase();
  }

  private generateLegalPath(fileName: string, category: DocumentCategory): string {
    const date = new Date().toISOString().split('T')[0];
    const sanitizedName = this.cleanupFilename(path.basename(fileName));

    return `ARIAS_V_BIANCHI/${category}/${date}/${sanitizedName}`;
  }

  async uploadFile(localPath: string, storageKey: string): Promise<void> {
    const uploadResult = await this.objectStorage.uploadFromFilename(storageKey, localPath);
    if (!uploadResult.ok) {
      throw new Error(uploadResult.error?.message ?? 'Failed to upload file');
    }
  }

  async downloadFile(storageKey: string, destinationPath: string): Promise<void> {
    const parentDir = path.dirname(destinationPath);
    await fs.promises.mkdir(parentDir, { recursive: true });
    const downloadResult = await this.objectStorage.downloadToFilename(storageKey, destinationPath);
    if (!downloadResult.ok) {
      throw new Error(downloadResult.error?.message ?? 'Failed to download file');
    }
  }

  async parseFileContent(filePath: string): Promise<ParsedDocumentResult> {
    const { localPath, cleanup } = await this.resolveToLocalFile(filePath);
    try {
      const stats = await fs.promises.stat(localPath);
      const extension = path.extname(localPath).toLowerCase();
      const baseName = path.basename(localPath);

      const textExtensions = ['.txt', '.md', '.csv', '.json', '.xml'];
      let textPreview: string | undefined;
      let metadata: Record<string, unknown> | undefined;

      if (textExtensions.includes(extension)) {
        const raw = await fs.promises.readFile(localPath, 'utf8');
        textPreview = raw.slice(0, 4000);

        if (extension === '.json') {
          try {
            metadata = JSON.parse(raw);
          } catch {
            metadata = { parseError: 'Invalid JSON structure' };
          }
        }

        if (extension === '.csv') {
          const rows = raw.split(/\r?\n/).filter(Boolean);
          const header = rows.shift();
          metadata = {
            rows: rows.length,
            header
          };
        }
      } else if (extension === '.pdf' || extension === '.docx') {
        metadata = { note: 'Binary document parsing is not supported in preview. Download for full review.' };
      } else if (['.jpg', '.jpeg', '.png'].includes(extension)) {
        metadata = { note: 'Image document detected. Preview not generated.' };
      }

      return {
        fileName: baseName,
        extension,
        size: stats.size,
        categoryGuess: this.categorizeDocument(baseName, textPreview ?? ''),
        textPreview,
        metadata
      };
    } finally {
      await cleanup();
    }
  }

  async createPackage(
    filePaths: string[],
    packageName: string,
    options: DocumentPackageOptions = {}
  ): Promise<string> {
    const { compress = true, includeMetadata = true, password } = options;

    if (!packageName) {
      throw new Error('Package name is required');
    }

    const zip = new AdmZip();
    if (password) {
      zip.setPassword(password);
    }

    const tempArtifacts: Array<() => Promise<void>> = [];
    const metadataEntries: Array<Record<string, unknown>> = [];

    try {
      for (const filePath of filePaths) {
        const { localPath, cleanup } = await this.resolveToLocalFile(filePath);
        tempArtifacts.push(cleanup);

        const entryName = path.basename(filePath);
        const data = await fs.promises.readFile(localPath);
        const fileStat = await fs.promises.stat(localPath);

        metadataEntries.push({
          source: filePath,
          entryName,
          size: fileStat.size
        });

        const entry = zip.addFile(entryName, data, '', 0o644);
        if (!compress) {
          entry.header.method = 0; // store without compression
          entry.header.compressedSize = data.length;
          entry.header.size = data.length;
        }
      }

      if (includeMetadata) {
        const metadataPayload = {
          createdAt: new Date().toISOString(),
          files: metadataEntries
        };
        zip.addFile('package-metadata.json', Buffer.from(JSON.stringify(metadataPayload, null, 2)));
      }

      const packagesDir = path.join(process.cwd(), 'packages');
      await fs.promises.mkdir(packagesDir, { recursive: true });
      const outputPath = path.join(packagesDir, packageName.endsWith('.zip') ? packageName : `${packageName}.zip`);
      zip.writeZip(outputPath);
      return outputPath;
    } finally {
      for (const cleanup of tempArtifacts) {
        await cleanup();
      }
    }
  }

  async extractPackage(packagePath: string, options: ExtractPackageOptions = {}): Promise<string[]> {
    const { password, onlyFiles, excludeFiles } = options;

    if (!fs.existsSync(packagePath)) {
      throw new Error(`Package file not found at ${packagePath}`);
    }

    const zip = new AdmZip(packagePath);
    if (password) {
      zip.setPassword(password);
    }

    const destinationDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'doc-package-'));
    const extracted: string[] = [];

    const shouldInclude = (entryName: string) => {
      const base = path.basename(entryName);
      if (onlyFiles && !onlyFiles.includes(entryName) && !onlyFiles.includes(base)) {
        return false;
      }
      if (excludeFiles && (excludeFiles.includes(entryName) || excludeFiles.includes(base))) {
        return false;
      }
      return true;
    };

    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (!shouldInclude(entry.entryName)) continue;

      const entryDestination = path.join(destinationDir, entry.entryName);
      await fs.promises.mkdir(path.dirname(entryDestination), { recursive: true });
      const data = entry.getData();
      await fs.promises.writeFile(entryDestination, data);
      extracted.push(entryDestination);
    }

    return extracted;
  }

  async listOrganizedFiles(): Promise<Array<{ path: string; category: DocumentCategory; subcategory?: string; fileName: string; dateAdded: string }>> {
    const files = await this.objectStorage.list();
    if (!files.ok) {
      throw new Error('Failed to list files');
    }

    return files.value
      .filter(file => file.name.startsWith('ARIAS_V_BIANCHI/'))
      .map(file => {
        const parts = file.name.split('/');
        const category = (parts[1]?.toLowerCase() as DocumentCategory) || DocumentCategories.GENERAL;
        let subcategory: string | undefined;
        let dateIndex = 2;

        if (parts[2] && !/^\d{4}-\d{2}-\d{2}$/.test(parts[2])) {
          subcategory = parts[2];
          dateIndex = 3;
        }

        const uploadDate = parts[dateIndex] && /^\d{4}-\d{2}-\d{2}$/.test(parts[dateIndex]) ? parts[dateIndex] : new Date().toISOString().split('T')[0];

        return {
          path: file.name,
          category,
          subcategory,
          dateAdded: uploadDate,
          fileName: parts[parts.length - 1]
        };
      });
  }

  private async resolveToLocalFile(filePath: string): Promise<{ localPath: string; cleanup: () => Promise<void> }> {
    if (await this.fileExists(filePath)) {
      return {
        localPath: filePath,
        cleanup: async () => {}
      };
    }

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'doc-org-'));
    const destination = path.join(tempDir, path.basename(filePath));
    const downloadResult = await this.objectStorage.downloadToFilename(filePath, destination);
    if (!downloadResult.ok) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      throw new Error(downloadResult.error?.message ?? `Unable to download ${filePath}`);
    }

    return {
      localPath: destination,
      cleanup: async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      }
    };
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
