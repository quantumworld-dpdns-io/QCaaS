from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from ..config import Settings, get_settings
from .models import Base

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def make_engine(settings: Settings | None = None) -> Engine:
    settings = settings or get_settings()
    url = settings.database_url
    kwargs: dict = {}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        path = url.split("///", 1)[-1]
        if path and path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
    else:
        # Postgres (Neon): serverless endpoints drop idle connections, so validate on checkout
        # and keep the pool small (Neon free tier allows few direct connections).
        kwargs.update(pool_pre_ping=True, pool_size=3, max_overflow=2, pool_recycle=280)
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://") :]
        elif url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://") :]
    engine = create_engine(url, **kwargs, future=True)
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _fk_on(dbapi_conn, _record):  # pragma: no cover
            dbapi_conn.execute("PRAGMA foreign_keys=ON")
            dbapi_conn.execute("PRAGMA journal_mode=WAL")

    return engine


def init_db(settings: Settings | None = None, engine: Engine | None = None) -> Engine:
    global _engine, _SessionLocal
    _engine = engine or make_engine(settings)
    Base.metadata.create_all(_engine)
    _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    return _engine


def get_engine() -> Engine:
    if _engine is None:
        init_db()
    assert _engine is not None
    return _engine


def session_factory() -> sessionmaker[Session]:
    if _SessionLocal is None:
        init_db()
    assert _SessionLocal is not None
    return _SessionLocal


def get_session() -> Iterator[Session]:
    session = session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
