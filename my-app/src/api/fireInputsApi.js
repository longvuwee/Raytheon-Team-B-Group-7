// src/api/fireInputsApi.js
import { supabase } from "../supabaseClient";

export async function fetchUnprocessedInputs(limit = 200) {
  const { data, error } = await supabase
    .from("fire_inputs")
    .select("*")
    .eq("processed", false)
    .limit(limit);

  if (error) {
    console.error("Error fetching fire_inputs:", error);
    return [];
  }
  return data ?? [];
}
