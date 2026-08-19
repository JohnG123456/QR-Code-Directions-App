// Hand-written types mirroring supabase/migrations/0001_init.sql.
// Once the project is linked, prefer regenerating with:
//   supabase gen types typescript --project-id <id> > lib/types.ts

export type SiteStatus = "active" | "inactive" | "draft";

export interface Resort {
  id: string;
  name: string;
  slug: string;
  is_published: boolean;
  center_lat: number | null;
  center_lng: number | null;
  default_zoom: number;
  total_homes: number | null;
  entrance_node_id: string | null;
  entrance_lat: number | null;
  entrance_lng: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Site {
  id: string;
  resort_id: string;
  site_number: string;
  label: string | null;
  lat: number | null;
  lng: number | null;
  graph_node_id: string | null;
  gps_accuracy_m: number | null;
  status: SiteStatus;
  created_at: string;
  updated_at: string;
}

export interface PublicResort {
  id: string;
  name: string;
  slug: string;
  default_zoom: number;
  entrance_lat: number | null;
  entrance_lng: number | null;
  is_routable: boolean;
}

export interface PublicSite {
  id: string;
  resort_id: string;
  site_number: string;
  label: string | null;
  lat: number | null;
  lng: number | null;
}

export interface StaffProfile {
  id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  created_at: string;
}
