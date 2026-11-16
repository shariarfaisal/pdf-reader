import React, { useState } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Field, TextInput } from './ui/Field';
import { UploadCloud, FileText, FolderPlus } from 'lucide-react';
import { formatBookDisplayTitle } from '../lib/format';

export function NewProjectModal({ isOpen, onClose, onCreateProject }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [localPath, setLocalPath] = useState('');
  const [projectName, setProjectName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState('upload'); // 'upload' | 'path'
  const [error, setError] = useState(null);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      if (!projectName) {
        setProjectName(formatBookDisplayTitle(file.name));
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (mode === 'upload') {
        if (!selectedFile) {
          setError('Please select a PDF file to upload.');
          setIsLoading(false);
          return;
        }
        const formData = new FormData();
        formData.append('pdf', selectedFile);
        formData.append('name', projectName || formatBookDisplayTitle(selectedFile.name));
        await onCreateProject(formData, true);
      } else {
        if (!localPath.trim()) {
          setError('Please enter a valid local PDF file path.');
          setIsLoading(false);
          return;
        }
        await onCreateProject(
          {
            pdfPath: localPath.trim(),
            name: projectName || formatBookDisplayTitle(localPath.split('/').pop())
          },
          false
        );
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to initialize project');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Import PDF Project"
      subtitle="Digital text PDF or scanned book image pages"
      icon={FolderPlus}
      maxWidth="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Tab switch between file upload and local path */}
        <div className="flex bg-obsidian-950 p-1 rounded-xl border border-obsidian-700/80">
          <button
            type="button"
            onClick={() => setMode('upload')}
            className={`flex-1 h-8 text-xs font-semibold rounded-lg transition-all ${
              mode === 'upload'
                ? 'bg-obsidian-800 text-brand-400 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Upload PDF Document
          </button>
          <button
            type="button"
            onClick={() => setMode('path')}
            className={`flex-1 h-8 text-xs font-semibold rounded-lg transition-all ${
              mode === 'path'
                ? 'bg-obsidian-800 text-brand-400 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Local File Path
          </button>
        </div>

        {mode === 'upload' ? (
          <div>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-obsidian-700 hover:border-brand-500/60 rounded-2xl p-8 cursor-pointer bg-obsidian-900/40 hover:bg-obsidian-900/80 transition-all text-center group">
              <UploadCloud className="w-10 h-10 text-slate-500 group-hover:text-brand-400 transition mb-3" />
              <span className="text-sm font-medium text-slate-200 mb-1">
                {selectedFile ? selectedFile.name : 'Click or drag PDF here'}
              </span>
              <span className="text-xs text-slate-400">
                Supports standard digital PDFs and scanned image pages
              </span>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
          </div>
        ) : (
          <Field label="Local File Path" hint="Absolute path on your machine">
            <TextInput
              mono
              placeholder="/path/to/your/book.pdf"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
            />
          </Field>
        )}

        <Field label="Project Name">
          <TextInput
            placeholder="e.g. Tafsir Ibn Kathir Vol 1"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
        </Field>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-obsidian-800">
          <Button variant="ghost" size="sm" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" isLoading={isLoading} icon={FolderPlus}>
            Create Project
          </Button>
        </div>
      </form>
    </Modal>
  );
}
