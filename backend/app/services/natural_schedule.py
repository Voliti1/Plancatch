"""Small, deterministic Korean schedule grammar. Never fetch, call AI or persist."""
import re
from datetime import date, datetime, time, timedelta, timezone

from app.schemas.natural_schedule import NaturalScheduleDraft

SEOUL = timezone(timedelta(hours=9), "Asia/Seoul")
DATE = re.compile(
    r"(?:(?P<year>\d{4})\s*(?:년\s*|[./-]\s*))?"
    r"(?P<month>\d{1,2})\s*(?:월\s*|[./-]\s*)(?P<day>\d{1,2})(?:\s*일)?"
    r"(?:\s*\([월화수목금토일](?:요일)?\))?"
    r"|(?P<relative>오늘|내일|모레|글피)"
    r"|(?P<after>\d{1,3})\s*일\s*(?:뒤|후)"
    r"|(?:(?P<week>이번\s*주|다음\s*주|다다음\s*주)\s*)?"
    r"(?P<weekday>[월화수목금토일])요일"
)
CLOCK = re.compile(
    r"(?<!\d)(?P<ampm>오전|오후|아침|저녁|밤|새벽|낮)?\s*"
    r"(?P<hour>\d{1,2})\s*(?:"
    r":\s*(?P<colon>\d{1,2})(?!\d|\s*:)"
    r"|시(?:\s*(?P<minute>\d{1,2})\s*분|\s*(?P<half>반))?(?!\d))"
    r"|(?P<noon>정오)|(?P<midnight>자정)"
)
DURATION = re.compile(
    r"(?:(?P<hours>\d{1,3}|한|두|세|네)\s*시간\s*(?:(?P<half>반)|(?P<minutes>\d{1,3})\s*분)?)"
    r"|(?P<only_minutes>\d{1,3})\s*분(?:\s*동안)?"
)


