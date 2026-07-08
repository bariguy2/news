"""Article and category API routes."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.db import get_conn


router = APIRouter(prefix="/api", tags=["articles"])


class ArticleListItem(BaseModel):
    id: int
    title: str
    source: str
    category: str
    published_at: str | None
    url: str


class ArticleDetail(ArticleListItem):
    summary_facts: str
    summary_impact: str


@router.get("/articles", response_model=list[ArticleListItem])
def list_articles(
    category: str | None = None,
    limit: int = Query(default=50, ge=1),
) -> list[dict[str, object]]:
    """Return summarized article metadata, optionally filtered by category."""
    categories = list(
        dict.fromkeys(part.strip() for part in (category or "").split(",") if part.strip())
    )
    where = ["summary_status = 'done'"]
    parameters: list[object] = []
    if categories:
        placeholders = ", ".join("?" for _ in categories)
        where.append(f"category IN ({placeholders})")
        parameters.extend(categories)
    parameters.append(limit)

    with get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT id, title, source, category, published_at, url
            FROM articles
            WHERE {' AND '.join(where)}
            ORDER BY published_at DESC, id DESC
            LIMIT ?
            """,
            parameters,
        ).fetchall()

    return [dict(row) for row in rows]


@router.get("/articles/{article_id}", response_model=ArticleDetail)
def get_article(article_id: int) -> dict[str, object]:
    """Return one completed article summary without pipeline-only full text."""
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT id, title, source, category, published_at, url,
                   summary_facts, summary_impact
            FROM articles
            WHERE id = ? AND summary_status = 'done'
            """,
            (article_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Article not found")
    return dict(row)


@router.get("/categories", response_model=list[str])
def list_categories() -> list[str]:
    """Return the distinct seeded feed categories in stable display order."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT category FROM feeds ORDER BY category"
        ).fetchall()
    return [row["category"] for row in rows]
