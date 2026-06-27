// Backend-ready DTO types matching FastAPI Pydantic schemas exactly.
// All IDs are strings (BSON ObjectId serialised to string).
// All dates are ISO 8601 strings (FastAPI datetime serialisation).

// ── Generic envelope ──────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  detail?: unknown;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  org_slug: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  new_password: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface OrgInfo {
  id: string;
  name: string;
  slug: string;
}

export interface UserInfo {
  id: string;
  name: string;
  email: string;
  role: SystemRole;
  org_id: string;
  org_name: string;
  avatar_url: string | null;
}

export interface RegisterResponse {
  id: string;
  name: string;
  email: string;
  role: SystemRole;
  org: OrgInfo;
  created_at: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: 'bearer';
  user: UserInfo;
}

export interface RefreshResponse {
  access_token: string;
  token_type: 'bearer';
}

export interface MeResponse {
  id: string;
  name: string;
  email: string;
  role: SystemRole;
  org_id: string;
  org_name: string;
  org_slug: string;
  avatar_url: string | null;
  last_login: string | null;
  created_at: string;
}

// ── RBAC / Roles ──────────────────────────────────────────────────────────────

export type SystemRole = 'super_admin' | 'admin' | 'user';
export type ProjectRole = 'viewer' | 'contributor' | 'manager' | 'admin';

// ── Users ─────────────────────────────────────────────────────────────────────

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  role: SystemRole;
  is_active: boolean;
  avatar_url: string | null;
  last_login: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssignedProjectBrief {
  project_id: string;
  project_name: string;
  project_role: ProjectRole;
  assigned_at: string;
}

export interface UserDetailResponse extends UserResponse {
  assigned_projects: AssignedProjectBrief[];
}

export interface UserListResponse {
  id: string;
  name: string;
  email: string;
  role: SystemRole;
  is_active: boolean;
  avatar_url: string | null;
  last_login: string | null;
  created_at: string;
}

export interface UpdateUserRequest {
  name?: string;
  avatar_url?: string;
  role?: 'admin' | 'user';
  is_active?: boolean;
}

// ── Organizations ─────────────────────────────────────────────────────────────

export type OrgPlan = 'free' | 'starter' | 'professional' | 'enterprise';
export type OrgStatus = 'active' | 'suspended' | 'cancelled';

export interface OrgSettingsSchema {
  max_projects?: number;
  max_users?: number;
  storage_limit_gb?: number;
}

export interface OrgStatsSchema {
  total_projects: number;
  total_users: number;
  storage_used_gb: number;
}

export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  plan: OrgPlan;
  status: OrgStatus;
  logo_url: string | null;
  settings: OrgSettingsSchema;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMeResponse extends OrganizationResponse {
  stats: OrgStatsSchema;
}

export interface CreateOrganizationRequest {
  name: string;
  slug: string;
  plan: OrgPlan;
  owner_email: string;
  settings?: OrgSettingsSchema;
}

export interface UpdateOrganizationRequest {
  name?: string;
  logo_url?: string;
  settings?: OrgSettingsSchema;
}

// ── Project assignments ───────────────────────────────────────────────────────

