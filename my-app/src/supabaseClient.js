// src/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Create a dummy client if credentials are missing to prevent app crash
let supabase;

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('your-project-id')) {
  console.warn(
    "⚠️ Supabase env vars missing or not configured. Using mock client."
  );
  
  // Create a chainable mock query builder
  const createMockQuery = () => {
    const mockQuery = {
      select: () => mockQuery,
      insert: () => mockQuery,
      update: () => mockQuery,
      delete: () => mockQuery,
      eq: () => mockQuery,
      neq: () => mockQuery,
      gt: () => mockQuery,
      gte: () => mockQuery,
      lt: () => mockQuery,
      lte: () => mockQuery,
      like: () => mockQuery,
      ilike: () => mockQuery,
      is: () => mockQuery,
      in: () => mockQuery,
      contains: () => mockQuery,
      containedBy: () => mockQuery,
      rangeLt: () => mockQuery,
      rangeGt: () => mockQuery,
      rangeGte: () => mockQuery,
      rangeLte: () => mockQuery,
      rangeAdjacent: () => mockQuery,
      overlaps: () => mockQuery,
      textSearch: () => mockQuery,
      match: () => mockQuery,
      not: () => mockQuery,
      or: () => mockQuery,
      filter: () => mockQuery,
      order: () => mockQuery,
      limit: () => mockQuery,
      range: () => mockQuery,
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve) => resolve({ data: [], error: null }),
      catch: (reject) => mockQuery,
    };
    return mockQuery;
  };
  
  // Create a mock client that won't crash the app
  supabase = {
    from: () => createMockQuery(),
    auth: {
      signIn: () => Promise.resolve({ data: null, error: null }),
      signOut: () => Promise.resolve({ error: null }),
      session: () => null,
    },
  };
} else {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

export { supabase };
