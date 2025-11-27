import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { DocumentOrganizer } from '../services/document-organizer';
import { app } from '../index';

const listOrganizedFilesSpy = jest.spyOn(DocumentOrganizer.prototype, 'listOrganizedFiles');
const uploadFileSpy = jest.spyOn(DocumentOrganizer.prototype, 'uploadFile');
const downloadFileSpy = jest.spyOn(DocumentOrganizer.prototype, 'downloadFile');
const parseFileContentSpy = jest.spyOn(DocumentOrganizer.prototype, 'parseFileContent');
const createPackageSpy = jest.spyOn(DocumentOrganizer.prototype, 'createPackage');
const extractPackageSpy = jest.spyOn(DocumentOrganizer.prototype, 'extractPackage');

beforeEach(() => {
  jest.clearAllMocks();

  listOrganizedFilesSpy.mockResolvedValue([]);
  uploadFileSpy.mockResolvedValue();
  downloadFileSpy.mockImplementation(async (_storagePath, destinationPath) => {
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.promises.writeFile(destinationPath, 'mock-content');
  });
  parseFileContentSpy.mockResolvedValue({
    fileName: 'document.txt',
    extension: '.txt',
    size: 12,
    categoryGuess: 'legal',
    textPreview: 'mock',
    metadata: { note: 'preview' }
  });
  createPackageSpy.mockResolvedValue(path.join(os.tmpdir(), 'package.zip'));
  extractPackageSpy.mockResolvedValue([path.join(os.tmpdir(), 'doc.txt')]);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('Documents API', () => {
  it('returns organized files with lowercase categories', async () => {
    listOrganizedFilesSpy.mockResolvedValue([
      {
        path: 'ARIAS_V_BIANCHI/legal/lease-agreements/2024-01-01/lease.pdf',
        category: 'legal',
        subcategory: 'lease-agreements',
        dateAdded: '2024-01-01',
        fileName: 'lease.pdf'
      },
      {
        path: 'ARIAS_V_BIANCHI/communication/2024-01-02/email.txt',
        category: 'communication',
        subcategory: undefined,
        dateAdded: '2024-01-02',
        fileName: 'email.txt'
      }
    ]);

    const response = await request(app).get('/api/documents').expect(200);

    expect(response.body.categories).toEqual(['legal', 'communication', 'financial', 'general']);
    expect(response.body.files).toHaveLength(2);
    expect(response.body.groupedFiles.legal['lease-agreements']).toHaveLength(1);
    expect(response.body.groupedFiles.communication.general).toHaveLength(1);
  });

  it('normalizes category and subcategory on upload', async () => {
    const response = await request(app)
      .post('/api/documents/upload')
      .field('category', 'LEGAL')
      .field('subcategory', 'Lease Agreements')
      .attach('document', Buffer.from('Lease content goes here'), 'Lease Agreement.txt')
      .expect(200);

    expect(uploadFileSpy).toHaveBeenCalled();
    const [, storageKey] = uploadFileSpy.mock.calls[0];
    expect(storageKey).toContain('ARIAS_V_BIANCHI/legal/lease-agreements');
    expect(response.body.file.category).toBe('legal');
    expect(response.body.file.subcategory).toBe('lease-agreements');
  });

  it('delegates parsing to the document organizer', async () => {
    const response = await request(app)
      .post('/api/documents/parse')
      .send({ storagePath: 'ARIAS_V_BIANCHI/legal/document.txt' })
      .expect(200);

    expect(parseFileContentSpy).toHaveBeenCalledWith('ARIAS_V_BIANCHI/legal/document.txt');
    expect(response.body.result.fileName).toBe('document.txt');
  });

  it('creates document packages with provided options', async () => {
    const payload = {
      filePaths: ['ARIAS_V_BIANCHI/legal/doc1.txt', 'ARIAS_V_BIANCHI/legal/doc2.txt'],
      packageName: 'bundle',
      compress: false,
      includeMetadata: true
    };

    const response = await request(app)
      .post('/api/documents/package')
      .send(payload)
      .expect(200);

    expect(createPackageSpy).toHaveBeenCalledWith(
      payload.filePaths,
      payload.packageName,
      expect.objectContaining({ compress: payload.compress, includeMetadata: payload.includeMetadata, password: undefined })
    );
    expect(response.body.packagePath).toBeDefined();
  });

  it('extracts documents from a package', async () => {
    const response = await request(app)
      .post('/api/documents/extract')
      .send({ packagePath: path.join(os.tmpdir(), 'package.zip') })
      .expect(200);

    expect(extractPackageSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ password: undefined }));
    expect(response.body.extractedFiles).toHaveLength(1);
  });

  it('streams downloads via the organizer', async () => {
    const response = await request(app)
      .get('/api/documents/download/ARIAS_V_BIANCHI/legal/sample.txt')
      .expect(200);

    expect(downloadFileSpy).toHaveBeenCalledWith('ARIAS_V_BIANCHI/legal/sample.txt', expect.stringContaining('sample.txt'));
    expect(response.header['content-disposition']).toContain('sample.txt');
    expect(response.text).toBe('mock-content');
  });
});
