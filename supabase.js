import { createClient } from "@supabase/supabase-js";

/* =========================
   Supabase接続
========================= */

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/* =========================
   初期データ
========================= */

const EMPTY_ADMIN = {

  introducerName: "",
  introducerFLP: "",
  introducerUserId: "",

  flpList: [],

  members: []

};

/* =========================
   管理データ読込み
========================= */

export async function loadAdmin() {

  const { data, error } = await supabase
    .from("admin_data")
    .select("data")
    .eq("id", "root")
    .single();

  // データ取得成功
  if (!error && data?.data) {

    return data.data;

  }

  console.log("admin_data が存在しないため初期データを作成します。");

  // 初回のみ自動作成
  const { error: insertError } = await supabase
    .from("admin_data")
    .upsert({

      id: "root",

      data: EMPTY_ADMIN

    });

  if (insertError) {

    console.error(insertError);

  }

  return EMPTY_ADMIN;

}

/* =========================
   管理データ保存
========================= */

export async function saveAdmin(adminData) {

  const { error } = await supabase
    .from("admin_data")
    .upsert({

      id: "root",

      data: adminData

    });

  if (error) {

    console.error(error);

    throw error;

  }

  return true;

}
