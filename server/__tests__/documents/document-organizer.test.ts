import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import path from 'path';
import { DocumentOrganizer } from '../../services/document-organizer';

interface Result<T> {
  ok: boolean;
  value?: T;
  error?: Error | string;
}

class MockStorageClient {
  private store = new Map<string, Buffer>();

  async uploadFromFilename(objectName: string, srcFilename: string): Promise<Result<null>> {
    const data = await fs.readFile(srcFilename);
    this.store.set(objectName, data);
    return { ok: true, value: null };
  }

  async downloadToFilename(objectName: string, destFilename: string): Promise<Result<null>> {
    const data = this.store.get(objectName);
    if (!data) {
      return { ok: false, error: new Error('Not found') };
    }

    await fs.writeFile(destFilename, data);
    return { ok: true, value: null };
  }

  async downloadAsText(objectName: string): Promise<Result<string>> {
    const data = this.store.get(objectName);
    if (!data) {
      return { ok: false, error: new Error('Not found') };
    }

    return { ok: true, value: data.toString('utf8') };
  }

  async uploadFromText(objectName: string, contents: string): Promise<Result<null>> {
    this.store.set(objectName, Buffer.from(contents));
    return { ok: true, value: null };
  }

  async delete(objectName: string): Promise<Result<null>> {
    this.store.delete(objectName);
    return { ok: true, value: null };
  }

  async list(): Promise<Result<Array<{ name: string }>>> {
    return { ok: true, value: Array.from(this.store.keys()).map((name) => ({ name })) };
  }
}

function fileExists(target: string): Promise<boolean> {
  return fs
    .access(target)
    .then(() => true)
    .catch(() => false);
}

describe('DocumentOrganizer helpers', () => {
  let organizer: DocumentOrganizer;
  let tempDir: string;
  let storage: MockStorageClient;

  beforeEach(async () => {
    storage = new MockStorageClient();
    organizer = new DocumentOrganizer(storage as unknown as any);
    tempDir = path.join(process.cwd(), 'temp-tests');
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('uploads, downloads, and parses text content round trip', async () => {
    const sourceFile = path.join(tempDir, 'Lease Agreement.txt');
    const originalContent = 'Lease Agreement between Landlord and Tenant.';
    await fs.writeFile(sourceFile, originalContent, 'utf8');

    const cleanedName = organizer.cleanupFilename('Lease Agreement!.TXT');
    expect(cleanedName).toBe('lease_agreement.txt');

    const storageKey = `ARIAS_V_BIANCHI/legal/contracts/${cleanedName}`;
    await organizer.uploadFile(sourceFile, storageKey, { cleanup: true });

    expect(await fileExists(sourceFile)).toBe(false);

    const downloadResult = await organizer.downloadFile(storageKey);
    const parsed = await organizer.parseFileContent({ localPath: downloadResult.filePath, cleanup: true });
    await downloadResult.cleanup();

    expect(parsed.textContent).toContain('Lease Agreement');
    expect(parsed.isBinary).toBe(false);

    const detectedCategory = organizer.categorizeDocument('Agreement.pdf', parsed.textContent);
    expect(detectedCategory).toBe('legal/contracts');

    const packagePath = await organizer.createPackage([storageKey], 'CaseFiles', {
      includeMetadata: true,
      password: 'secret',
    });

    const extracted = await organizer.extractPackage(packagePath, { password: 'secret' });
    expect(extracted).toHaveLength(1);

    const extractedContent = await fs.readFile(extracted[0].path, 'utf8');
    expect(extractedContent).toBe(originalContent);
  });
});