def interpret(text: str, *, now: datetime | None = None) -> NaturalScheduleDraft:
    reference = (now or datetime.now(SEOUL)).astimezone(SEOUL)
    today = reference.date()
    notices: list[str] = []
    spans: list[tuple[int, int]] = []
    dates: list[date | None] = []
    durations = list(DURATION.finditer(text))
    # A duration such as "1시간" must not also become the clock "1시".
    duration_spans = [m.span() for m in durations]
    clocks = [m for m in CLOCK.finditer(text)
              if not any(a <= (m.start("hour") if m["hour"] else m.start()) < b
                         for a, b in duration_spans)]
    # "오후 3시 30분" is a clock; its 30분 is not a separate duration.
    durations = [m for m in durations
                 if not any(c.start() <= m.start() and c.end() >= m.end() for c in clocks)]
    duration_spans = [m.span() for m in durations]
    date_matches = list(DATE.finditer(text))
    is_range = len(clocks) == 2 and bool(re.search(
        r"부터|에서|[~～–—-]", text[clocks[0].end():clocks[1].start()],
    ))
    kind = "deadline" if re.search(r"마감|기한|제출|완료(?:해|하|해야)|까지", text) and not is_range else "task"
    if re.search(r"마감|기한", text):
        kind = "deadline"
    for m in date_matches:
        spans.append(m.span())
        try:
            if m["month"]:
                year = int(m["year"] or today.year)
                value = date(year, int(m["month"]), int(m["day"]))
                weekday = re.search(r"\(([월화수목금토일])(?:요일)?\)", m.group())
                if weekday and value.weekday() != "월화수목금토일".index(weekday[1]):
                    notices.append("적힌 날짜와 요일이 다릅니다. 날짜를 확인해 주세요.")
                if not m["year"]:
                    notices.append(f"연도가 없어 {year}년으로 해석했습니다.")
            elif m["relative"]:
                value = today + timedelta(days={"오늘": 0, "내일": 1, "모레": 2, "글피": 3}[m["relative"]])
            elif m["after"]:
                value = today + timedelta(days=int(m["after"]))
            else:
                weekday = "월화수목금토일".index(m["weekday"])
                week = re.sub(r"\s", "", m["week"] or "")
                if week:
                    offset = {"이번주": 0, "다음주": 7, "다다음주": 14}[week]
                    value = today - timedelta(days=today.weekday()) + timedelta(days=offset + weekday)
                else:
                    value = today + timedelta(days=(weekday - today.weekday()) % 7)
            dates.append(value)
        except (ValueError, OverflowError):
            dates.append(None)
            notices.append("입력한 날짜를 확인해 주세요. 존재하지 않거나 지원 범위를 벗어났습니다.")

    parsed_clocks: list[tuple[int, int] | None] = []
    for index, m in enumerate(clocks):
        spans.append(m.span())
        hour = 12 if m["noon"] else 0 if m["midnight"] else int(m["hour"])
        minute = int(m["colon"] or m["minute"] or 0) if m["hour"] else 0
        if m["half"]:
            minute = 30
        marker = m["ampm"]
        valid = 0 <= hour <= 24 and 0 <= minute < 60 and (hour != 24 or minute == 0)
        if marker:
            valid = valid and 1 <= hour <= 12
            if valid:
                hour = hour % 12 + (12 if marker in {"오후", "저녁", "밤", "낮"} else 0)
        if not valid:
            parsed_clocks.append(None)
            notices.append("시간 표기를 확인해 주세요. 예: 오후 3시, 18:00.")
        else:
            parsed_clocks.append((hour, minute))
            if m["midnight"]:
                notices.append("자정은 해당 날짜의 시작인 00:00으로 해석했습니다. 날짜를 확인해 주세요.")
            elif (not marker and m["hour"] and 1 <= int(m["hour"]) <= 11
                  and not (is_range and index == 1 and clocks[0]["ampm"] in {"오후", "저녁", "밤", "낮"})):
                notices.append("오전·오후 표시가 없는 시간은 24시간 기준입니다. 시간을 확인해 주세요.")

    duration = None
    if durations:
        m = durations[0]
        hours = {"한": 1, "두": 2, "세": 3, "네": 4}.get(m["hours"], m["hours"] or 0)
        duration = int(hours) * 60 + int(m["minutes"] or m["only_minutes"] or 0) + (30 if m["half"] else 0)
        spans.extend(duration_spans)
        if not 1 <= duration <= 7 * 24 * 60:
            duration = None
            notices.append("소요시간은 1분부터 7일 사이로 입력해 주세요.")

    blocked = False
    for token in re.finditer(r"\d{1,4}\s*:\s*\d{1,4}(?::\s*\d+)?", text):
        if not any(m.start() <= token.start() and m.end() >= token.end() for m in clocks):
            notices.append("시간을 시:분 형태로 다시 입력해 주세요. 예: 18:00.")
            blocked = True
    for token in re.finditer(r"\d{1,4}\s*시(?!간)(?:\s*\d{1,4}\s*분)?", text):
        if not any(m.start() <= token.start() and m.end() >= token.end() for m in clocks):
            notices.append("시간 표기를 확인해 주세요. 예: 오후 3시, 18:00.")
            blocked = True
    if re.search(r"매일|매주|매월|매년|격주|반복", text):
        notices.append("반복 일정은 아직 지원하지 않습니다. 한 번 등록할 날짜를 직접 선택해 주세요.")
        blocked = True
    if (len(date_matches) > (2 if is_range else 1) or len(clocks) > 2
            or (len(clocks) == 2 and not is_range) or len(durations) > 1):
        notices.append("한 번에 일정 하나를 입력해 주세요. 여러 날짜·시간 중 사용할 값을 직접 선택할 수 있습니다.")
        blocked = True
    if re.search(r"미국|뉴욕|런던|현지\s*시간|\b(?:UTC|GMT|PST|EST|JST)\b|[+-]\d\d:\d\d", text, re.IGNORECASE):
        notices.append("한국 시간으로 입력해 주세요. 다른 지역의 시간은 자동 변환하지 않습니다.")
        blocked = True

    def combine(day: date | None, clock: tuple[int, int] | None):
        if day is None or clock is None:
            return None
        try:
            h, minute = clock
            return datetime.combine(day, time(h % 24, minute), SEOUL) + timedelta(days=h // 24)
        except (ValueError, OverflowError):
            return None

    start = end = None
    day = dates[0] if dates else None
    if not blocked:
        if kind == "deadline":
            end = combine(dates[-1] if dates else None, parsed_clocks[-1] if parsed_clocks else (23, 59))
            if end and not clocks:
                notices.append("마감 시간이 없어 해당 날짜 23:59로 제안했습니다.")
        else:
            start = combine(day, parsed_clocks[0] if parsed_clocks else None)
            if is_range:
                # "오후 3시부터 4시" inherits the explicit 오후 only for a 1..11 clock.
                last = parsed_clocks[1]
                if (last and clocks[0]["ampm"] in {"오후", "저녁", "밤", "낮"}
                        and not clocks[1]["ampm"] and 1 <= last[0] <= 11):
                    last = (last[0] + 12, last[1])
                end = combine(dates[-1] if len(dates) == 2 else day, last)
                if (start and end and end <= start and len(dates) < 2
                        and re.search(r"다음\s*날|익일|새벽", text)):
                    try:
                        end += timedelta(days=1)
                    except OverflowError:
                        end = None
                if start and end and end <= start:
                    end = None
                    notices.append("종료 시간이 시작 시간보다 늦도록 직접 확인해 주세요.")
            elif start and (not durations or duration is not None):
                try:
                    end = start + timedelta(minutes=duration or 60)
                    if duration is None:
                        notices.append("종료 시간이 없어 1시간 일정으로 제안했습니다. 수정할 수 있습니다.")
                except OverflowError:
                    notices.append("종료 날짜를 직접 입력해 주세요.")

    # Remove only recognized date/time expressions and their adjacent particles.
    chars = list(text)
    for a, b in spans:
        suffix = re.match(r"\s*(?:부터|까지|동안|에(?![가-힣]))", text[b:])
        if suffix:
            b += suffix.end()
        chars[a:b] = " " * (b - a)
    title = "".join(chars)
    title = re.sub(r"(?:일정을?\s*)?(?:등록해\s*줘|추가해\s*줘|잡아\s*줘|만들어\s*줘)[.!?\s]*$", "", title)
    title = re.sub(r"(?:^|\s)(?:부터|까지|동안|에)(?=\s|$)|[~～–—]", " ", title)
    title = re.sub(r"\s+", " ", title).strip(" ,.-!?")
    if not title:
        title = "새 마감일" if kind == "deadline" else "새 할 일"
        notices.append("일정 제목을 확인하고 수정해 주세요.")
    if len(title) > 255:
        title = title[:255]
        notices.append("제목이 길어 앞부분만 넣었습니다. 저장 전 확인해 주세요.")
    if not day:
        notices.append("날짜를 읽지 못했습니다. 날짜를 직접 선택해 주세요.")
    if kind == "task" and start is None:
        notices.append("시작 시간을 직접 입력해 주세요.")
    if kind == "task" and end is None:
        notices.append("종료 시간을 직접 입력해 주세요.")
    moment = end if kind == "deadline" else start
    if moment and moment < reference:
        notices.append("지금보다 이전 시각입니다. 날짜와 시간을 확인해 주세요.")
    return NaturalScheduleDraft(kind=kind, title=title, start_at=start, end_at=end,
                                reference_at=reference, notices=list(dict.fromkeys(notices)))
