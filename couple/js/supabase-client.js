// 42world Supabase 클라이언트 (공통)
// 실제 배포 시 아래 상수를 실제 값으로 교체하거나 빌드 시 주입
//
// HTML에서 로드:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="/couple/js/supabase-client.js"></script>

(function (global) {
  'use strict';

  // shadowgram-app's Project (AWS Seoul ap-northeast-2)
  // project ref: rfmdshpsjelnnfucunjp
  const SUPABASE_URL = global.__SUPABASE_URL__ || 'https://rfmdshpsjelnnfucunjp.supabase.co';
  // publishable key (새 포맷) — 클라이언트에 노출돼도 안전
  const SUPABASE_ANON_KEY = global.__SUPABASE_ANON_KEY__ || 'sb_publishable_hkVLFBXCGCGsZmCMWnwFkw_HxGL_2qJ';

  if (!global.supabase) {
    console.error('[42world] supabase-js SDK 미로드. <script> 순서 확인 필요.');
    return;
  }

  const client = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  global.SG = global.SG || {};
  global.SG.supabase = client;
  global.SG.SUPABASE_URL = SUPABASE_URL;
})(typeof window !== 'undefined' ? window : globalThis);
