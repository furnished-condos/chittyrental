
import { Client } from '@replit/object-storage';
import { analyzeLegalDocument } from './analysis';

interface OrganizedDocument {
  fileName: string;
  originalPath: string;
  newPath: string;
  category: string;
  analysisResult?: any;
}

interface DocumentFileSummary {
  path: string;
  category: string;
  subcategory?: string;
  dateAdded: string;
  fileName: string;
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
      const category = this.categorizeDocument(file.name);
      const newPath = this.generateLegalPath(file.name, category);
      
      // Download file content
      const content = await this.objectStorage.downloadAsText(file.name);
      if (!content.ok) continue;

      // Upload to new path
      await this.objectStorage.uploadFromText(newPath, content.value);
      
      // Delete old file
      await this.objectStorage.delete(file.name);

      // Add to organized list
      organizedDocs.push({
        fileName: file.name,
        originalPath: file.name,
        newPath,
        category
      });
    }

    return organizedDocs;
  }

  private categorizeDocument(fileName: string): string {
    const lowerName = fileName.toLowerCase();
    if (lowerName.includes('legal') || lowerName.includes('court')) return 'legal';
    if (lowerName.includes('communication')) return 'communication';
    if (lowerName.includes('financial')) return 'financial';
    return 'general';
  }

  private generateLegalPath(fileName: string, category: string): string {
    const date = new Date().toISOString().split('T')[0];
    const sanitizedName = fileName
      .replace(/[^a-zA-Z0-9-_.]/g, '_')
      .toLowerCase();

    return `ARIAS_V_BIANCHI/${category}/${date}/${sanitizedName}`;
  }

  async listOrganizedFiles(): Promise<DocumentFileSummary[]> {
    const files = await this.objectStorage.list();
    if (!files.ok) {
      throw new Error('Failed to list files');
    }

    return files.value
      .filter(file => file.name.startsWith('ARIAS_V_BIANCHI/'))
      .map(file => {
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
}
