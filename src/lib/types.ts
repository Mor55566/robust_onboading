export type UserRole = "user" | "super_admin";

export function isAdminRole(role: UserRole) {
  return role === "super_admin";
}

export type TaskStatus = "paused" | "open" | "in_work" | "closed" | "canceled";

export type TaskUrgency = "low" | "medium" | "high" | "critical";

export type TaskType = "task" | "template-task" | "mission" | "template-mission";

export type MissionScheduleFrequency =
  | "day"
  | "week"
  | "month"
  | "year"
  | "custom";

export type MissionScheduleIntervalUnit = "day" | "week" | "month";

/** 0=Sunday … 6=Saturday */
export type MissionSchedule = {
  frequency: MissionScheduleFrequency;
  weekdays: number[] | null;
  weekday: number | null;
  interval_count: number | null;
  interval_unit: MissionScheduleIntervalUnit | null;
  /** Daily: hour (0-23) the mission opens. null = start of day. */
  start_time: number | null;
  /** Daily: hour (0-23) the mission closes. null = end of day. */
  end_time: number | null;
  /** Weekly/custom-week: day (0=Sun..6=Sat) the mission closes. `weekday` above is the start day. */
  end_weekday: number | null;
  /** Monthly/yearly: day of month (1-31) the mission opens. null = start of month (1). */
  start_day_of_month: number | null;
  /** Monthly/yearly: day of month (1-31) the mission closes. null = end of month. */
  end_day_of_month: number | null;
  /** Yearly: month (1-12) the mission opens. null = January. */
  start_month: number | null;
  /** When true, the mission never auto-closes regardless of the fields above. */
  never_closes: boolean;
  /** Daily missions only: when true, an external microservice skips generating an
   * occurrence for this mission on holidays. */
  skip_holidays: boolean;
};

/** Form/editor selection for a mission location row (camelCase field names). */
export type MissionLocationSelection = {
  buildingId: string;
  floorId: string;
  areaId: string;
};

/** Persisted/display location attached to a mission. */
export type MissionLocation = {
  building_id: string;
  building_name: string | null;
  floor_id: string | null;
  floor_name: string | null;
  area_id: string | null;
  area_name: string | null;
};

/** @deprecated Use MissionScheduleFrequency */
export type MissionOpenEvery = MissionScheduleFrequency;

export type SessionUser = {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  resident_id: string | null;
  complex_id: string | null;
  complex_name: string | null;
  chain_name: string | null;
  chain_logo_url: string | null;
};

export type ChecklistItemType = "checklist" | "text" | "number" | "options" | "signature" | "qr_code";
export type ChecklistNumberRule = "any" | "between" | "less_than" | "greater_than";
export type QrLocationKind = "building" | "floor" | "area" | "equipment";

/** For a qr_code item: which existing building/floor/area/equipment QR code completes it.
 * There is no dedicated QR code per item — scanning that entity's own printed sticker
 * (see qr_scan_url on that table) is what marks this item done. */
export type QrLocation = {
  kind: QrLocationKind;
  id: string;
  name: string | null;
};

export type TaskChecklistItem = {
  id: string;
  label: string;
  sort_order: number;
  is_completed: boolean;
  completed_at: string | null;
  completed_by_name: string | null;
  answer_value: string | null;
  item_type: ChecklistItemType;
  field_type_original: string | null;
  is_required: boolean;
  number_unit: string | null;
  number_rule: ChecklistNumberRule | null;
  number_min: number | null;
  number_max: number | null;
  options: string[];
  qr_location: QrLocation | null;
};

export type ChecklistAttachment = {
  id: string;
  task_checklist_id: string;
  file_name: string;
  mime_type: string;
  storage_url: string;
  created_at: string;
};

export type TaskChecklist = {
  id: string;
  title: string;
  sort_order: number;
  items: TaskChecklistItem[];
  /** Locations this checklist should be performed at. Only meaningful for mission/template-mission checklists. */
  locations: MissionLocation[];
  /** Photos/videos/files attached to this checklist (not to a specific item). */
  attachments: ChecklistAttachment[];
};

export type TaskAttachmentType = "opening" | "resolution";

export type TaskRow = {
  id: string;
  call_number: string | null;
  type: TaskType;
  title: string | null;
  description: string;
  status: TaskStatus;
  urgency: TaskUrgency;
  task_category_id: string | null;
  category_name: string | null;
  floor_id: string | null;
  area_id: string | null;
  equipment_id: string | null;
  floor_name: string | null;
  area_name: string | null;
  equipment_name: string | null;
  location_name: string | null;
  building_id: string | null;
  assignee_ids: string[];
  assignee_names: string | null;
  opened_by_name: string;
  resident_name: string | null;
  source?: "system" | "imported";
  created_at: string;
  due_at: string | null;
  resolution: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolved_by_name: string | null;
  schedule: MissionSchedule | null;
  attachments: TaskAttachment[];
  checklists: TaskChecklist[];
};

export type TaskTemplateOption = Pick<
  TaskRow,
  | "id"
  | "title"
  | "description"
  | "urgency"
  | "task_category_id"
  | "category_name"
  | "floor_id"
  | "area_id"
  | "building_id"
  | "location_name"
  | "checklists"
>;

export type TaskComment = {
  id: string;
  task_id: string;
  user_id: string;
  author_name: string;
  body: string;
  created_at: string;
  attachments: CommentAttachment[];
};

export type CommentAttachment = {
  id: string;
  comment_id: string;
  file_name: string;
  mime_type: string;
  storage_url: string;
  created_at: string;
};

export type TaskAttachment = {
  id: string;
  task_id: string;
  file_name: string;
  mime_type: string;
  storage_url: string;
  created_at: string;
  attachment_type: TaskAttachmentType;
};

export type TaskViewer = {
  user_id: string;
  full_name: string;
  first_viewed_at: string;
  last_viewed_at: string;
  view_count: number;
};

export type FileTag = {
  id: string;
  complex_id: string;
  name: string;
  color: string;
  created_at: string;
};

export type FileAttachment = {
  id: string;
  file_id: string;
  file_name: string;
  mime_type: string;
  storage_url: string;
  created_at: string;
};

export type BuildingFile = {
  id: string;
  complex_id: string;
  series_id: string;
  version: number;
  version_count: number;
  title: string;
  resident_id: string | null;
  resident_display_name: string | null;
  tag_id: string | null;
  tag_name: string | null;
  tag_color: string | null;
  start_date: string | null;
  expiration_date: string | null;
  remind_days_before: number | null;
  description: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  attachments: FileAttachment[];
};
