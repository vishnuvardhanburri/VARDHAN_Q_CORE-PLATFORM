export class CSVParser {
  static parse(content: string): Array<{ name: string; domain: string }> {
    const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');
    if (lines.length === 0) return [];

    const results: Array<{ name: string; domain: string }> = [];
    // Skip header
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const fields = this.parseCSVLine(line);
      
      // The dataset.csv structure:
      // 0: id, 1: ranking, 2: temp_rank, 3: prev_rank, 4: company_name, ..., 14: url
      if (fields.length >= 15) {
        const name = fields[4]?.trim();
        const domain = fields[14]?.trim();
        
        if (name && domain) {
          results.push({ name, domain });
        }
      }
    }
    return results;
  }

  private static parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }
}
