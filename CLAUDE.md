# 42world 파트너 운영 규칙

## 파트너 목록

| 파트너 | 파라미터 | 홈 링크 | 래피드 상품 링크 |
|--------|----------|---------|----------------|
| 파트너 01 (가은) | `partner=01` | `https://42world.kr/?partner=01` | `https://www.latpeed.com/products/abBPX` |
| 파트너 02 (인서) | `partner=02` | `https://42world.kr/?partner=02` | `https://www.latpeed.com/products/J14BC` |
| 기본 (직접 접속) | 없음 | `https://42world.kr/` | `https://www.latpeed.com/products/9yuqU` |

## 파트너 파라미터 전파 흐름

```
파트너 링크 (/?partner=01)
  → 홈 (브랜드 소개)
  → 검사 (/couple/test/?partner=01)
  → 결과 (/couple/result/?...&partner=01)
  → 공유 링크에도 partner=01 유지
  → 공유받은 사람 → 홈 (/?partner=01) → 검사 → 결과
  → 리포트 구매 → 파트너 전용 래피드 상품
```

## 파트너 추가 방법

### 1. `partner/index.html` — PARTNERS 객체에 추가
```javascript
const PARTNERS = {
  '01': { label: '파트너 01', homeUrl: 'https://42world.kr/?partner=01', latpeed: 'https://www.latpeed.com/products/abBPX' },
  '02': { label: '파트너 02', homeUrl: 'https://42world.kr/?partner=02', latpeed: 'https://www.latpeed.com/products/J14BC' },
  '03': { label: '파트너 03', homeUrl: 'https://42world.kr/?partner=03', latpeed: 'https://www.latpeed.com/products/XXXXX' }, // 신규 추가
};
```

### 2. `couple/result/index.html` — LATPEED_PARTNER_MAP에 추가
```javascript
const LATPEED_PARTNER_MAP = {
  '01': 'https://www.latpeed.com/products/abBPX',
  '02': 'https://www.latpeed.com/products/J14BC',
  '03': 'https://www.latpeed.com/products/XXXXX', // 신규 추가
};
```

> 래피드에서 파트너 전용 상품을 먼저 생성한 뒤 상품 코드를 위 두 곳에 추가하면 됩니다.

## 설계 원칙

- 파트너 파라미터는 URL에만 존재 (서버 DB 없음) — 래피드가 정산 자동 집계
- 공유가 몇 단계를 거쳐도 `partner` 파라미터가 끊기지 않도록 모든 이동 버튼에 전파 처리
- 공유받은 사람은 반드시 홈(브랜드 소개)을 거쳐 검사로 진입 (`/couple/test/` 직접 이동 금지)
- 파트너 링크는 대외비 — 메인페이지 footer에 노출 금지

## 자체 PG 전환 시 (미래)

- `partner` URL 파라미터를 그대로 PG 결제 요청에 전달
- DB 주문 테이블에 `partner_id` 컬럼 추가
- 결제 완료 webhook에서 `partner_id` 기록 후 자체 정산 대시보드 구현
- 기존 파트너 링크 (`/?partner=01`) 그대로 유효 — 재배포 불필요
