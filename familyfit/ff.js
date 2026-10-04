/* 패밀리핏 공용 모듈: 서버 호출, 시제 데이터, 점수 비교, 기본 문구
   (index.html 의 게임 화면은 같은 내용을 안에 따로 가지고 있어서, 이 파일은 호스트/리포트 화면이 씁니다) */
(function () {
  const cfg = window.FF_CFG || {};
  const FF = (window.FF = {});
  FF.enabled = !!(cfg.SUPABASE_URL && cfg.ANON_KEY);
  FF.KEYS = ["P", "S", "F", "T"];

  FF.esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 서버 호출 (로그인 없이 토큰으로) ---------- */
  function headers() { return { apikey: cfg.ANON_KEY, Authorization: "Bearer " + cfg.ANON_KEY, "Content-Type": "application/json" }; }
  FF.rpc = async function (name, args) {
    if (!FF.enabled) throw new Error("disabled");
    let r;
    try { r = await fetch(cfg.SUPABASE_URL + "/rest/v1/rpc/" + name, { method: "POST", headers: headers(), body: JSON.stringify(args || {}) }); }
    catch (e) { throw new Error("network"); }
    const text = await r.text(); let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (!r.ok) throw new Error((data && (data.message || data.error)) || "server");
    return data;
  };
  FF.generate = async function (host, force) {
    if (!FF.enabled) throw new Error("disabled");
    let r;
    try { r = await fetch(cfg.SUPABASE_URL + "/functions/v1/family-report", { method: "POST", headers: headers(), body: JSON.stringify({ host_token: host, force: !!force }) }); }
    catch (e) { throw new Error("network"); }
    let data = null; try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((data && data.error) || "server");
    return data;
  };
  FF.errText = function (e) {
    const m = (e && e.message) || "";
    return ({
      invalid_email: "이메일 형식을 확인해 주세요.", invalid_family: "가족 이름은 1~12자로 적어 주세요.",
      invalid_members: "구성원은 서로 다른 이름으로 2~8명이 필요해요.", too_many_rooms: "오늘 만들 수 있는 방 수를 넘었어요. 내일 다시 시도해 주세요.",
      too_many_members: "구성원은 최대 8명까지예요.", duplicate_name: "같은 이름이 이미 있어요.", invalid_name: "이름은 1~8자로 적어 주세요.",
      min_members: "구성원은 최소 2명이 남아야 해요.", not_found: "링크를 찾을 수 없어요. 주소가 잘렸는지 확인해 주세요.",
      network: "인터넷 연결을 확인해 주세요.", disabled: "아직 서버가 연결되지 않았어요.", limit: "이 방의 리포트 생성 횟수를 모두 사용했어요.",
      need_two: "결과가 2명 이상 모여야 리포트를 만들 수 있어요.", ai_failed: "문장 생성에 실패했어요. 기본 문구로 리포트를 보여 드릴게요.",
      no_api_key: "문장 생성 설정이 아직 없어요. 기본 문구로 리포트를 보여 드릴게요."
    })[m] || "잠시 후 다시 시도해 주세요.";
  };

  /* ---------- 시제 데이터 ---------- */
  FF.TENSES = {
    P: { name: "과거형", code: "Si", title: "든든한 기록관", color: "#B5654A",
      strength: "약속, 준비물, 가족의 기억을 놓치지 않고 챙겨요. 이 사람이 있으면 일이 안정돼요.",
      stress: "계획이 갑자기 바뀌거나 처음 보는 방식을 정해진 듯 요구받을 때 지쳐요.",
      tip: "“지난번 방식에서 이 부분만 바꿔 볼까?”처럼 기준점을 먼저 알려 주세요." },
    S: { name: "현재형", code: "Se", title: "현장 해결사", color: "#E0794F",
      strength: "현장에서 가장 빠르게 움직이고 분위기를 살려요. 막힌 일을 그 자리에서 풀어요.",
      stress: "긴 설명이나 먼 미래 이야기가 이어지면 답답해져요.",
      tip: "“지금 당장 이것부터 하자”처럼 할 일을 하나로 줄여 말해 주세요." },
    F: { name: "미래형", code: "Ne", title: "아이디어 탐험가", color: "#D9A441",
      strength: "가능성을 펼쳐서 가족에게 새로운 선택지를 만들어 줘요.",
      stress: "같은 일의 반복이나 “안 돼”라는 첫마디에 에너지가 빠져요.",
      tip: "“그 아이디어 좋다, 그중 하나만 먼저 해 볼까?”라고 말해 주세요." },
    T: { name: "초월형", code: "Ni", title: "분위기 통찰가", color: "#7A3B3B",
      strength: "말보다 흐름을 먼저 읽고 핵심 한마디로 방향을 잡아 줘요.",
      stress: "충분히 생각하기 전에 결론을 재촉받거나 설명을 길게 요구받을 때 지쳐요.",
      tip: "“어떤 느낌이 들었어?” 하고 천천히 물어보고 기다려 주세요." }
  };
  FF.PAIR = {
    PF: { opp: true, mis: "과거형은 “예전엔 이렇게 했잖아”라고 말하고, 미래형은 그 말을 ‘새로운 시도를 막는다’고 들어요. 반대로 미래형의 “이번엔 이거 어때?”는 과거형에게 ‘근거 없이 흔든다’로 들려요.", a: "과거형 → 미래형: “그 아이디어, 지난번 방식에서 어디를 바꾸는 거야?”", b: "미래형 → 과거형: “검증된 건 그대로 두고, 딱 한 가지만 새로 해 보면 어때?”" },
    ST: { opp: true, mis: "현재형은 “그래서 지금 뭘 하자는 거야?”라고 묻고, 초월형은 말 속의 이유를 알아주길 바라요. 서로 ‘왜 내 말을 못 알아듣지?’ 하고 느낄 수 있어요.", a: "현재형 → 초월형: “네가 보는 큰 그림을 한 문장으로 말해 줘. 그다음 내가 지금 할 일을 정할게.”", b: "초월형 → 현재형: “지금 해야 할 일 하나만 정해 줘. 나머지는 그다음에 얘기하자.”" },
    PS: { mis: "과거형은 즉흥이 불안하고, 현재형은 짜 놓은 계획이 답답해요.", a: "과거형 → 현재형: “큰 일정은 정해 두고, 중간에 자유시간 2시간을 줄게.”", b: "현재형 → 과거형: “큰 일정은 네 계획대로 하고, 중간 빈 칸만 내가 채울게.”" },
    SF: { mis: "미래형은 “다음엔 이거!” 하고 넘어가고, 현재형은 “일단 지금 이것부터” 하고 붙들어요. 서로 속도가 달라 보여요.", a: "미래형 → 현재형: “이 아이디어는 메모만 해 둘게. 지금 일부터 끝내자.”", b: "현재형 → 미래형: “그 아이디어, 오늘 저녁 시간에 같이 얘기해 보자.”" },
    PT: { mis: "과거형은 사실과 디테일을, 초월형은 의미와 흐름을 먼저 봐요. 과거형은 “근거가 뭐야?”, 초월형은 “그걸 왜 몰라?” 하고 서로 답답해할 수 있어요.", a: "과거형 → 초월형: “그렇게 느낀 계기가 뭐였어?”", b: "초월형 → 과거형: “사실 하나만 먼저 말하고, 해석은 그다음에 말할게.”" },
    FT: { mis: "미래형은 이야기가 사방으로 퍼지고, 초월형은 조용히 하나의 결론으로 모여요. 미래형에게는 초월형이 닫혀 있는 것처럼, 초월형에게는 미래형이 흩어지는 것처럼 보여요.", a: "미래형 → 초월형: “결론까지 어떤 생각을 했는지 한 줄만 들려줘.”", b: "초월형 → 미래형: “아이디어 중에 마음에 걸리는 하나를 골라서 말할게.”" },
    PP: { same: true, mis: "서로의 방식이 익숙해서 편하지만, 새로운 시도가 줄어들 수 있어요.", a: "함께: “이번 여행에 ‘처음 해보는 것’ 하나만 넣어 볼까?”", b: "" },
    SS: { same: true, mis: "둘 다 즉흥이라 재미있지만, 큰 일정이 비어 있을 수 있어요.", a: "함께: “예약이 필요한 것 하나만 미리 정해 두자.”", b: "" },
    FF: { same: true, mis: "아이디어는 넘치는데 정리하는 사람이 없을 수 있어요.", a: "함께: “오늘 나온 아이디어 중 하나만 골라 실행하자.”", b: "" },
    TT: { same: true, mis: "말하지 않아도 알 것 같지만, 확인하지 않으면 오해가 쌓일 수 있어요.", a: "함께: “내가 이해한 게 맞는지 한 번만 말로 확인하자.”", b: "" }
  };
  FF.MISSING = {
    P: "기록과 점검 담당이 없어요. 예약·시간·준비물 확인을 돌아가며 맡아 보세요.",
    S: "현장 대응 담당이 없어요. 변수가 생겼을 때 ‘지금 당장 할 일’을 누가 정할지 미리 정해 두세요.",
    F: "새로운 시도 담당이 없어요. 이번 여행에 ‘처음 해보는 것’을 하나씩 넣어 보세요.",
    T: "분위기와 의미 담당이 없어요. 하루 끝에 ‘오늘 마음에 남은 순간’을 한 줄씩 나눠 보세요."
  };
  FF.pairKey = (a, b) => [a, b].sort((x, y) => FF.KEYS.indexOf(x) - FF.KEYS.indexOf(y)).join("");

  /* ---------- 점수 ---------- */
  FF.pct = counts => counts.map(c => Math.round(c / 12 * 100));              // 네 시제의 비율(합 100 안팎)
  // 두 사람 분포의 닮은 정도 0~100 (궁합이 아니라 '표현 방식이 얼마나 비슷한지')
  FF.similarity = (a, b) => Math.round(100 * (1 - 0.5 * a.reduce((s, v, i) => s + Math.abs(v / 12 - b[i] / 12), 0)));
  FF.simLabel = s => (s >= 75 ? "비슷해요" : s >= 50 ? "보통이에요" : "차이가 커요");
  FF.familyAvg = ms => FF.KEYS.map((_, i) => Math.round(ms.reduce((s, m) => s + m.counts[i], 0) / ms.length / 12 * 100));

  /* ---------- 서버 문구가 없을 때 쓰는 기본 문구 ---------- */
  FF.fallback = function (family, ms) {
    const by = { P: [], S: [], F: [], T: [] }; ms.forEach(m => by[m.winner].push(m.nickname));
    const missing = FF.KEYS.filter(k => !by[k].length);
    const present = FF.KEYS.filter(k => by[k].length).sort((a, b) => by[b].length - by[a].length);
    const out = { fallback: true, members: {}, dynamics: { pairs: [] }, promises: [], questions: [] };
    ms.forEach(m => { const t = FF.TENSES[m.winner]; out.members[m.nickname] = { strength: t.strength, stress: t.stress, tip: t.tip }; });
    out.headline = present.length === 1 ? family + " 가족은 같은 방식으로 세상을 보는 가족" : present.length === 4 ? family + " 가족은 네 가지 시제가 모두 모인 가족" : family + " 가족의 시제 지도";
    out.dynamics.overview = present.length === 1
      ? "모두 " + FF.TENSES[present[0]].name + "이 가장 크게 나왔어요. 서로 말이 잘 통하는 편이지만, 비어 있는 시제의 관점이 필요한 순간에는 일부러 다른 방식을 떠올려 보면 좋아요."
      : "대표 시제가 " + present.map(k => FF.TENSES[k].name + " " + by[k].length + "명").join(", ") + "으로 나뉘었어요. 같은 상황을 서로 다른 순서로 받아들이기 때문에, 말이 어긋나는 순간이 곧 서로를 번역해 볼 기회예요.";
    out.dynamics.blindspot = missing.length ? missing.map(k => FF.TENSES[k].name + "이 없어요. " + FF.MISSING[k]).join(" ") : "네 가지 시제가 모두 모인 가족이에요. 서로가 서로의 빈칸을 채워 줄 수 있어요.";
    const cand = [];
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
      const k = FF.pairKey(ms[i].winner, ms[j].winner), p = FF.PAIR[k];
      cand.push({ a: ms[i].nickname, b: ms[j].nickname, k, rank: p.opp ? 0 : p.same ? 2 : 1, sim: FF.similarity(ms[i].counts, ms[j].counts) });
    }
    cand.sort((x, y) => x.rank - y.rank || x.sim - y.sim);
    cand.slice(0, 4).forEach(c => out.dynamics.pairs.push({ a: c.a, b: c.b, insight: FF.PAIR[c.k].mis, script: FF.PAIR[c.k].a + (FF.PAIR[c.k].b ? "\n" + FF.PAIR[c.k].b : "") }));
    out.promises = (missing.length ? [FF.MISSING[missing[0]]] : []).concat([
      "하루에 한 번, 오늘 가장 좋았던 순간을 한 사람씩 한 문장으로 말해요.",
      "의견이 달라지면 “내 방식으로는 이래”라고 먼저 말하고 나서 서로의 방식으로 번역해 봐요.",
      "여행 일정에 ‘계획 칸’과 ‘즉흥 칸’을 하나씩 두어요."
    ]).slice(0, 3);
    out.questions = [
      "이번 여행에서 가장 기대하는 장면은 무엇인가요? 그 이유는요?",
      "가족 중 누군가의 말이 다르게 들렸던 최근 순간이 있었나요?",
      "내가 지치는 순간에 가족이 어떻게 말해 주면 도움이 될까요?",
      "우리 가족에게 ‘비어 있는 시제’의 힘을 빌린다면 어떤 장면에서 쓰고 싶나요?"
    ];
    return out;
  };

  /* ---------- 짧은 도우미 ---------- */
  FF.copy = async function (t) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(t); return true; } } catch (e) {}
    const ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta);
    ta.focus(); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (e) {} ta.remove(); return ok;
  };
  FF.share = async function (text, toast) {
    if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    const ok = await FF.copy(text);
    toast(ok ? "복사했어요. 단톡방에 붙여 넣어 주세요" : "복사가 안 됐어요");
  };
  FF.lsGet = k => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  FF.lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
})();