export interface AssignmentResponse {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_avatar: string | null;
  project_id: string;
  project_role: ProjectRole;
  assigned_by: string;
  assigned_at: string;
  is_active: boolean;
  revoked_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface CreateAssignmentRequest {
  user_id: string;
  project_role: ProjectRole;
  notes?: string;
}

export interface UpdateAssignmentRequest {
  project_role: ProjectRole;
}

// ── Projects (Phase 3+ backend — not yet implemented in backend) ───────────────

export type ProjectStatusDTO = 'active' | 'review' | 'done' | 'draft';

export interface ProjectResponse {
  id: string;
  org_id: string;
  name: string;
  location: string;
  city: string;
  state: string;
  client: string;
  description: string;
  status: ProjectStatusDTO;
  progress: number;
  tower_count: number;
  floor_count: number;
  room_count: number;
  capture_count: number;
  start_date: string;
  end_date: string;
  thumbnail_url: string | null;
  team_size: number;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectRequest {
  name: string;
  location: string;
  city: string;
  state: string;
  client: string;
  description?: string;
  start_date: string;
  end_date: string;
}

export interface UpdateProjectRequest {
  name?: string;
  location?: string;
  description?: string;
  status?: ProjectStatusDTO;
  progress?: number;
}

// ── Towers ────────────────────────────────────────────────────────────────────

export type TowerStatus = 'active' | 'complete' | 'pending';

export interface TowerResponse {
  id: string;
  project_id: string;
  org_id: string;
  name: string;
  floor_count: number;
  room_count: number;
  capture_count: number;
  progress: number;
  description: string;
  status: TowerStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateTowerRequest {
  project_id: string;
  name: string;
  floor_count: number;
  description?: string;
}

// ── Floors ────────────────────────────────────────────────────────────────────

export type FloorStatus = 'complete' | 'partial' | 'pending';

export interface FloorResponse {
  id: string;
  tower_id: string;
  project_id: string;
  org_id: string;
  number: number;
  label: string;
  room_count: number;
  mapped_count: number;
  status: FloorStatus;
  floor_plan_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── Rooms ─────────────────────────────────────────────────────────────────────

export type RoomType = 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'balcony' | 'utility';
export type RoomStatus = 'captured' | 'pending' | 'review' | 'rejected';

export interface RoomResponse {
  id: string;
  floor_id: string;
  tower_id: string;
  project_id: string;
  org_id: string;
  name: string;
  type: RoomType;
  capture_count: number;
  status: RoomStatus;
  last_captured: string | null;
  created_at: string;
  updated_at: string;
}

// ── Captures ──────────────────────────────────────────────────────────────────

export type CaptureStatusDTO = 'processed' | 'review' | 'rejected' | 'uploading';
export type ReviewStatusDTO = 'uploaded' | 'assigned' | 'reviewing' | 'changes_requested' | 'approved' | 'published';

export interface CaptureResponse {
  id: string;
  room_id: string;
  room_name: string;
  project_id: string;
  project_name: string;
  tower_id: string;
  tower_name: string;
  floor_label: string;
  org_id: string;
  status: CaptureStatusDTO;
  review_status: ReviewStatusDTO;
  uploaded_by: string;
  uploaded_at: string;
  reviewed_by: string | null;
  review_notes: string | null;
  assigned_to: string | null;
  file_count: number;
  size_mb: number;
  cloudinary_public_ids: string[];
  secure_urls: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateCaptureRequest {
  room_id: string;
  project_id: string;
  tower_id: string;
  floor_label: string;
  room_name: string;
}

export interface UpdateCaptureReviewRequest {
  review_status: ReviewStatusDTO;
  assigned_to?: string;
  review_notes?: string;
}

// ── Tours ─────────────────────────────────────────────────────────────────────

export type TourStatusDTO = 'draft' | 'processing' | 'in_review' | 'published';

export interface TourResponse {
  id: string;
  capture_id: string;
  room_id: string;
  room_name: string;
  project_id: string;
  project_name: string;
  tower_id: string;
  tower_name: string;
  floor_label: string;
  org_id: string;
  status: TourStatusDTO;
  capture_count: number;
  last_capture: string;
  panorama_urls: string[];
  hotspots: HotspotDTO[];
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface HotspotDTO {
  id: string;
  x: number;
  y: number;
  pitch: number;
  yaw: number;
  label: string;
  target_tour_id: string | null;
  target_room_id: string | null;
}

export interface UpdateTourStatusRequest {
  status: TourStatusDTO;
}

// ── Floor Plans ───────────────────────────────────────────────────────────────

export type FloorPlanFileType = 'pdf' | 'png' | 'jpg';

export interface RoomMarkerDTO {
  id: string;
  name: string;
  number: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: 'not_started' | 'in_progress' | 'reviewed' | 'published';
  capture_id: string | null;
  tour_id: string | null;
}

export interface FloorPlanResponse {
  id: string;
  project_id: string;
  tower_id: string;
  floor_id: string;
  floor_label: string;
  org_id: string;
  uploaded_by: string;
  uploaded_at: string;
  file_type: FloorPlanFileType;
  file_name: string;
  file_size_mb: number;
  cloudinary_public_id: string | null;
  secure_url: string | null;
  rooms: RoomMarkerDTO[];
  created_at: string;
  updated_at: string;
}

// ── Defects ───────────────────────────────────────────────────────────────────

export type DefectSeverityDTO = 'low' | 'medium' | 'high' | 'critical';
export type DefectStatusDTO = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface DefectResponse {
  id: string;
  org_id: string;
  project_id: string;
  project_name: string;
  tower_id: string | null;
  tower_name: string | null;
  floor_label: string | null;
  room_name: string | null;
  capture_id: string | null;
  title: string;
  description: string;
  severity: DefectSeverityDTO;
  status: DefectStatusDTO;
  assigned_to: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateDefectRequest {
  project_id: string;
  tower_id?: string;
  floor_label?: string;
  room_name?: string;
  capture_id?: string;
  title: string;
  description: string;
  severity: DefectSeverityDTO;
  assigned_to: string;
}

export interface UpdateDefectRequest {
  status?: DefectStatusDTO;
  severity?: DefectSeverityDTO;
  assigned_to?: string;
  title?: string;
  description?: string;
}

// ── Notifications ─────────────────────────────────────────────────────────────

export type NotifTypeDTO =
  | 'capture_uploaded'
  | 'review_requested'
  | 'tour_published'
  | 'defect_assigned'
  | 'floor_plan_uploaded'
  | 'review_approved'
  | 'review_rejected';

export interface NotificationResponse {
  id: string;
  org_id: string;
  user_id: string;
  type: NotifTypeDTO;
  title: string;
  body: string;
  link: string;
  read: boolean;
  created_at: string;
}

// ── Cloudinary ────────────────────────────────────────────────────────────────

export interface CloudinaryUploadResult {
  public_id: string;
  secure_url: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
  resource_type: string;
  created_at: string;
}

export interface CloudinarySignatureResponse {
  signature: string;
  timestamp: number;
  cloud_name: string;
  api_key: string;
  upload_preset: string;
  folder: string;
}

// ── Audit Logs ────────────────────────────────────────────────────────────────

export type AuditEventType =
  | 'capture_uploaded'
  | 'capture_approved'
  | 'capture_rejected'
  | 'tour_published'
  | 'tour_deleted'
  | 'tour_draft'
  | 'defect_created'
  | 'defect_resolved'
  | 'floor_plan_uploaded'
  | 'user_invited'
  | 'user_role_changed'
  | 'review_assigned'
  | 'project_created'
  | 'project_updated';

export interface AuditLogResponse {
  id: string;
  org_id: string;
  actor_id: string;
  actor_name: string;
  event_type: AuditEventType;
  entity_type: string;
  entity_id: string;
  entity_name: string;
  project_id: string | null;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
}
