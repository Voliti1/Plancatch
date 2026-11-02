"""Owner-scoped literal title search is applied before pagination."""
import uuid

import pytest

from tests.test_sources import auth_headers, client, configure_test_jwt  # noqa: F401


@pytest.mark.parametrize("kind", ["sources", "deadlines"])
def test_title_search_literal_owner_scope_pagination_and_length(kind):
    auth = auth_headers("search-" + uuid.uuid4().hex + "@example.com")
    other = auth_headers("search-other-" + uuid.uuid4().hex + "@example.com")
    path = "/api/" + kind

    def create(title, headers=auth):
        body = ({"source_type": "text", "original_text": "본문만 일치 검색아님"}
                if kind == "sources" else {"due_at": "2026-11-03T23:59:00+09:00"})
        body["title"] = title
        response = client.post(path, headers=headers, json=body)
        assert response.status_code == 201
        return response.json()["id"]

    titles = ["마케팅 채용", "회계 및 총무", "PlanCatch 지원", "100%_완료/확인", "100AB완료/확인"]
    ids = [create(title) for title in titles]
    create("마케팅 타인 자료", other)
    if kind == "sources":
        create(None)

    def search(query, **params):
        response = client.get(path, headers=auth, params={"q": query, **params})
        assert response.status_code == 200
        return [row["id"] for row in response.json()]

    assert search("  마케팅  ") == [ids[0]]
    assert search("plancatch") == [ids[2]]
    assert search("%_") == [ids[3]]  # LIKE wildcards remain literal input.
    assert set(search("/확인")) == {ids[3], ids[4]}
    assert search("본문만") == []
    assert search("' OR 1=1 --") == []
    assert search("없는제목") == []
    assert search("   ") == search("")
    expected = search("확인")
    assert search("확인", limit=1, offset=0) == expected[:1]
    assert search("확인", limit=1, offset=1) == expected[1:2]
    assert search("확인", offset=2) == []
    assert client.get(path, headers=auth, params={"q": "가" * 256}).status_code == 422
    assert client.get(path, params={"q": "마케팅"}).status_code == 401
