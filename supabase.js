import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/* =========================
   管理画面読込み
========================= */
export async function loadAdmin() {

  const { data, error } = await supabase
    .from("admin_data")
    .select("data")
    .eq("id", "root")
    .single();

  if (error) throw error;

  return data.data;

}

/* =========================
   管理画面保存
========================= */
export async function saveAdmin(adminData) {

  const { error } = await supabase
    .from("admin_data")
    .update({
      data: adminData
    })
    .eq("id", "root");

  if (error) throw error;

}
