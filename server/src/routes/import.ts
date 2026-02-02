import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { getDb } from '../db/database.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

// Generate SHA-256 hash of file content
function hashFileContent(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

// Generate a fingerprint from parsed data (catches same data in different files)
function generateDataFingerprint(rows: Array<{ ticketKey: string | null; hours: number }>): string {
  // Sort by ticket key then hours for consistent fingerprinting
  const sorted = [...rows].sort((a, b) => {
    const keyA = a.ticketKey || '';
    const keyB = b.ticketKey || '';
    if (keyA !== keyB) return keyA.localeCompare(keyB);
    return a.hours - b.hours;
  });
  
  // Create a string representation and hash it
  const dataString = sorted.map(r => `${r.ticketKey || 'ADMIN'}:${r.hours}`).join('|');
  return crypto.createHash('sha256').update(dataString).digest('hex');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const importRouter = Router();

importRouter.use(authenticate);

// Configure multer for file uploads
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    cb(null, `${timestamp}_${file.originalname}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// Upload and parse burnt hours Excel file
importRouter.post('/burnt-hours', upload.single('file'), async (req: AuthRequest, res, next) => {
  console.log('=== IMPORT REQUEST RECEIVED ===');
  console.log('User:', req.user);
  console.log('File:', req.file?.originalname);
  try {
    if (!req.file) {
      console.log('ERROR: No file in request');
      throw new AppError(400, 'No file uploaded');
    }
    console.log('File path:', req.file.path);

    const db = getDb();
    const filePath = req.file.path;
    const filename = req.file.originalname;

    // STEP 1: Hash the file content to detect exact duplicate files
    const contentHash = hashFileContent(filePath);
    console.log('Content hash:', contentHash.substring(0, 16) + '...');

    // Check for exact duplicate file (same content, possibly different name)
    const duplicateByContent = db.prepare(`
      SELECT id, filename, imported_at, row_count, total_hours 
      FROM import_batches 
      WHERE content_hash = ? AND is_mock_data = 0
    `).get(contentHash) as { id: number; filename: string; imported_at: string; row_count: number; total_hours: number } | undefined;

    if (duplicateByContent) {
      fs.unlinkSync(filePath);
      throw new AppError(409, `This exact file was already imported on ${duplicateByContent.imported_at} as "${duplicateByContent.filename}" (${duplicateByContent.row_count} rows, ${duplicateByContent.total_hours} hours). Upload rejected to prevent duplicate data.`);
    }

    // Read Excel file
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON
    const rawData = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1,
      defval: '',
    }) as any[][];

    if (rawData.length < 2) {
      fs.unlinkSync(filePath);
      throw new AppError(400, 'Excel file has insufficient data rows');
    }

    // Find the header row by looking for a row containing "jira" or "project" and "hours"
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(rawData.length, 10); i++) {
      const row = rawData[i];
      if (!row) continue;
      const rowText = row.map((cell: any) => String(cell || '').toLowerCase()).join(' ');
      if ((rowText.includes('jira') || rowText.includes('project')) && 
          (rowText.includes('hours') || rowText.includes('billable'))) {
        headerRowIndex = i;
        break;
      }
    }

    // Fallback to row 4 (index 3) if no header found
    if (headerRowIndex === -1) {
      headerRowIndex = 3;
    }

    const headers = rawData[headerRowIndex] as string[];
    const dataRows = rawData.slice(headerRowIndex + 1);

    if (dataRows.length === 0) {
      fs.unlinkSync(filePath);
      throw new AppError(400, 'No data rows found after header row');
    }

    // Find column indices by checking header text
    const colMap = {
      projectName: headers.findIndex(h => h && typeof h === 'string' && h.toLowerCase().includes('project')),
      jiraKey: headers.findIndex(h => h && typeof h === 'string' && h.toLowerCase().includes('jira')),
      taskName: headers.findIndex(h => h && typeof h === 'string' && h.toLowerCase().includes('task')),
      hoursBillable: headers.findIndex(h => h && typeof h === 'string' && (h.toLowerCase().includes('hours') || h.toLowerCase().includes('billable'))),
    };

    // Fallback to positional if headers don't match exactly
    if (colMap.projectName === -1) colMap.projectName = 0;
    if (colMap.jiraKey === -1) colMap.jiraKey = 1;
    if (colMap.taskName === -1) colMap.taskName = 2;
    if (colMap.hoursBillable === -1) colMap.hoursBillable = 3;

    console.log('Column map:', colMap);
    console.log('Data rows count:', dataRows.length);
    console.log('User ID:', req.user!.id);

    // STEP 2: Pre-parse data to generate fingerprint (detect same data in different files)
    const parsedRows: Array<{ ticketKey: string | null; hours: number; project: string; description: string }> = [];
    let tempProject = '';
    
    for (const row of dataRows) {
      if (!row || row.every(cell => cell === '' || cell === null || cell === undefined)) continue;
      
      const projectValue = row[colMap.projectName];
      if (projectValue && typeof projectValue === 'string' && projectValue.trim()) {
        tempProject = projectValue.trim();
      }
      
      const hoursValue = row[colMap.hoursBillable];
      const hours = typeof hoursValue === 'number' ? hoursValue : parseFloat(hoursValue);
      if (isNaN(hours) || hours === 0) continue;
      
      const jiraKey = row[colMap.jiraKey]?.toString().trim() || null;
      const description = row[colMap.taskName]?.toString().trim() || '';
      
      // Skip sum/total rows
      const descLower = description.toLowerCase();
      const projectLower = tempProject.toLowerCase();
      if (descLower === 'sum' || descLower === 'total' || descLower === 'grand total' || 
          descLower.startsWith('total:') || descLower.startsWith('sum:') ||
          descLower === 'subtotal' || descLower.includes('grand total') ||
          projectLower === 'sum' || projectLower === 'total' || projectLower === 'grand total') {
        continue;
      }
      
      parsedRows.push({ ticketKey: jiraKey, hours, project: tempProject, description });
    }

    if (parsedRows.length === 0) {
      fs.unlinkSync(filePath);
      throw new AppError(400, 'No valid data rows found in file');
    }

    // Generate data fingerprint
    const dataFingerprint = generateDataFingerprint(parsedRows);
    console.log('Data fingerprint:', dataFingerprint.substring(0, 16) + '...');

    // Check for duplicate data (same hours data, possibly from different file)
    const duplicateByData = db.prepare(`
      SELECT id, filename, imported_at, row_count, total_hours 
      FROM import_batches 
      WHERE data_fingerprint = ? AND is_mock_data = 0
    `).get(dataFingerprint) as { id: number; filename: string; imported_at: string; row_count: number; total_hours: number } | undefined;

    if (duplicateByData) {
      fs.unlinkSync(filePath);
      throw new AppError(409, `This data was already imported on ${duplicateByData.imported_at} from "${duplicateByData.filename}" (${duplicateByData.row_count} rows, ${duplicateByData.total_hours} hours). The hours data matches an existing import. Upload rejected to prevent duplicate data.`);
    }

    // STEP 3: Create import batch with hashes
    console.log('Creating import batch...');
    const batchResult = db.prepare(`
      INSERT INTO import_batches (filename, imported_by, is_mock_data, content_hash, data_fingerprint)
      VALUES (?, ?, 0, ?, ?)
    `).run(filename, req.user!.id, contentHash, dataFingerprint);
    console.log('Batch created:', batchResult.lastInsertRowid);

    const batchId = batchResult.lastInsertRowid;

    // STEP 4: Insert the pre-parsed rows
    const insertHours = db.prepare(`
      INSERT INTO burnt_hours (ticket_key, jira_project, description, hours, is_admin_overhead, import_batch_id, is_mock_data, work_date)
      VALUES (?, ?, ?, ?, ?, ?, 0, date('now'))
    `);

    let rowCount = 0;
    let totalHours = 0;

    db.exec('BEGIN TRANSACTION');

    try {
      for (const row of parsedRows) {
        // Determine if admin/overhead (no Jira key)
        const isAdmin = row.ticketKey === null || row.ticketKey === '' ? 1 : 0;

        insertHours.run(row.ticketKey || null, row.project, row.description, row.hours, isAdmin, batchId);
        rowCount++;
        totalHours += row.hours;
      }

      // Update batch totals
      db.prepare(`
        UPDATE import_batches SET row_count = ?, total_hours = ? WHERE id = ?
      `).run(rowCount, totalHours, batchId);

      db.exec('COMMIT');

      // Clean up uploaded file
      fs.unlinkSync(filePath);

      res.json({
        success: true,
        batchId,
        filename,
        rowCount,
        totalHours: Math.round(totalHours * 100) / 100,
      });

    } catch (error) {
      db.exec('ROLLBACK');
      console.error('Import transaction error:', error);
      throw error;
    }

  } catch (error) {
    console.error('Import route error:', error);
    next(error);
  }
});

// Get import history
importRouter.get('/history', (req, res, next) => {
  try {
    const db = getDb();

    const batches = db.prepare(`
      SELECT 
        ib.*,
        u.name as imported_by_name,
        u.email as imported_by_email
      FROM import_batches ib
      LEFT JOIN users u ON ib.imported_by = u.id
      ORDER BY ib.imported_at DESC
      LIMIT 50
    `).all();

    res.json({ batches });
  } catch (error) {
    next(error);
  }
});

// Get details of a specific import batch
importRouter.get('/history/:batchId', (req, res, next) => {
  try {
    const { batchId } = req.params;
    const db = getDb();

    const batch = db.prepare(`
      SELECT 
        ib.*,
        u.name as imported_by_name
      FROM import_batches ib
      LEFT JOIN users u ON ib.imported_by = u.id
      WHERE ib.id = ?
    `).get(batchId);

    if (!batch) {
      throw new AppError(404, 'Import batch not found');
    }

    const rows = db.prepare(`
      SELECT * FROM burnt_hours WHERE import_batch_id = ?
      ORDER BY id
    `).all(batchId);

    res.json({ batch, rows });
  } catch (error) {
    next(error);
  }
});

// Delete an import batch (admin only)
importRouter.delete('/history/:batchId', (req: AuthRequest, res, next) => {
  try {
    const { batchId } = req.params;
    const db = getDb();

    // Check if user is admin (role === 'admin')
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user!.id) as { role: string } | undefined;
    if (user?.role !== 'admin') {
      throw new AppError(403, 'Only admins can delete import batches');
    }

    // Get batch info before deleting
    const batch = db.prepare(`
      SELECT id, filename, row_count, total_hours 
      FROM import_batches 
      WHERE id = ?
    `).get(batchId) as { id: number; filename: string; row_count: number; total_hours: number } | undefined;

    if (!batch) {
      throw new AppError(404, 'Import batch not found');
    }

    // Delete burnt_hours records first (CASCADE should handle this, but be explicit)
    db.prepare(`
      DELETE FROM burnt_hours WHERE import_batch_id = ?
    `).run(batchId);

    // Delete the batch
    db.prepare(`
      DELETE FROM import_batches WHERE id = ?
    `).run(batchId);

    res.json({
      success: true,
      message: `Deleted import batch "${batch.filename}" with ${batch.row_count} rows totaling ${batch.total_hours} hours`,
      deleted: {
        batchId: batch.id,
        filename: batch.filename,
        rowCount: batch.row_count,
        totalHours: batch.total_hours,
      },
    });
  } catch (error) {
    next(error);
  }
});
