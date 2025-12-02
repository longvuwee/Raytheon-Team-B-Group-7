// src/api/blocksApi.js
import { supabase } from "../supabaseClient";

export async function fetchBlocks() {
  const { data, error } = await supabase
    .from("fire_blocks")
    .select("block_id, lat, lon, prob, T, T_burn");

  if (error) {
    console.error("Error fetching fire_blocks:", error);
    return [];
  }
  return data ?? [];
}
