import assert from 'node:assert';

interface DocumentFile {
  fileName: string;
  category: string;
  subcategory?: string;
}

const categories = ['legal', 'communication', 'financial', 'general'] as const;

const files: DocumentFile[] = [
  { fileName: 'legal-brief.pdf', category: 'legal' },
  { fileName: 'email-thread.txt', category: 'communication' },
  { fileName: 'balance-sheet.xlsx', category: 'financial' },
  { fileName: 'case-notes.md', category: 'general' },
  { fileName: 'motion-to-dismiss.pdf', category: 'legal' },
];

const filterFilesByCategory = (category: string) => {
  if (category === 'all') {
    return files;
  }

  return files.filter(file => file.category === category);
};

for (const category of categories) {
  const filtered = filterFilesByCategory(category);

  assert(
    filtered.length > 0,
    `Filtering by category "${category}" should return at least one item.`
  );

  assert(
    filtered.every(file => file.category === category),
    `All filtered files should belong to the "${category}" category.`
  );
}

const allFiltered = filterFilesByCategory('all');
assert.strictEqual(allFiltered.length, files.length, 'Selecting "all" should return every file.');

console.log('Document filtering checks passed for all categories.');
