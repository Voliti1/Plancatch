"""Branded, script-free OAuth landing page; never reflect provider/query content."""

import base64
import hashlib

from fastapi.responses import HTMLResponse

STYLE = """
:root{color-scheme:light;--blue:#305ee8;--ink:#202c3a;--muted:#657383;--line:#e3e8ed}
*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:var(--ink);font-family:Arial,"Noto Sans KR","Malgun Gothic",sans-serif;font-size:15px;line-height:1.7}
a{color:inherit;text-decoration:none}a:focus-visible{outline:3px solid #89a7ff;outline-offset:5px}
.shell{width:min(1080px,100%);margin:auto;padding:30px 32px}.header{display:flex;align-items:center;justify-content:space-between;gap:20px}
.brand{display:inline-flex;align-items:center;gap:9px;font-size:24px;font-weight:800;letter-spacing:-1px}.logo{display:grid;place-items:center;width:35px;height:35px;border-radius:10px;background:var(--blue);color:#fff;font-size:25px;font-style:italic}.brand-dot{color:var(--blue)}
.header-note{font-size:12px;color:var(--muted)}main{padding:65px 0 44px}.intro{text-align:center;margin-bottom:28px}.eyebrow{font-size:11px;font-weight:700;color:var(--blue);letter-spacing:2px}.intro p{color:var(--muted);margin:8px 0}
.card{max-width:660px;margin:auto;background:#fff;border:1px solid var(--line);border-radius:20px;padding:40px 42px;box-shadow:0 12px 40px #20395d06}
.icon{display:grid;place-items:center;width:64px;height:64px;margin-bottom:22px;border-radius:18px;color:var(--blue);background:#edf2ff;font-size:30px;font-weight:700}.retry .icon{color:#a16b0c;background:#fff6df}
.badge{display:inline-flex;border-radius:6px;padding:3px 9px;background:#edf2ff;color:var(--blue);font-size:11px;font-weight:700}.retry .badge{background:#fff6df;color:#926313}
h1{font-size:28px;line-height:1.4;letter-spacing:-1px;margin:15px 0 14px}.message{color:#607087;margin:0 0 24px;overflow-wrap:anywhere}
.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:18px 0;margin:0 0 25px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);list-style:none;font-size:12px;color:var(--muted)}.steps strong{display:block;color:var(--blue);font-size:10px;letter-spacing:1px;margin-bottom:4px}
.button{display:flex;align-items:center;justify-content:center;gap:14px;min-height:50px;padding:12px 18px;background:var(--blue);color:#fff;border-radius:9px;font-size:14px;font-weight:700}.button:hover{background:#244dcb}.help{text-align:center;color:var(--muted);font-size:12px;margin:12px 0 0}
.notice{margin-top:25px;border-radius:10px;background:#f6f8fc;padding:16px 18px;font-size:12px;color:#607087}.notice strong{display:block;color:var(--ink);margin-bottom:4px}.notice p{margin:0}.footer{text-align:center;color:var(--muted);font-size:11px;margin-top:26px}
@media(max-width:600px){.shell{padding:22px 20px}.brand{font-size:22px}.header-note{display:none}main{padding:38px 0 20px}.card{padding:28px 24px;border-radius:16px}h1{font-size:24px}.intro{margin-bottom:22px}.intro p{font-size:13px}.steps{font-size:11px;gap:5px}.notice{padding:14px}.button{font-size:13px}}
"""

RESULTS = {
    "connected": (
        "구글 연결 요청을 처리했어요",
        "인증 요청 처리 완료",
        "Google Calendar 연결 요청을 처리했습니다. 플랜캐치에서 연결 상태를 확인해 주세요.",
        "✓",
        "ready",
    ),
    "cancelled": (
        "구글 연결이 취소됐어요",
        "연결 취소",
        "연결을 취소했거나 더 새로운 연결 요청이 있습니다. 기존 일정은 변경되지 않았어요.",
        "↗",
        "ready",
    ),
    "insufficient_scope": (
        "캘린더 권한을 확인해 주세요",
        "다시 확인 필요",
        "캘린더 권한이 승인되지 않았습니다. 플랜캐치로 돌아가 필요한 권한을 확인하고 다시 연결해 주세요.",
        "!",
        "retry",
    ),
    "refresh_token_missing": (
        "구글 계정을 다시 연결해 주세요",
        "다시 확인 필요",
        "연결 유지에 필요한 인증 정보를 받지 못했습니다. 플랜캐치에서 연결을 다시 시작해 주세요.",
        "!",
        "retry",
    ),
}
FALLBACK = (
    "구글 연결을 완료하지 못했어요",
    "다시 확인 필요",
    "Google 연결을 완료하지 못했습니다. 플랜캐치에서 연결 상태를 확인한 뒤 다시 시도해 주세요.",
    "!",
    "retry",
)


def completion_response(result: str) -> HTMLResponse:
    # Only fixed, trusted strings below enter HTML; unknown codes use one fallback.
    title, badge, message, icon, tone = RESULTS.get(result, FALLBACK)
    style_hash = base64.b64encode(hashlib.sha256(STYLE.encode()).digest()).decode()
    html = f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>구글 계정 연결 · PlanCatch</title><style>{STYLE}</style></head>
<body><div class="shell"><header class="header"><a class="brand" href="/dashboard" aria-label="플랜캐치 대시보드">
<span class="logo" aria-hidden="true">P</span><span>PlanCatch<span class="brand-dot">.</span></span></a>
<span class="header-note">계획을 모으고, 마감을 지키다.</span></header>
<main><div class="intro"><span class="eyebrow">GOOGLE CALENDAR</span><p>나의 계획을 연결하는 다음 단계</p></div>
<section class="card {tone}" aria-labelledby="result-title"><div class="icon" aria-hidden="true">{icon}</div>
<span class="badge">{badge}</span><h1 id="result-title">{title}</h1><p class="message">{message}</p>
<ol class="steps" aria-label="연결 확인 순서"><li><strong>01</strong>구글 인증</li><li><strong>02</strong>플랜캐치로 복귀</li><li><strong>03</strong>연결 상태 확인</li></ol>
<a class="button" href="/settings/google-calendar">플랜캐치에서 연결 상태 확인하기 <span aria-hidden="true">→</span></a>
<p class="help">최종 연결 상태는 플랜캐치에서 확인할 수 있어요.</p>
<aside class="notice"><strong>내 일정은 그대로 유지됩니다</strong><p>이 단계에서는 캘린더 일정을 생성하거나 변경하지 않습니다.</p></aside>
</section><footer class="footer">PlanCatch · 차근차근, 오늘의 계획부터.</footer></main></div></body></html>"""
    return HTMLResponse(
        html,
        headers={
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": (
                f"default-src 'none'; style-src 'sha256-{style_hash}'; "
                "base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
            ),
        },
    )
