// ─── User & Auth ───────────────────────────────────────────────────────────

export enum Role {
  USER = 'USER',
  STAFF = 'STAFF',
  ADMIN = 'ADMIN',
}

export interface UserDto {
  id: number;
  email: string;
  role: Role;
  createdAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  twoFactorCode?: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  passwordRepeat: string;
}

export interface AuthResponse {
  user: UserDto;
}

// ─── Domain Entities ───────────────────────────────────────────────────────

export interface PersonBase {
  id: number;
  vorname: string;
  nachname: string;
  mail: string | null;
  telefon: string | null;
  geschlecht: string | null;
  titel: string | null;
  firma: string | null;
  plz: string | null;
  ort: string | null;
}

export type KandidatDto = PersonBase;
export type HauptexperteDto = PersonBase;
export type NebenexperteDto = PersonBase;
export type VfDto = PersonBase;

export interface NotenuebersichtDto {
  id: number;
  fachrichtung: string | null;
  kandidat: KandidatDto | null;
  hauptexperte: HauptexperteDto | null;
  nebenexperte: NebenexperteDto | null;
  vf: VfDto | null;
  pexUser: UserDto | null;

  punkteTeil1Vf: number | null;
  punkteTeil2Vf: number | null;
  noteTeil1Vf: number | null;
  noteTeil2Vf: number | null;

  punkteTeil1: number | null;
  punkteTeil2: number | null;
  punkteTeil3: number | null;
  noteTeil1: number | null;
  noteTeil2: number | null;
  noteTeil3: number | null;

  notePa: number | null;
  noteTeil1Errechnet: number | null;
  noteTeil2Errechnet: number | null;
  noteTeil3Errechnet: number | null;
  notePaErrechnet: number | null;

  signaturDurchfuehrung: string | null;
  zeitArbeitBis: string | null;
  mainFileUpload: string | null;

  nkComment: string | null;
  nkTimestamp: string | null;
  nkVisiert: boolean;
  nkChange: boolean;
}

export interface AnpassungDto {
  id: number;
  notenuebersichtId: number;
  pdfPath: string | null;
  createdAt: string;
}

export interface LogDto {
  id: number;
  user: UserDto | null;
  action: string;
  timestamp: string;
  before: string | null;
  after: string | null;
}

// ─── API Request/Response ──────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ItemsFilter {
  kandidatId?: string;
  name?: string;
  note?: string;
  hauptexperte?: string;
  vf?: string;
  nebenexperte?: string;
  nkVisiert?: boolean;
  nkChange?: boolean;
  page?: number;
  pageSize?: number;
}

export interface SaveGradeRequest {
  kandidatId: number;
  note: number;
}

export interface CollectRequest {
  typ: 'ungenuegend' | 'knapp' | 'gut' | 'sehrgut';
}

export interface DashboardStats {
  numIpaAll: number;
  numIpaAllVis: number;
  numIpaUng: number;
  numIpaUngVis: number;
  numIpaKnapp: number;
  numIpaKnappVis: number;
  numIpaGut: number;
  numIpaGutVis: number;
  numIpaSehr: number;
  numIpaSehrVis: number;
  workingOn: NotenuebersichtDto[];
  visiert: NotenuebersichtDto[];
}

// ─── Jobs ──────────────────────────────────────────────────────────────────

export enum JobType {
  IMPORT_NOTENUEBERSICHT = 'import_notenuebersicht',
  IMPORT_DURCHFUEHRUNG = 'import_durchfuehrung',
  DOWNLOAD_PORTFOLIOS = 'download_portfolios',
}

export interface JobStatus {
  jobId: string;
  type: JobType;
  status: 'waiting' | 'active' | 'completed' | 'failed';
  progress: number;
  logs: string[];
  error?: string;
}

// ─── PKOrg ─────────────────────────────────────────────────────────────────

export interface PkorgRole {
  text: string;
  url: string;
}

export interface AdminDashboardAction {
  roleUrl: string;
  action: 'import' | 'download_durchfuehrung' | 'download_portfolio';
}

// ─── API Error ─────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}
