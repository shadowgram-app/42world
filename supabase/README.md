# 패밀리핏 서버 설정 (Supabase)

가족 방 · 결과 자동 수집 · 가족 리포트(문장 생성)를 켜는 방법입니다. 한 번만 하면 됩니다.

## 구조
- `familyfit.sql` : 테이블 3개(ff_rooms, ff_members, ff_reports)와 접근 함수. 테이블은 잠가 두고 함수로만 접근합니다.
- `functions/family-report/index.ts` : Claude API로 리포트 문장을 만드는 Edge Function. API 키는 서버에만 둡니다.
- `familyfit/config.js` : 브라우저가 서버를 찾는 주소와 공개 키 (비워 두면 기능이 꺼지고 기존 코드 붙여넣기 방식만 동작)

## 1. 프로젝트와 테이블
1. Supabase에서 프로젝트를 만듭니다. (기존 프로젝트를 써도 되지만, 패밀리핏 전용을 권장합니다. SQL은 `ff_` 로 시작하는 것만 만들고 건드립니다.)
2. SQL Editor에 `supabase/familyfit.sql` 전체를 붙여 넣고 Run. 여러 번 실행해도 안전합니다.

## 2. 리포트 함수 배포
CLI 방식(권장):
```
supabase login
supabase link --project-ref <프로젝트 ref>
supabase functions deploy family-report
supabase secrets set ANTHROPIC_API_KEY=<Claude API 키>
```
(선택) 모델을 바꾸려면 `supabase secrets set ANTHROPIC_MODEL=<모델명>`. 기본값은 `claude-sonnet-5-5` 입니다.

CLI가 어려우면 대시보드 > Edge Functions > Create a function 에서 이름을 `family-report` 로 하고 `index.ts` 내용을 붙여 넣은 뒤, Secrets에 `ANTHROPIC_API_KEY` 를 추가해도 됩니다. (JWT 검증은 기본값 그대로 켜 두세요.)

## 3. 주소와 키 넣기
Project Settings > API 에서 `Project URL` 과 `anon public` 키를 복사해 `familyfit/config.js` 에 넣고 푸시합니다. anon 키는 공개되어도 되는 키이며, `service_role` 키는 절대 넣지 않습니다.

## 4. 확인
1. `42world.kr/familyfit/host/` 에서 방을 만들고 구성원 링크를 열어 결과를 제출합니다.
2. 대시보드에 완료 표시가 뜨고, 2명 이상이면 `가족 리포트` 가 열립니다.

## 운영 메모
- 리포트 문장 생성은 방마다 최대 10회, 같은 데이터면 다시 생성하지 않습니다(비용 보호). AI가 실패하면 기본 문구로 리포트가 나옵니다.
- 호스트 주소(`?h=`)와 구성원 주소(`?m=`)가 곧 열쇠입니다. 추측할 수 없는 64자 토큰이지만, 단톡방 밖으로 공유하지 않도록 안내해 주세요.
- 이메일은 인증하지 않고 연락용으로 저장합니다. **테스트 기간 한정으로** 이메일만 입력하면 그 이메일로 만든 방을 다시 열 수 있습니다(`ff_rooms_by_email`). 이메일을 아는 사람은 누구나 그 방의 호스트 대시보드를 열 수 있다는 뜻이므로, 정식 운영 전에는 SQL 파일 안의 `revoke` 한 줄로 이 기능을 끄고 메일 링크 방식으로 바꾸는 것을 권합니다.
- 보존 기간 정리 예시(SQL Editor, 6개월 지난 방 삭제):
  `delete from ff_rooms where created_at < now() - interval '180 days';`

## 공개 전에 확인할 것
- `legal/privacy.html` 에 패밀리핏이 수집하는 항목(이메일, 구성원 애칭, 게임 응답), 목적, 보존 기간, 처리 위탁(Supabase, Anthropic)을 추가해야 합니다. 현재 처리방침은 "수집하지 않음"으로 되어 있어 내용이 달라집니다. 법률 검토를 권합니다.
- 만 14세 미만 구성원은 보호자 동의가 필요합니다. 방 만들기 화면에 보호자 대행 동의 문구를 넣어 두었습니다.
- AI 문구에는 호스트가 입력한 이름(애칭)과 시제 비율만 전달됩니다. 이메일은 전달하지 않습니다.
