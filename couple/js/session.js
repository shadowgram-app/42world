// 42world 세션 관리 모듈
// 의존: supabase-client.js (window.SG.supabase)
//
// 제공 API (window.SG.session.*):
//   createSyncSession({email}) → {session}
//   createAsyncSession({email, scores, typeCode}) → {session, invite_url}
//   getSessionByInviteToken(token) → {session, participants}
//   getSessionById(id) → {session, participants}
//   joinAsyncSession(token, {email, scores, typeCode}) → {session, combo}
//   saveSyncResults(sessionId, {emailA, scoresA, typeA, emailB, scoresB, typeB}) → {session}
//   findSessionsByEmail(email) → [{session, my_role}]
//   markCombo(sessionId, combo, status) → {session}
//   requestDownloadUrl(sessionId, email) → {url, filename}
//   buildLatpeedUrl(sessionId, email) → string
//   computeCombo(typeA, typeB) → "TYPE_A_TYPE_B"

(function (global) {
  'use strict';
  const SG = global.SG = global.SG || {};
  const sb = () => {
    if (!SG.supabase) throw new Error('Supabase client 미초기화');
    return SG.supabase;
  };

  // 래피드 상품 URL (TODO: 실제 상품 결제 URL 확정되면 교체)
  const LATPEED_PRODUCT_URL = 'https://www.latpeed.com/products/9yuqU';

  // 8유형 코드
  const TYPE_CODES = ['SPARK','VISION','STEADY','PLAYER','HARMONY','SOUL','LOGIC','LEADER'];

  function computeCombo(a, b) {
    return `${a}_${b}`;
  }

  // ---------- 동기 모드 ----------
  async function createSyncSession({ email }) {
    const { data, error } = await sb()
      .from('couple_sessions')
      .insert({ mode: 'sync', status: 'pending', payment_status: 'unpaid', payer_email: email })
      .select()
      .single();
    if (error) throw error;
    return { session: data };
  }

  async function saveSyncResults(sessionId, { emailA, scoresA, typeA, emailB, scoresB, typeB }) {
    const combo = computeCombo(typeA, typeB);
    const { error: pErr } = await sb().from('session_participants').insert([
      { session_id: sessionId, role: 'A', email: emailA, scores: scoresA, type_code: typeA, completed_at: new Date().toISOString() },
      { session_id: sessionId, role: 'B', email: emailB, scores: scoresB, type_code: typeB, completed_at: new Date().toISOString() },
    ]);
    if (pErr) throw pErr;

    const { data, error } = await sb()
      .from('couple_sessions')
      .update({ combo, status: 'both_done' })
      .eq('id', sessionId)
      .select()
      .single();
    if (error) throw error;
    return { session: data };
  }

  // ---------- 비동기 모드 ----------
  async function createAsyncSession({ email, scores, typeCode }) {
    // 1) 초대 토큰 생성 (SQL 함수 호출)
    const { data: tokenData, error: tErr } = await sb().rpc('generate_invite_token');
    if (tErr) throw tErr;
    const invite_token = tokenData;

    // 2) 세션 생성
    const { data: session, error: sErr } = await sb()
      .from('couple_sessions')
      .insert({
        mode: 'async',
        status: 'awaiting_partner',
        payment_status: 'unpaid',
        invite_token,
      })
      .select()
      .single();
    if (sErr) throw sErr;

    // 3) A 참여자 저장
    const { error: pErr } = await sb().from('session_participants').insert({
      session_id: session.id,
      role: 'A',
      email,
      scores,
      type_code: typeCode,
      completed_at: new Date().toISOString(),
    });
    if (pErr) throw pErr;

    const invite_url = `${global.location.origin}/couple/invite/?t=${invite_token}`;
    return { session, invite_url };
  }

  async function getSessionByInviteToken(token) {
    const { data: session, error } = await sb()
      .from('couple_sessions')
      .select('*')
      .eq('invite_token', token)
      .maybeSingle();
    if (error) throw error;
    if (!session) return { session: null, participants: [] };

    const { data: participants, error: pErr } = await sb()
      .from('session_participants')
      .select('*')
      .eq('session_id', session.id);
    if (pErr) throw pErr;

    return { session, participants: participants || [] };
  }

  async function getSessionById(id) {
    const { data: session, error } = await sb()
      .from('couple_sessions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!session) return { session: null, participants: [] };

    const { data: participants, error: pErr } = await sb()
      .from('session_participants')
      .select('*')
      .eq('session_id', session.id);
    if (pErr) throw pErr;

    return { session, participants: participants || [] };
  }

  async function joinAsyncSession(token, { email, scores, typeCode }) {
    const { session, participants } = await getSessionByInviteToken(token);
    if (!session) throw new Error('초대 링크를 찾을 수 없어요.');
    if (session.status === 'paid' || session.status === 'both_done') {
      throw new Error('이미 양쪽 검사가 완료된 세션이에요.');
    }
    const roleA = participants.find(p => p.role === 'A');
    if (!roleA) throw new Error('세션 상태가 올바르지 않아요.');

    // B 참여자 저장
    const { error: pErr } = await sb().from('session_participants').insert({
      session_id: session.id,
      role: 'B',
      email,
      scores,
      type_code: typeCode,
      completed_at: new Date().toISOString(),
    });
    if (pErr) throw pErr;

    // combo 계산 + 상태 업데이트
    const combo = computeCombo(roleA.type_code, typeCode);
    const { data: updated, error: uErr } = await sb()
      .from('couple_sessions')
      .update({ status: 'both_done', combo })
      .eq('id', session.id)
      .select()
      .single();
    if (uErr) throw uErr;

    return { session: updated, combo };
  }

  // ---------- 공통 ----------
  async function findSessionsByEmail(email) {
    const { data: parts, error } = await sb()
      .from('session_participants')
      .select('session_id, role, email, couple_sessions(*)')
      .ilike('email', email);
    if (error) throw error;
    return (parts || []).map(p => ({
      session: p.couple_sessions,
      my_role: p.role,
    })).filter(x => x.session); // RLS로 걸러진 것 제외
  }

  async function markCombo(sessionId, combo, status) {
    const { data, error } = await sb()
      .from('couple_sessions')
      .update({ combo, status: status || 'both_done' })
      .eq('id', sessionId)
      .select()
      .single();
    if (error) throw error;
    return { session: data };
  }

  // PDF는 /couple/pdfs/ 에 이미 서빙되고 있음 (GitHub Pages)
  // 결제 검증(paid 상태)만 확인하고 경로는 프론트에서 직접 조합
  const TYPES_ORDER = ['SPARK','VISION','HARMONY','SOUL','LOGIC','LEADER','STEADY','PLAYER'];
  // ⚠️ 위 순서는 PDF 파일 번호 매기기 기준. 실제 /couple/pdfs/ 내 파일명과 일치하는지
  //   배포 후 확인 필요. 현재 download 페이지 PDF_MAP을 기준으로 맞춤.
  function comboToPdfPath(combo) {
    const PDF_MAP = {
      'SPARK_SPARK':'01_SPARK_SPARK_KR.pdf','SPARK_VISION':'02_SPARK_VISION_KR.pdf',
      'SPARK_HARMONY':'03_SPARK_HARMONY_KR.pdf','SPARK_SOUL':'04_SPARK_SOUL_KR.pdf',
      'SPARK_LOGIC':'05_SPARK_LOGIC_KR.pdf','SPARK_LEADER':'06_SPARK_LEADER_KR.pdf',
      'SPARK_STEADY':'07_SPARK_STEADY_KR.pdf','SPARK_PLAYER':'08_SPARK_PLAYER_KR.pdf',
      'VISION_SPARK':'09_VISION_SPARK_KR.pdf','VISION_VISION':'10_VISION_VISION_KR.pdf',
      'VISION_HARMONY':'11_VISION_HARMONY_KR.pdf','VISION_SOUL':'12_VISION_SOUL_KR.pdf',
      'VISION_LOGIC':'13_VISION_LOGIC_KR.pdf','VISION_LEADER':'14_VISION_LEADER_KR.pdf',
      'VISION_STEADY':'15_VISION_STEADY_KR.pdf','VISION_PLAYER':'16_VISION_PLAYER_KR.pdf',
      'HARMONY_SPARK':'17_HARMONY_SPARK_KR.pdf','HARMONY_VISION':'18_HARMONY_VISION_KR.pdf',
      'HARMONY_HARMONY':'19_HARMONY_HARMONY_KR.pdf','HARMONY_SOUL':'20_HARMONY_SOUL_KR.pdf',
      'HARMONY_LOGIC':'21_HARMONY_LOGIC_KR.pdf','HARMONY_LEADER':'22_HARMONY_LEADER_KR.pdf',
      'HARMONY_STEADY':'23_HARMONY_STEADY_KR.pdf','HARMONY_PLAYER':'24_HARMONY_PLAYER_KR.pdf',
      'SOUL_SPARK':'25_SOUL_SPARK_KR.pdf','SOUL_VISION':'26_SOUL_VISION_KR.pdf',
      'SOUL_HARMONY':'27_SOUL_HARMONY_KR.pdf','SOUL_SOUL':'28_SOUL_SOUL_KR.pdf',
      'SOUL_LOGIC':'29_SOUL_LOGIC_KR.pdf','SOUL_LEADER':'30_SOUL_LEADER_KR.pdf',
      'SOUL_STEADY':'31_SOUL_STEADY_KR.pdf','SOUL_PLAYER':'32_SOUL_PLAYER_KR.pdf',
      'LOGIC_SPARK':'33_LOGIC_SPARK_KR.pdf','LOGIC_VISION':'34_LOGIC_VISION_KR.pdf',
      'LOGIC_HARMONY':'35_LOGIC_HARMONY_KR.pdf','LOGIC_SOUL':'36_LOGIC_SOUL_KR.pdf',
      'LOGIC_LOGIC':'37_LOGIC_LOGIC_KR.pdf','LOGIC_LEADER':'38_LOGIC_LEADER_KR.pdf',
      'LOGIC_STEADY':'39_LOGIC_STEADY_KR.pdf','LOGIC_PLAYER':'40_LOGIC_PLAYER_KR.pdf',
      'LEADER_SPARK':'41_LEADER_SPARK_KR.pdf','LEADER_VISION':'42_LEADER_VISION_KR.pdf',
      'LEADER_HARMONY':'43_LEADER_HARMONY_KR.pdf','LEADER_SOUL':'44_LEADER_SOUL_KR.pdf',
      'LEADER_LOGIC':'45_LEADER_LOGIC_KR.pdf','LEADER_LEADER':'46_LEADER_LEADER_KR.pdf',
      'LEADER_STEADY':'47_LEADER_STEADY_KR.pdf','LEADER_PLAYER':'48_LEADER_PLAYER_KR.pdf',
      'STEADY_SPARK':'49_STEADY_SPARK_KR.pdf','STEADY_VISION':'50_STEADY_VISION_KR.pdf',
      'STEADY_HARMONY':'51_STEADY_HARMONY_KR.pdf','STEADY_SOUL':'52_STEADY_SOUL_KR.pdf',
      'STEADY_LOGIC':'53_STEADY_LOGIC_KR.pdf','STEADY_LEADER':'54_STEADY_LEADER_KR.pdf',
      'STEADY_STEADY':'55_STEADY_STEADY_KR.pdf','STEADY_PLAYER':'56_STEADY_PLAYER_KR.pdf',
      'PLAYER_SPARK':'57_PLAYER_SPARK_KR.pdf','PLAYER_VISION':'58_PLAYER_VISION_KR.pdf',
      'PLAYER_HARMONY':'59_PLAYER_HARMONY_KR.pdf','PLAYER_SOUL':'60_PLAYER_SOUL_KR.pdf',
      'PLAYER_LOGIC':'61_PLAYER_LOGIC_KR.pdf','PLAYER_LEADER':'62_PLAYER_LEADER_KR.pdf',
      'PLAYER_STEADY':'63_PLAYER_STEADY_KR.pdf','PLAYER_PLAYER':'64_PLAYER_PLAYER_KR.pdf',
    };
    const file = PDF_MAP[combo];
    return file ? `/couple/pdfs/${file}` : null;
  }

  async function requestDownloadUrl(sessionId, email) {
    // 세션 결제 검증 (RLS 덕에 anon key로도 조회 가능하지만 paid 여부 체크)
    const { data: session, error: sErr } = await sb()
      .from('couple_sessions')
      .select('id, combo, payment_status')
      .eq('id', sessionId)
      .maybeSingle();
    if (sErr || !session) throw new Error('세션을 찾을 수 없어요');
    if (session.payment_status !== 'paid') throw new Error('결제가 완료되지 않았어요');
    if (!session.combo) throw new Error('검사 결과가 아직 없어요');

    // 참여자 이메일 검증
    const { data: participant } = await sb()
      .from('session_participants')
      .select('id')
      .eq('session_id', sessionId)
      .ilike('email', email)
      .maybeSingle();
    if (!participant) throw new Error('이 이메일은 이 세션에 속하지 않아요');

    const path = comboToPdfPath(session.combo);
    if (!path) throw new Error('리포트 파일을 찾을 수 없어요');

    // 다운로드 로그 (best-effort)
    try {
      await sb().from('download_logs').insert({
        session_id: sessionId, email, user_agent: navigator.userAgent,
      });
    } catch (_) {}

    const [a, b] = session.combo.split('_');
    return {
      ok: true,
      url: path,
      filename: `42world_Couple_${a}_${b}_KR.pdf`,
    };
  }

  function buildLatpeedUrl(sessionId, email) {
    // 래피드는 동적 파라미터 미지원 → session_id는 localStorage로 인계
    // email은 일부 래피드 UI 프리필에 활용될 수도 있어 남겨둠
    if (sessionId) {
      try { localStorage.setItem('sg_last_session', sessionId); } catch(_){}
    }
    if (email) {
      try { localStorage.setItem('sg_last_email', email); } catch(_){}
    }
    return LATPEED_PRODUCT_URL;
  }

  // 래피드가 웹훅 미지원이라 이메일 입력 = 결제 완료로 간주 (Plan A)
  // 990원이라 악용 리스크 낮음. clever-responder Edge Function이 이메일-세션 매칭 검증.
  async function markPaidByEmail(sessionId, email) {
    const url = `${SG.SUPABASE_URL || ''}/functions/v1/clever-responder`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_paid', session_id: sessionId, email }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || `결제 확인 실패 (${resp.status})`);
    }
    return data;
  }

  function recoverLastSession() {
    try {
      return {
        sessionId: localStorage.getItem('sg_last_session'),
        email: localStorage.getItem('sg_last_email'),
      };
    } catch (_) {
      return { sessionId: null, email: null };
    }
  }

  SG.session = {
    TYPE_CODES,
    computeCombo,
    createSyncSession,
    createAsyncSession,
    saveSyncResults,
    getSessionByInviteToken,
    getSessionById,
    joinAsyncSession,
    findSessionsByEmail,
    markCombo,
    requestDownloadUrl,
    buildLatpeedUrl,
    markPaidByEmail,
    recoverLastSession,
  };
})(typeof window !== 'undefined' ? window : globalThis);
