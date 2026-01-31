import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { getDb } from '../db/database.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

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

    // Check for duplicate import (same filename uploaded today)
    const existingBatch = db.prepare(`
      SELECT id, filename, imported_at, row_count, total_hours 
      FROM import_batches 
      WHERE filename = ? 
        AND date(imported_at) = date('now')
        AND is_mock_data = 0
    `).get(filename) as { id: number; filename: string; imported_at: string; row_count: number; total_hours: number } | undefined;

    if (existingBatch) {
      // Clean up uploaded file
      fs.unlinkSync(filePath);
      throw new AppError(409, `This file "${filename}" was already imported today at ${existingBatch.imported_at}. It contains ${existingBatch.row_count} rows totaling ${existingBatch.total_hours} hours. Please use a different filename or wait until tomorrow to re-import.`);
    }

    // Create import batch
    console.log('Creating import batch...');
    const batchResult = db.prepare(`
      INSERT INTO import_batches (filename, imported_by, is_mock_data)
      VALUES (?, ?, 0)
    `).run(filename, req.user!.id);
    console.log('Batch created:', batchResult.lastInsertRowid);

    const batchId = batchResult.lastInsertRowid;

    // Parse and insert rows
    const insertHours = db.prepare(`
      INSERT INTO burnt_hours (ticket_key, jira_project, description, hours, is_admin_overhead, import_batch_id, is_mock_data, work_date)
      VALUES (?, ?, ?, ?, ?, ?, 0, date('now'))
    `);

    let currentProject = '';
    let rowCount = 0;
    let totalHours = 0;
    const errors: string[] = [];

    db.exec('BEGIN TRANSACTION');

    try {
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        
        // Skip empty rows
        if (!row || row.every(cell => cell === '' || cell === null || cell === undefined)) {
          continue;
        }

        // Track current project (it may be grouped/merged cells)
        const projectValue = row[colMap.projectName];
        if (projectValue && typeof projectValue === 'string' && projectValue.trim()) {
          currentProject = projectValue.trim();
        }

        // Get hours
        const hoursValue = row[colMap.hoursBillable];
        const hours = typeof hoursValue === 'number' ? hoursValue : parseFloat(hoursValue);
        
        if (isNaN(hours) || hours === 0) {
          continue; // Skip rows without valid hours
        }

        // Get Jira key (may be empty for admin/overhead)
        const jiraKey = row[colMap.jiraKey]?.toString().trim() || null;
        const description = row[colMap.taskName]?.toString().trim() || '';

        // Determine if admin/overhead (no Jira key)
        const isAdmin = jiraKey === null || jiraKey === '' ? 1 : 0;

        insertHours.run(jiraKey || null, currentProject, description, hours, isAdmin, batchId);
        rowCount++;
        totalHours += hours;
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
        errors: errors.length > 0 ? errors : undefined,
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
