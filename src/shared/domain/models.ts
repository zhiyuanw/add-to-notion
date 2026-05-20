export interface ConfluencePageRef {
  baseUrl: string;
  pageId: string;
  pageUrl: string;
}

export interface ConfluenceAttachment {
  id: string;
  filename: string;
  mimeType?: string;
  size?: number;
  downloadUrl?: string;
}

export interface ConfluencePageMetadata {
  spaceKey?: string;
  spaceName?: string;
  labels: string[];
  versionNumber?: number;
  lastModified?: string;
}

export interface ConfluencePageData {
  pageRef: ConfluencePageRef;
  title: string;
  bodyStorageXml: string;
  metadata: ConfluencePageMetadata;
  attachments: ConfluenceAttachment[];
}

export type NotionTarget = NotionDatabaseTarget | NotionPageTarget;

export interface NotionDatabaseTarget {
  type: 'database';
  id: string;
  displayName: string;
  parentObject?: 'database' | 'data_source';
  titlePropertyName?: string;
  titlePropertyId?: string;
}

export interface NotionPageTarget {
  type: 'page';
  id: string;
  displayName: string;
}

export type DegradationSeverity = 'warning' | 'error';

export interface Degradation {
  type: string;
  source: string;
  message: string;
  severity: DegradationSeverity;
}

export type AssetKind = 'image' | 'file' | 'video' | 'audio' | 'pdf' | 'drawio';

export type AssetStatus = 'pending' | 'downloading' | 'downloaded' | 'uploading' | 'uploaded' | 'skipped' | 'failed';

export interface NotionFileRef {
  fileUploadId?: string;
  externalUrl?: string;
  filename?: string;
  expiresAt?: string;
}

export interface AssetRef {
  sourceUrl: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  kind: AssetKind;
  status: AssetStatus;
  notionFileRef?: NotionFileRef;
  degradation?: Degradation;
}
