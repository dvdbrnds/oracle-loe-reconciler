import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { toast } from '../components/ui/toaster';
import { Upload, FileSpreadsheet } from 'lucide-react';

interface ImportBatch {
  id: number;
  filename: string;
  row_count: number;
  total_hours: number;
  imported_by_name: string;
  imported_at: string;
  is_mock_data: number;
}

export function ImportPage() {
  const [history, setHistory] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  async function fetchHistory() {
    try {
      const data = await api.get<{ batches: ImportBatch[] }>('/import/history');
      setHistory(data.batches);
    } catch (error) {
      console.error('Failed to fetch import history:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(file: File) {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an Excel file (.xlsx or .xls)',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    try {
      const result = await api.uploadFile<{
        success: boolean;
        batchId: number;
        filename: string;
        rowCount: number;
        totalHours: number;
      }>('/import/burnt-hours', file);

      toast({
        title: 'Import successful',
        description: `Imported ${result.rowCount} rows (${result.totalHours} hours)`,
      });

      fetchHistory();
    } catch (error) {
      toast({
        title: 'Import failed',
        description: error instanceof Error ? error.message : 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  }

  function handleDrag(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUpload(e.dataTransfer.files[0]);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      handleUpload(e.target.files[0]);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Import Burnt Hours</h1>
        <p className="text-gray-600">Upload vendor Excel reports to track burnt hours</p>
      </div>

      {/* Upload Area */}
      <div
        className={`
          bg-white rounded-xl shadow-sm border-2 border-dashed p-8 text-center transition-colors
          ${dragActive ? 'border-primary bg-primary/5' : 'border-gray-300'}
          ${uploading ? 'pointer-events-none opacity-50' : ''}
        `}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileInput}
          className="hidden"
        />

        <div className="flex flex-col items-center gap-4">
          {uploading ? (
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          ) : (
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
              <Upload className="w-6 h-6 text-primary" />
            </div>
          )}

          <div>
            <p className="text-lg font-medium">
              {uploading ? 'Uploading...' : 'Drag and drop your Excel file here'}
            </p>
            <p className="text-gray-500 mt-1">or click to browse</p>
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            Select File
          </button>

          <p className="text-sm text-gray-500">
            Supported formats: .xlsx, .xls (Max 10MB)
          </p>
        </div>
      </div>

      {/* File Format Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h3 className="font-medium text-blue-900 flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5" />
          Expected File Format
        </h3>
        <ul className="mt-2 text-sm text-blue-800 space-y-1">
          <li>- Filename: [VendorCode]_Burnt_Report_[MM-DD-YYYY].xlsx</li>
          <li>- Rows 1-3: Filter metadata (skipped)</li>
          <li>- Row 4: Column headers (Project Name, Jira Issue Key, Task Name, Hours Billable)</li>
          <li>- Row 5+: Data rows</li>
          <li>- Empty Jira Key indicates Admin/Overhead hours</li>
        </ul>
      </div>

      {/* Import History */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Import History</h2>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          </div>
        ) : history.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Filename
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Rows
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Total Hours
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Imported By
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Date
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                    Type
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {history.map(batch => (
                  <tr key={batch.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4 text-green-600" />
                        <span className="text-sm font-medium">{batch.filename}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right text-sm">{batch.row_count}</td>
                    <td className="px-6 py-4 text-right text-sm font-medium">
                      {batch.total_hours.toFixed(1)}h
                    </td>
                    <td className="px-6 py-4 text-sm">{batch.imported_by_name || 'System'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(batch.imported_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {batch.is_mock_data ? (
                        <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-full">
                          FAKE
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">
                          Real
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            No imports yet. Upload your first burnt hours report above.
          </div>
        )}
      </div>
    </div>
  );
}
