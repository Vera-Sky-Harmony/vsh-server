import { createClient } from "@supabase/supabase-js";

/* =========================
   Supabase接続
========================= */

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/* =========================
   管理データ読込み
========================= */

export async function loadAdmin() {

  const { data, error } = await supabase
    .from("admin_data")
    .select("data")
    .eq("id", "root")
    .single();

  if (error) {

    console.error("loadAdmin:", error);

    return {
      introducerName: "",
      introducerFLP: "",
      introducerUserId: "",
      flpList: [],
      members: []
    };

  }

  return data?.data || {

    introducerName: "",
    introducerFLP: "",
    introducerUserId: "",
    flpList: [],
    members: []

  };

}

/* =========================
   管理データ保存
========================= */

export async function saveAdmin(adminData) {

  const { error } = await supabase
    .from("admin_data")
    .update({
      data: adminData
    })
    .eq("id", "root");

  if (error) {

    console.error("saveAdmin:", error);

    throw error;

  }

  return true;

}
