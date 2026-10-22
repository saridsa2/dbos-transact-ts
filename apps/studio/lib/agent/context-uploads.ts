export const CONTEXT_UPLOAD_LIMIT = 250000;
export const CONTEXT_UPLOAD_ACCEPT = '.txt,.md,text/plain,text/markdown';
export type ContextPermissions = { editVersion: number; editorUpload: boolean; canUpload: boolean; canManage: boolean };
export type UploadedContext = {
  uploadId: string;
  kind: 'source';
  id: string;
  revisionId: string;
  name: string;
  editVersion: number;
  mediaType: string;
  size: number;
};
