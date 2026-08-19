import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RouteMap } from "./route-map";

export default async function VisitorResortPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: resort } = await supabase
    .from("public_resorts")
    .select("id, name, slug, default_zoom, entrance_lat, entrance_lng, is_routable")
    .eq("slug", slug)
    .single();

  if (!resort) notFound();

  const { data: sites } = await supabase
    .from("public_sites")
    .select("id, resort_id, site_number, label, lat, lng")
    .eq("resort_id", resort.id)
    .order("site_number");

  return <RouteMap resort={resort} sites={sites ?? []} />;
}
